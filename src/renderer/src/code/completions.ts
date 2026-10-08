import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { formatValue } from '../model/edits'
import { classes, EASE_NAMES, TIMING_KEYS, VERBS, VERB_ATTRS, type AttrSchema, type Verb } from '../model/registry'
import type { SceneModel } from '../model/types'
import { useStore } from '../state/store'

/**
 * Completions driven by the class registry and the current model (decision D36): classes,
 * objects, and `all` at a statement start, classes after `name = `, verbs after `object.` and
 * after `all('name').`, attributes and timing keys inside a block, named curves after `ease:`,
 * time references after `at:` and `until:`, and the classes in use after `class:` and inside
 * `all('`.
 */

const TIMING_DOCS: Record<string, string> = {
  at: 'Start, in seconds or a time reference such as slide.end. Omitted: right after the previous action.',
  delay: 'Seconds added to the start.',
  duration: 'Seconds. Omitted: 1.',
  until: 'An end time or time reference, instead of duration.',
  easeIn: 'Seconds of easing at the start. Omitted: 30% of the duration.',
  easeOut: 'Seconds of easing at the end. Omitted: 30% of the duration.',
  ease: "A named curve: 'linear', 'bounce', 'back', 'elastic', or 'snap'. Replaces easeIn and easeOut.",
  relative: 'true: the values are changes from where the object is when the action starts, and add on top of other actions.',
}

const TIMING_PLACEHOLDER: Record<string, string> = {
  at: '0',
  delay: '0',
  duration: '1',
  until: '',
  easeIn: '0.3',
  easeOut: '0.3',
  ease: "'linear'",
  relative: 'true',
}

const VERB_DOCS: Record<Verb, string> = {
  move: 'Move to a position over time.',
  rotate: 'Turn to an angle over time.',
  scale: 'Grow or shrink over time.',
  resize: 'Change width, height, radius, or font size over time.',
  fade: 'Change opacity over time. Opacity 0 means the object does not exist.',
  to: 'Change any attributes over time.',
}

/**
 * Numbered snippet fields. The editor reads `${3}` as a field number and `${3:text}` as a field
 * with placeholder text, so every field is numbered explicitly and Tab visits them in order.
 */
class Fields {
  private count = 0
  field(text: string): string {
    this.count++
    return text === '' ? `\${${this.count}}` : `\${${this.count}:${text}}`
  }
}

function attrCompletion(attr: AttrSchema): Completion {
  const value = formatValue(attr.default)
  const f = new Fields()
  return snippetCompletion(`${attr.name}: ${f.field(value)},`, { label: attr.name, detail: value, info: attr.doc, type: 'property' })
}

function timingCompletion(key: string): Completion {
  const f = new Fields()
  return snippetCompletion(`${key}: ${f.field(TIMING_PLACEHOLDER[key] ?? '')},`, { label: key, info: TIMING_DOCS[key], type: 'keyword' })
}

/** A whole object with every attribute at its default, Tab through the values. With or without the `name = ` part. */
function classSnippet(className: string, withName: boolean): Completion {
  const schema = classes[className]!
  const f = new Fields()
  const head = withName ? `${f.field(className.toLowerCase())} = ${className}` : className
  const lines = schema.attrs.map((a) => `  ${a.name}: ${f.field(formatValue(a.default))},`).join('\n')
  return snippetCompletion(`${head}({\n${lines}\n})`, {
    label: className,
    detail: 'new object',
    info: `${schema.doc} Expands to a full block.`,
    type: 'class',
  })
}

function verbSnippet(verb: Verb, className: string | undefined): Completion {
  const f = new Fields()
  const lines: string[] = []
  const allowed = VERB_ATTRS[verb]
  if (verb === 'to') lines.push(`  ${f.field('')}`)
  else if (allowed && className) {
    const schema = classes[className]
    const attrs = allowed.filter((a) => schema?.attrs.some((s) => s.name === a)).slice(0, verb === 'move' ? 2 : 1)
    for (const a of attrs) lines.push(`  ${a}: ${f.field(formatValue(schema!.attrs.find((s) => s.name === a)!.default))},`)
  }
  lines.push(`  duration: ${f.field('1')},`)
  return snippetCompletion(`${verb}({\n${lines.join('\n')}\n})`, { label: verb, info: VERB_DOCS[verb], type: 'method' })
}

/** `all('name').verb({ ... })`: an action for every member of a class (D80). */
function allSnippet(): Completion {
  const f = new Fields()
  return snippetCompletion(`all('${f.field('name')}').${f.field('fade')}({\n  ${f.field('')}\n})`, {
    label: 'all',
    detail: 'class action',
    info: "An action on every object whose class includes the name, as in all('logos').fade({ ... }).",
    type: 'function',
  })
}

interface CallInfo {
  block: SyntaxNode
  kind: 'class' | 'verb'
  /** For a class block, the class being declared. */
  className?: string
  /** For a verb block, the object acted on, or else the CSS-like class of `all('name')`. */
  objectName?: string
  cssClass?: string
  verb?: Verb
}

const SELECTOR = /^all\(\s*(['"])(.*?)\1\s*\)$/

/** The `Class({ ... })`, `object.verb({ ... })`, or `all('name').verb({ ... })` block the cursor is inside, if any. */
function enclosingCall(state: EditorState, node: SyntaxNode | null): CallInfo | null {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name !== 'ObjectExpression') continue
    const argList = n.parent
    const call = argList?.name === 'ArgList' ? argList.parent : null
    if (!call || call.name !== 'CallExpression') return null
    const callee = call.firstChild
    if (!callee) return null
    if (callee.name === 'VariableName') {
      const className = state.sliceDoc(callee.from, callee.to)
      return className in classes ? { block: n, kind: 'class', className } : null
    }
    if (callee.name === 'MemberExpression') {
      const object = callee.firstChild
      const property = callee.lastChild
      if (!object || !property) return null
      const verb = state.sliceDoc(property.from, property.to)
      if (!(VERBS as readonly string[]).includes(verb)) return null
      if (object.name === 'VariableName') return { block: n, kind: 'verb', objectName: state.sliceDoc(object.from, object.to), verb: verb as Verb }
      const selector = object.name === 'CallExpression' ? SELECTOR.exec(state.sliceDoc(object.from, object.to)) : null
      if (selector) return { block: n, kind: 'verb', cssClass: selector[2], verb: verb as Verb }
      return null
    }
    return null
  }
  return null
}

/** Keys already written in a block. */
function presentKeys(state: EditorState, block: SyntaxNode): Set<string> {
  const keys = new Set<string>()
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'Property') continue
    const key = child.firstChild
    if (key) keys.add(state.sliceDoc(key.from, key.to).replace(/^['"]|['"]$/g, ''))
  }
  return keys
}

/** When the cursor sits in the value part of `key: value`, the key. */
function valueKey(state: EditorState, node: SyntaxNode | null, pos: number): string | null {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name === 'ObjectExpression') return null
    if (n.name !== 'Property') continue
    const key = n.firstChild
    if (!key || pos <= key.to) return null
    if (!state.sliceDoc(key.to, pos).includes(':')) return null
    return state.sliceDoc(key.from, key.to).replace(/^['"]|['"]$/g, '')
  }
  return null
}

function timeReferenceOptions(model: SceneModel | null): Completion[] {
  const options: Completion[] = []
  const seen = new Set<string>()
  for (const action of model?.actions ?? []) {
    if (!action.name || seen.has(action.name)) continue
    seen.add(action.name)
    options.push({ label: `${action.name}.end`, type: 'variable', info: `When ${action.name} ends.` })
    options.push({ label: `${action.name}.start`, type: 'variable', info: `When ${action.name} starts.` })
    options.push(snippetCompletion(`${action.name}.progress(\${1:0.5})`, { label: `${action.name}.progress()`, type: 'variable', info: `A fraction of the way through ${action.name}.` }))
  }
  return options
}

/** The classes objects belong to right now, for `class:` values and `all('`. */
function classNameOptions(model: SceneModel | null): Completion[] {
  return [...(model?.classes.entries() ?? [])].map(([name, members]) => ({ label: name, type: 'constant', info: `${members.length} ${members.length === 1 ? 'member' : 'members'}: ${members.join(', ')}` }))
}

export function sceneCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const model = useStore.getState().model
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)
  const word = context.matchBefore(/[\w$]*/)

  // all('name').| : the verbs, with the first member's attributes.
  const selector = /all\(\s*(['"])([^'"]*)\1\s*\)\.([\w$]*)$/.exec(before)
  if (selector) {
    const member = model?.objects.find((o) => o.classes.includes(selector[2]!))
    return { from: pos - selector[3]!.length, options: VERBS.map((v) => verbSnippet(v, member?.className)), validFor: /^[\w$]*$/ }
  }

  // all('| : the classes in use.
  const inSelector = /all\(\s*['"]([\w$-]*)$/.exec(before)
  if (inSelector) {
    return { from: pos - inSelector[1]!.length, options: classNameOptions(model), validFor: /^[\w$-]*$/ }
  }

  // object.| or action.|
  const member = /([A-Za-z_$][\w$]*)\.([\w$]*)$/.exec(before)
  if (member) {
    const owner = member[1]!
    const from = pos - member[2]!.length
    const obj = model?.objects.find((o) => o.name === owner)
    if (obj) return { from, options: VERBS.map((v) => verbSnippet(v, obj.className)), validFor: /^[\w$]*$/ }
    const action = model?.actions.find((a) => a.name === owner)
    if (action) {
      return {
        from,
        options: [
          { label: 'end', type: 'property', info: 'When the action ends.' },
          { label: 'start', type: 'property', info: 'When the action starts.' },
          snippetCompletion('progress(${1:0.5})', { label: 'progress', detail: '(fraction)', info: 'A fraction of the way through the action.', type: 'method' }),
        ],
        validFor: /^[\w$]*$/,
      }
    }
    return null
  }

  // name = | : the name is already there, so the class expands without one.
  if (/^\s*(?:const\s+|let\s+|var\s+)?[A-Za-z_$][\w$]*\s*=\s*[\w$]*$/.test(before)) {
    if (!word || (word.from === word.to && !context.explicit)) return null
    return { from: word.from, options: [...Object.keys(classes).map((c) => classSnippet(c, false)), allSnippet()], validFor: /^[\w$]*$/ }
  }

  const node = syntaxTree(state).resolveInner(pos, -1)
  const call = enclosingCall(state, node)
  if (call) {
    const key = valueKey(state, node, pos)
    if (key !== null) {
      if (key === 'ease') {
        const quoted = context.matchBefore(/'?[\w$]*/)
        return { from: quoted?.from ?? pos, options: EASE_NAMES.map((n) => ({ label: `'${n}'`, type: 'constant' })), validFor: /^'?[\w$]*'?$/ }
      }
      if (key === 'at' || key === 'until') {
        if (!word) return null
        return { from: word.from, options: timeReferenceOptions(model), validFor: /^[\w$.()]*$/ }
      }
      if (key === 'relative') {
        return { from: word?.from ?? pos, options: [{ label: 'true', type: 'constant' }, { label: 'false', type: 'constant' }], validFor: /^[\w$]*$/ }
      }
      if (key === 'class' && call.kind === 'class') {
        // Inside the quotes only, so the closing quote the editor added stays in place.
        const inQuotes = /['"][\w$ -]*$/.test(before)
        const partial = /[\w$-]*$/.exec(before)![0]
        return inQuotes ? { from: pos - partial.length, options: classNameOptions(model), validFor: /^[\w$-]*$/ } : null
      }
      return null
    }
    if (!/^\s*[\w$]*$/.test(before)) return null
    if (!word || (word.from === word.to && !context.explicit)) return null
    const present = presentKeys(state, call.block)
    const options: Completion[] = []
    if (call.kind === 'class') {
      for (const attr of classes[call.className!]!.attrs) if (!present.has(attr.name)) options.push(attrCompletion(attr))
    } else {
      const owner = call.objectName ? model?.objects.find((o) => o.name === call.objectName) : call.cssClass ? model?.objects.find((o) => o.classes.includes(call.cssClass!)) : undefined
      const className = owner?.className
      const allowed = VERB_ATTRS[call.verb!]
      if (className) {
        for (const attr of classes[className]!.attrs) {
          if (!attr.animatable || present.has(attr.name)) continue
          if (allowed && !allowed.includes(attr.name)) continue
          options.push(attrCompletion(attr))
        }
      }
      for (const key of TIMING_KEYS) if (!present.has(key)) options.push(timingCompletion(key))
    }
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }

  // A statement start: a new object, an object to act on, or a class to act on.
  if (/^\s*[\w$]*$/.test(before)) {
    if (!word || (word.from === word.to && !context.explicit)) return null
    const options: Completion[] = Object.keys(classes).map((c) => classSnippet(c, true))
    for (const obj of model?.objects ?? []) options.push({ label: obj.name, type: 'variable', detail: obj.className, apply: `${obj.name}.` })
    if (model && model.classes.size > 0) options.push(allSnippet())
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }
  return null
}
