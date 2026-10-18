import type { Action, BlockInfo, ClassAction, SceneModel, SceneObject, TimeRef } from './types'

/**
 * What a block refers to, as written, for the link marks on clips and rows (D169): an action's
 * `at: slide.end` is a time link; an object's `x: () => box.x + 20` is a value link.
 */
export interface LinkInfo {
  key: string
  /** The reference as written, or for a value link the expression after the arrow. */
  text: string
  /** A time reference, a value that follows something, or a value that is code of its own, such as a shape from a formula or a custom ease (D226). */
  kind: 'time' | 'value' | 'code'
}

const TIME_KEYS = ['at', 'until', 'delay', 'duration']
/** A list of numbers, such as a path's points or an offset, written out: a literal, not code. */
const NUMBER_LIST = /^\[[\s\d.,+\-[\]]*\]$/
const VALUE_LINK = /^\(\s*\)\s*=>\s*/

/** The marks a block earns: its time references, its values that follow something, and its values that are code (D169, D226). */
function stmtLinks(stmt: BlockInfo | null | undefined): LinkInfo[] {
  if (!stmt) return []
  const out: LinkInfo[] = []
  for (const p of stmt.props) {
    if (p.kind === 'literal' || p.kind === 'range' || p.key === 'overrides') continue
    const raw = p.raw.trim()
    if (TIME_KEYS.includes(p.key)) out.push({ key: p.key, text: raw, kind: 'time' })
    else if (p.kind === 'function' && VALUE_LINK.test(raw)) out.push({ key: p.key, text: raw.replace(VALUE_LINK, ''), kind: 'value' })
    else if (!NUMBER_LIST.test(raw)) out.push({ key: p.key, text: raw, kind: 'code' })
  }
  return out
}

/** An action's time links, from its own statement or the class statement it follows. */
export function actionLinks(action: Action): LinkInfo[] {
  return stmtLinks(action.stmt ?? action.classAction?.stmt)
}

export function classActionLinks(classAction: ClassAction): LinkInfo[] {
  return stmtLinks(classAction.stmt)
}

/** An object's links: when it begins and ends, when those are references, and every attribute written as a link. */
export function objectLinks(obj: SceneObject): LinkInfo[] {
  if (!obj.decl) return []
  const out: LinkInfo[] = []
  for (const p of obj.decl.props) {
    if (p.kind === 'literal' || p.kind === 'range') continue
    const raw = p.raw.trim()
    if (p.key === 'at' || p.key === 'until') out.push({ key: p.key, text: raw, kind: 'time' })
    else if (p.kind === 'function' && VALUE_LINK.test(raw)) out.push({ key: p.key, text: raw.replace(VALUE_LINK, ''), kind: 'value' })
    else if (!NUMBER_LIST.test(raw) && p.key !== 'class' && p.key !== 'members') out.push({ key: p.key, text: raw, kind: 'code' })
  }
  return out
}

/** The key an action's, a class action's, or an object's dependents are listed under. */
export function targetKey(target: { action: Action } | { classAction: ClassAction } | { object: SceneObject }): string {
  if ('action' in target) return target.action.classAction ? `class:${target.action.classAction.id}` : `action:${target.action.id}`
  if ('classAction' in target) return `class:${target.classAction.id}`
  return `object:${target.object.name}`
}

function isRef(value: unknown): value is TimeRef {
  return typeof value === 'object' && value !== null && (value as TimeRef).__timeRef === true
}

/**
 * Who refers to each timing, by target key: labels such as "dot.fade starts at its end", for the
 * mark on the thing referred to (D169).
 */
export function dependentsByTarget(model: SceneModel): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (key: string, label: string): void => {
    const list = out.get(key) ?? []
    if (!list.includes(label)) list.push(label)
    out.set(key, list)
  }
  const keysOf = (ref: TimeRef): string[] => {
    if (ref.kind === 'objectStart' || ref.kind === 'objectEnd' || ref.kind === 'state') return ref.object ? [`object:${ref.object.name}`] : []
    if (ref.kind === 'forward') {
      const name = ref.forward?.name
      if (!name) return []
      if (model.objects.some((o) => o.name === name)) return [`object:${name}`]
      const classAction = model.classActions.find((c) => c.name === name)
      if (classAction) return [`class:${classAction.id}`]
      const action = model.actions.find((a) => a.name === name)
      return action ? [`action:${action.id}`] : []
    }
    const classActions = new Set(ref.actions.map((a) => a.classAction).filter((c): c is ClassAction => !!c))
    if (classActions.size > 0) return [...classActions].map((c) => `class:${c.id}`)
    return ref.actions.map((a) => `action:${a.id}`)
  }
  const partOf = (ref: TimeRef): string => {
    if (ref.kind === 'state' && ref.state) {
      // "when it stops moving right, the 2nd time" (D212).
      const s = ref.state
      const what = `${s.name === 'fadingIn' ? 'fading in' : s.name === 'fadingOut' ? 'fading out' : s.name}${s.direction ? ` ${s.direction}` : ''}`
      const which = s.index === 'last' ? ', the last time' : s.index > 1 ? `, time ${s.index}` : ''
      if (s.part === 'start') return `when it starts ${what}${which}`
      if (s.part === 'end') return `when it stops ${what}${which}`
      return `${Math.round((ref.fraction ?? 0) * 100)}% into ${what}${which}`
    }
    const part = ref.kind === 'forward' ? ref.forward?.part : ref.kind === 'objectStart' ? 'start' : ref.kind === 'objectEnd' ? 'end' : ref.kind
    if (part === 'start') return 'its start'
    if (part === 'end') return 'its end'
    return `${Math.round((ref.fraction ?? 0) * 100)}% of it`
  }
  for (const action of model.actions) {
    if (action.overridden) continue
    const label = action.classAction ? `all('${action.classAction.className}').${action.verb}` : `${action.name ? `${action.name}, ` : ''}${action.object.name}.${action.verb}`
    for (const [key, word] of [
      ['at', 'starts at'],
      ['until', 'ends at'],
    ] as const) {
      const ref = action.timing[key]
      if (!isRef(ref)) continue
      for (const k of keysOf(ref)) add(k, `${label} ${word} ${partOf(ref)}`)
    }
  }
  for (const obj of model.objects) {
    for (const [key, word] of [
      ['at', 'begins at'],
      ['until', 'is removed at'],
    ] as const) {
      const ref = obj.attrs[key]
      if (!isRef(ref)) continue
      for (const k of keysOf(ref)) add(k, `${obj.name} ${word} ${partOf(ref)}`)
    }
  }
  return out
}
