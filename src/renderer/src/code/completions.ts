import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { formatValue } from '../model/edits'
import { classes, EASE_NAMES, TIMING_KEYS, VERBS, VERB_ATTRS, type AttrSchema, type Verb } from '../model/registry'
import type { SceneModel } from '../model/types'
import { useStore } from '../state/store'

/**
 * Completions driven by the class registry and the current model (decision D36): classes and
 * objects at a statement start, verbs after `object.`, attributes and timing keys inside a
 * block, named curves after `ease:`, time references after `at:` and `until:`.
 */

const TIMING_DOCS: Record<string, string> = {
  at: 'Start, in seconds or a time reference such as slide.end. Omitted: right after the previous action.',
  delay: 'Seconds added to the start.',
  duration: 'Seconds. Omitted: 1.',
  until: 'An end time or time reference, instead of duration.',
  easeIn: 'Seconds of easing at the start. Omitted: 30% of the duration.',
  easeOut: 'Seconds of easing at the end. Omitted: 30% of the duration.',
  ease: "A named curve: 'linear', 'bounce', 'back', 'elastic', or 'snap'. Replaces easeIn and easeOut.",
  fadeIn: 'Seconds to fade in, with appear.',
  fadeOut: 'Seconds to fade out, with disappear.',
}

const TIMING_PLACEHOLDER: Record<string, string> = {
  at: '0',
  delay: '0',
  duration: '1',
  until: '',
  easeIn: '0.3',
  easeOut: '0.3',
  ease: "'linear'",
  fadeIn: '0.3',
  fadeOut: '0.3',
}

const VERB_DOCS: Record<Verb, string> = {
  move: 'Move to a position over time.',
  rotate: 'Turn to an angle over time.',
  scale: 'Grow or shrink over time.',
  resize: 'Change width, height, radius, or font size over time.',
  fade: 'Change opacity over time.',
  to: 'Change any attributes over time.',
  appear: 'Exist from this time, with an optional fade in.',
  disappear: 'Stop existing at this time, with an optional fade out.',
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

function timingApplies(key: string, verb: Verb): boolean {
  if (key === 'fadeIn') return verb === 'appear'
  if (key === 'fadeOut') return verb === 'disappear'
  if (verb === 'appear' || verb === 'disappear') return key === 'at' || key === 'delay'
  return true
}

/** A whole object with every attribute at its default, name first, Tab through the values. */
function classSnippet(className: string): Completion {
  const schema = classes[className]!
  const f = new Fields()
  const name = f.field(className.toLowerCase())
  const lines = schema.attrs.map((a) => `  ${a.name}: ${f.field(formatValue(a.default))},`).join('\n')
  return snippetCompletion(`${name} = ${className}({\n${lines}\n})`, {
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
  if (verb === 'appear') lines.push(`  at: ${f.field('0')},`, `  fadeIn: ${f.field('0.3')},`)
  else if (verb === 'disappear') lines.push(`  at: ${f.field('0')},`, `  fadeOut: ${f.field('0.3')},`)
  else lines.push(`  duration: ${f.field('1')},`)
  return snippetCompletion(`${verb}({\n${lines.join('\n')}\n})`, { label: verb, info: VERB_DOCS[verb], type: 'method' })
}

interface CallInfo {
  block: SyntaxNode
  kind: 'class' | 'verb'
  className?: string
  objectName?: string
  verb?: Verb
}

/** The `Class({ ... })` or `object.verb({ ... })` block the cursor is inside, if any. */
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
      if (!object || !property || object.name !== 'VariableName') return null
      const verb = state.sliceDoc(property.from, property.to)
      if (!(VERBS as readonly string[]).includes(verb)) return null
      return { block: n, kind: 'verb', objectName: state.sliceDoc(object.from, object.to), verb: verb as Verb }
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
  for (const action of model?.actions ?? []) {
    if (!action.name) continue
    options.push({ label: `${action.name}.end`, type: 'variable', info: `When ${action.name} ends.` })
    options.push({ label: `${action.name}.start`, type: 'variable', info: `When ${action.name} starts.` })
    options.push(snippetCompletion(`${action.name}.progress(\${0.5})`, { label: `${action.name}.progress()`, type: 'variable', info: `A fraction of the way through ${action.name}.` }))
  }
  for (const obj of model?.objects ?? []) {
    options.push({ label: `${obj.name}.appears`, type: 'variable', info: `When ${obj.name} starts to exist.` })
    options.push({ label: `${obj.name}.disappears`, type: 'variable', info: `When ${obj.name} stops existing.` })
  }
  return options
}

export function sceneCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const model = useStore.getState().model
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)
  const word = context.matchBefore(/[\w$]*/)

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
          snippetCompletion('progress(${0.5})', { label: 'progress', detail: '(fraction)', info: 'A fraction of the way through the action.', type: 'method' }),
        ],
        validFor: /^[\w$]*$/,
      }
    }
    return null
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
      return null
    }
    if (!/^\s*[\w$]*$/.test(before)) return null
    if (!word || (word.from === word.to && !context.explicit)) return null
    const present = presentKeys(state, call.block)
    const options: Completion[] = []
    if (call.kind === 'class') {
      for (const attr of classes[call.className!]!.attrs) if (!present.has(attr.name)) options.push(attrCompletion(attr))
    } else {
      const className = model?.objects.find((o) => o.name === call.objectName)?.className
      const allowed = VERB_ATTRS[call.verb!]
      if (className) {
        for (const attr of classes[className]!.attrs) {
          if (!attr.animatable || present.has(attr.name)) continue
          if (allowed && !allowed.includes(attr.name)) continue
          options.push(attrCompletion(attr))
        }
      }
      for (const key of TIMING_KEYS) if (!present.has(key) && timingApplies(key, call.verb!)) options.push(timingCompletion(key))
    }
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }

  // A statement start: a new object, or an object to act on.
  if (/^\s*[\w$]*$/.test(before)) {
    if (!word || (word.from === word.to && !context.explicit)) return null
    const options: Completion[] = Object.keys(classes).map(classSnippet)
    for (const obj of model?.objects ?? []) options.push({ label: obj.name, type: 'variable', detail: obj.className, apply: `${obj.name}.` })
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }
  return null
}
