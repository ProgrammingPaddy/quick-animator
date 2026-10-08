import * as acorn from 'acorn'
import type { ActionInfo, BlockInfo, DeclInfo, PropInfo, Range } from './types'

/** The slice of the ESTree shape this file reads. Narrowed by `type`. */
interface Node {
  type: string
  start: number
  end: number
}
interface Identifier extends Node {
  type: 'Identifier'
  name: string
}
interface Literal extends Node {
  type: 'Literal'
  value: unknown
}
interface Property extends Node {
  type: 'Property'
  key: Node
  value: Node
  computed: boolean
}
interface ObjectExpression extends Node {
  type: 'ObjectExpression'
  properties: Node[]
}
interface CallExpression extends Node {
  type: 'CallExpression'
  callee: Node
  arguments: Node[]
}
interface MemberExpression extends Node {
  type: 'MemberExpression'
  object: Node
  property: Node
  computed: boolean
}
interface AssignmentExpression extends Node {
  type: 'AssignmentExpression'
  operator: string
  left: Node
  right: Node
}
interface ExpressionStatement extends Node {
  type: 'ExpressionStatement'
  expression: Node
}
interface VariableDeclarator extends Node {
  type: 'VariableDeclarator'
  id: Node
  init: Node | null
}
interface VariableDeclaration extends Node {
  type: 'VariableDeclaration'
  declarations: VariableDeclarator[]
}
interface UnaryExpression extends Node {
  type: 'UnaryExpression'
  operator: string
  argument: Node
}
interface Program extends Node {
  type: 'Program'
  body: Node[]
}

export interface ParseError {
  message: string
  pos: number
  line: number
}

export interface ParseResult {
  decls: DeclInfo[]
  actions: ActionInfo[]
  /** End of the last object declaration statement, or null when there is none. */
  lastDeclEnd: number | null
  error: ParseError | null
}

function propKind(value: Node): PropInfo['kind'] {
  if (value.type === 'Literal') return 'literal'
  if (value.type === 'UnaryExpression') {
    const u = value as UnaryExpression
    if ((u.operator === '-' || u.operator === '+') && u.argument.type === 'Literal') return 'literal'
  }
  if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') return 'function'
  return 'other'
}

function propKey(property: Property): string | null {
  if (property.computed) return null
  if (property.key.type === 'Identifier') return (property.key as Identifier).name
  if (property.key.type === 'Literal') return String((property.key as Literal).value)
  return null
}

function blockInfo(source: string, stmt: Node, block: ObjectExpression, keywordRange?: Range): BlockInfo {
  const props: PropInfo[] = []
  for (const node of block.properties) {
    if (node.type !== 'Property') continue
    const property = node as Property
    const key = propKey(property)
    if (key === null) continue
    props.push({
      key,
      range: { from: property.start, to: property.end },
      valueRange: { from: property.value.start, to: property.value.end },
      raw: source.slice(property.value.start, property.value.end),
      kind: propKind(property.value),
    })
  }
  const first = block.properties[0]
  const last = block.properties[block.properties.length - 1]
  let lastPropEnd = last ? last.end : block.start + 1
  let trailingComma = false
  if (last) {
    const after = /^\s*,/.exec(source.slice(last.end, block.end))
    if (after) {
      trailingComma = true
      lastPropEnd = last.end + after[0].length
    }
  }
  let indent = '  '
  if (first) {
    const lineStart = source.lastIndexOf('\n', first.start) + 1
    const leading = /^[ \t]*/.exec(source.slice(lineStart, first.start))
    if (leading && leading[0].length > 0) indent = leading[0]
  }
  return {
    range: { from: stmt.start, to: stmt.end },
    propsOpen: block.start + 1,
    propsClose: block.end - 1,
    props,
    lastPropEnd,
    trailingComma,
    indent,
    keywordRange,
  }
}

/**
 * Find the GUI-editable statements: object declarations (`name = Class({ ... })`, with or without
 * `const`) and actions (`name.verb({ ... })`, optionally assigned). Everything else is free code.
 */
export function parseScene(source: string, classNames: ReadonlySet<string>, verbNames: ReadonlySet<string>): ParseResult {
  let program: Program
  try {
    program = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script' }) as unknown as Program
  } catch (err) {
    const e = err as { message?: string; pos?: number; loc?: { line?: number } }
    return {
      decls: [],
      actions: [],
      lastDeclEnd: null,
      error: { message: (e.message ?? 'Syntax error').replace(/\s*\(\d+:\d+\)\s*$/, ''), pos: e.pos ?? 0, line: e.loc?.line ?? 1 },
    }
  }

  const decls: DeclInfo[] = []
  const actions: ActionInfo[] = []
  let lastDeclEnd: number | null = null

  const classify = (stmt: Node, name: string | null, expr: Node, keywordRange?: Range): void => {
    if (expr.type !== 'CallExpression') return
    const call = expr as CallExpression
    const lastArg = call.arguments[call.arguments.length - 1]
    const block = lastArg && lastArg.type === 'ObjectExpression' ? (lastArg as ObjectExpression) : null
    if (call.callee.type === 'Identifier') {
      const className = (call.callee as Identifier).name
      if (!classNames.has(className) || !block || name === null) return
      decls.push({ ...blockInfo(source, stmt, block, keywordRange), name, className })
      lastDeclEnd = stmt.end
      return
    }
    if (call.callee.type === 'MemberExpression') {
      const member = call.callee as MemberExpression
      if (member.computed || member.property.type !== 'Identifier' || !block) return
      const verb = (member.property as Identifier).name
      if (!verbNames.has(verb)) return
      if (member.object.type === 'Identifier') {
        actions.push({ ...blockInfo(source, stmt, block, keywordRange), objectName: (member.object as Identifier).name, verb, name: name ?? undefined })
        return
      }
      // all('class').verb({ ... })
      if (member.object.type === 'CallExpression') {
        const selector = member.object as CallExpression
        const arg = selector.arguments[0]
        if (selector.callee.type !== 'Identifier' || (selector.callee as Identifier).name !== 'all' || !arg || arg.type !== 'Literal') return
        const className = (arg as Literal).value
        if (typeof className !== 'string') return
        actions.push({ ...blockInfo(source, stmt, block, keywordRange), objectName: '', className, verb, name: name ?? undefined })
      }
    }
  }

  for (const stmt of program.body) {
    if (stmt.type === 'ExpressionStatement') {
      const expr = (stmt as ExpressionStatement).expression
      if (expr.type === 'AssignmentExpression') {
        const assign = expr as AssignmentExpression
        if (assign.operator === '=' && assign.left.type === 'Identifier') classify(stmt, (assign.left as Identifier).name, assign.right)
      } else if (expr.type === 'CallExpression') {
        classify(stmt, null, expr)
      }
    } else if (stmt.type === 'VariableDeclaration') {
      const declaration = stmt as VariableDeclaration
      if (declaration.declarations.length !== 1) continue
      const declarator = declaration.declarations[0]!
      if (declarator.id.type !== 'Identifier' || !declarator.init) continue
      classify(stmt, (declarator.id as Identifier).name, declarator.init, { from: stmt.start, to: declarator.start })
    }
  }

  return { decls, actions, lastDeclEnd, error: null }
}
