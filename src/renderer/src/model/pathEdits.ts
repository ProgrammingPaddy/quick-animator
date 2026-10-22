import * as acorn from 'acorn'
import { formatNumber, type TextEdit } from './edits'
import type { BlockInfo, PropInfo, Range } from './types'

/** The slice of the ESTree shape this file reads. */
interface Node {
  type: string
  start: number
  end: number
}
interface ArrayNode extends Node {
  type: 'ArrayExpression'
  elements: (Node | null)[]
}
interface CallNode extends Node {
  type: 'CallExpression'
  callee: Node & { name?: string }
  arguments: Node[]
}

/** One `[x, y]` of a path's shape as written, with where it lives in the source. */
export interface PointLiteral {
  range: Range
  x: number
  y: number
  /** Written as `at(x, y)`: a place in the scene, not the shape's own (D266). */
  tied?: boolean
}

/** A path's shape when it is written as a list of point literals (D194), which the GUI can edit point by point. */
export interface ShapeLiteral {
  prop: PropInfo
  /** The whole `[ ... ]`. */
  range: Range
  points: PointLiteral[]
  /** One point per line, as the GUI writes it, or all on one line. */
  multiline: boolean
  /** The indentation of a point's line, for a new one. */
  indent: string
}

function numberOf(node: Node | null, source: string): number | null {
  if (!node) return null
  const text = source.slice(node.start, node.end).replace(/\s+/g, '')
  if (node.type === 'Literal') return /^\d/.test(text) ? Number(text) : null
  if (node.type === 'UnaryExpression' && /^[-+]\d/.test(text)) return Number(text)
  return null
}

/**
 * The `shape` of a path statement, or a Shape's `points` (D232), as literal points, each with its
 * text range, or null when the list is missing or is code: a function, a name, or anything but numbers.
 */
export function shapeLiteral(source: string, block: BlockInfo, key = 'shape'): ShapeLiteral | null {
  const prop = block.props.find((p) => p.key === key)
  if (!prop) return null
  let node: Node
  try {
    // Only the value's own text, so the parser stops at its end instead of reading on into the next key.
    node = acorn.parseExpressionAt(source.slice(0, prop.valueRange.to), prop.valueRange.from, { ecmaVersion: 'latest' }) as unknown as Node
  } catch {
    return null
  }
  if (node.type !== 'ArrayExpression') return null
  const points: PointLiteral[] = []
  for (const element of (node as ArrayNode).elements) {
    if (!element) return null
    // A point tied to the scene, `at(x, y)` (D266), beside the plain pairs.
    const tied = element.type === 'CallExpression' && (element as CallNode).callee.type === 'Identifier' && (element as CallNode).callee.name === 'at'
    const parts = tied ? (element as CallNode).arguments : element.type === 'ArrayExpression' ? (element as ArrayNode).elements : null
    if (!parts || parts.length !== 2) return null
    const x = numberOf(parts[0]!, source)
    const y = numberOf(parts[1]!, source)
    if (x === null || y === null) return null
    points.push({ range: { from: element.start, to: element.end }, x, y, ...(tied ? { tied: true } : {}) })
  }
  const text = source.slice(node.start, node.end)
  const multiline = text.includes('\n')
  const first = points[0]
  let indent = `${block.indent}  `
  if (first && multiline) {
    const lineStart = source.lastIndexOf('\n', first.range.from - 1) + 1
    const lead = source.slice(lineStart, first.range.from)
    if (/^\s*$/.test(lead)) indent = lead
  }
  return { prop, range: { from: node.start, to: node.end }, points, multiline, indent }
}

/** A string written as a literal, with where it lives, or null when the key is missing or is code (D238). */
export function stringLiteral(source: string, block: BlockInfo, key: string): { prop: PropInfo; range: Range; value: string } | null {
  const prop = block.props.find((p) => p.key === key)
  if (!prop) return null
  let node: Node & { value?: unknown; expressions?: unknown[]; quasis?: { value: { cooked: string | null } }[] }
  try {
    node = acorn.parseExpressionAt(source.slice(0, prop.valueRange.to), prop.valueRange.from, { ecmaVersion: 'latest' }) as unknown as typeof node
  } catch {
    return null
  }
  if (node.type === 'Literal' && typeof node.value === 'string') return { prop, range: { from: node.start, to: node.end }, value: node.value }
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0 && node.quasis?.length === 1 && typeof node.quasis[0]!.value.cooked === 'string') return { prop, range: { from: node.start, to: node.end }, value: node.quasis[0]!.value.cooked }
  return null
}

export function pointText(x: number, y: number): string {
  return `[${formatNumber(x)}, ${formatNumber(y)}]`
}

/** A point tied to the scene as written, `at(x, y)` (D266). */
export function tiedText(x: number, y: number): string {
  return `at(${formatNumber(x)}, ${formatNumber(y)})`
}

/** Replace one point's literal: a pair, or `at(x, y)` for a point tied to the scene, which stays tied (D266). */
export function setPointEdit(shape: ShapeLiteral, index: number, x: number, y: number): TextEdit | null {
  const point = shape.points[index]
  if (!point) return null
  return { from: point.range.from, to: point.range.to, insert: point.tied ? tiedText(x, y) : pointText(x, y) }
}

/**
 * Insert points so that the first lands at `index`: before the point there now, or at the end
 * when `index` is the count. One point per line when the list is written that way.
 */
export function insertPointsEdit(source: string, shape: ShapeLiteral, index: number, points: { x: number; y: number }[]): TextEdit | null {
  if (points.length === 0 || index < 0 || index > shape.points.length) return null
  const texts = points.map((p) => pointText(p.x, p.y))
  if (shape.multiline) {
    const lines = texts.map((t) => `${shape.indent}${t},`).join('\n')
    if (index === 0) {
      // Right after the opening bracket, before the first point's line.
      const at = shape.range.from + 1
      return { from: at, to: at, insert: `\n${lines}` }
    }
    const before = shape.points[index - 1]!
    const after = source.slice(before.range.to)
    const comma = /^\s*,/.exec(after)
    if (comma) {
      const at = before.range.to + comma[0].length
      return { from: at, to: at, insert: `\n${lines}` }
    }
    // The last point had no comma: give it one, then the lines, and the new last point keeps its comma.
    return { from: before.range.to, to: before.range.to, insert: `,\n${lines}` }
  }
  if (index === 0) {
    const at = shape.range.from + 1
    return { from: at, to: at, insert: `${texts.join(', ')}, ` }
  }
  const before = shape.points[index - 1]!
  return { from: before.range.to, to: before.range.to, insert: `, ${texts.join(', ')}` }
}

/** Remove one point; the last one stays, since a path with no points is nothing. */
export function removePointEdit(source: string, shape: ShapeLiteral, index: number): TextEdit | null {
  const point = shape.points[index]
  if (!point || shape.points.length < 2) return null
  const lineStart = source.lastIndexOf('\n', point.range.from - 1) + 1
  const lineEndIndex = source.indexOf('\n', point.range.to)
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex
  const before = source.slice(lineStart, point.range.from)
  const after = source.slice(point.range.to, lineEnd)
  // A point alone on its line goes with the line.
  if (/^\s*$/.test(before) && /^\s*,?\s*$/.test(after)) return { from: lineStart, to: Math.min(source.length, lineEnd + 1), insert: '' }
  const comma = /^\s*,\s*/.exec(after)
  if (comma) return { from: point.range.from, to: point.range.to + comma[0].length, insert: '' }
  // The last point on a line: take the comma before it too.
  const previous = /,\s*$/.exec(before)
  return { from: previous ? point.range.from - previous[0].length : point.range.from, to: point.range.to, insert: '' }
}
