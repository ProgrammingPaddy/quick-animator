import { applyEdits, beginGesture, endGesture } from '../code/editor'
import { formatNumber, insertDeclaration, type TextEdit } from '../model/edits'
import { groupCarries } from '../model/groups'
import { parseScene } from '../model/parse'
import { flattenPathData, hasPathData, parsePathData, pathDataBounds } from '../model/pathData'
import { classes, GROUP, VERB_NAMES } from '../model/registry'
import { renameMembers, replaceIdentifiers } from '../model/rename'
import { positionAt } from '../model/sample'
import type { BlockInfo, SceneModel, SceneObject } from '../model/types'
import { OBJECT_KINDS, useStore, type PresetItem, type UserPreset } from '../state/store'
import { applyClasses, freeName, roundSeconds } from './operations'

/**
 * Presets of the user's own (D227): right-click an animation, an object, a group, or a class and
 * save it under a name. An animation keeps its block as written, without what placed it in time;
 * an object keeps its declaration and its own animations, without where it was and when it lived,
 * its class names included; a group keeps everything it carries, placed as it was around its
 * middle; a class keeps its statements. They live with the app, for every project, and the
 * Presets pane lists them under Yours, where they drag and click like the built-in ones.
 */

/** What an animation leaves behind when saved: its place in time, and a class statement it overrode. */
const PLACING = new Set(['at', 'until', 'delay', 'overrides'])
/** What an object leaves behind: where it is and when it exists. A group keeps its x and y, which shift its members. */
const PLACE_AND_LIFE = new Set(['x', 'y', 'at', 'until', 'imported'])
const LIFE = new Set(['at', 'until', 'imported'])
const CLASS_NAMES: ReadonlySet<string> = new Set(Object.keys(classes))

/** An identifier for a preset's label, for the names it writes: its words run together, the first lower-case, letters and digits only; `preset` when nothing is left. */
export function presetIdent(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0)
  const joined = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('')
  const ident = /^\d/.test(joined) ? `p${joined}` : joined
  return ident || 'preset'
}

/** A block's properties as written, one per line at the block's indent, all but the keys given. */
function propLines(source: string, block: BlockInfo, skip: Set<string>): string[] {
  return block.props.filter((p) => !skip.has(p.key)).map((p) => `  ${source.slice(p.range.from, p.range.to).trim()},`)
}

function newId(): string {
  return `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** A statement's `at` and `until`, when they are plain numbers, moved by `delta` seconds; references and code stay. */
function shiftTimes(text: string, delta: number): string {
  if (delta === 0) return text
  const parsed = parseScene(text, CLASS_NAMES, VERB_NAMES)
  const edits: TextEdit[] = []
  for (const block of [...parsed.decls, ...parsed.actions]) {
    for (const prop of block.props) {
      if (!LIFE.has(prop.key) || prop.kind !== 'literal') continue
      const value = Number(prop.raw.trim())
      if (!Number.isFinite(value)) continue
      edits.push({ from: prop.valueRange.from, to: prop.valueRange.to, insert: formatNumber(roundSeconds(value + delta)) })
    }
  }
  let out = text
  for (const edit of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  return out
}

/** The literal values an object's look is drawn from, for its picture in the pane. */
function lookOf(obj: SceneObject): UserPreset['look'] {
  const look: NonNullable<UserPreset['look']> = {}
  for (const key of ['width', 'height', 'radius', 'fontSize'] as const) {
    const v = obj.attrs[key]
    if (typeof v === 'number') look[key] = v
  }
  for (const key of ['fill', 'text'] as const) {
    const v = obj.attrs[key]
    if (typeof v === 'string') look[key] = v
  }
  const points = obj.attrs['points']
  if (Array.isArray(points)) look.points = points
  // A path shape's picture is the line it draws (D238).
  const d = obj.attrs['d']
  if (hasPathData(d)) look.points = flattenPathData(parsePathData(d)).flatMap((sp) => sp.points.map((p) => [p.x, p.y]))
  return look
}

/** One declaration as a preset item: its props without what places it, where it was, its life against the base, and its own animations with their times against the base. */
function itemOf(source: string, obj: SceneObject, base: number): PresetItem {
  const decl = obj.decl!
  const isGroup = obj.className === GROUP
  const number = (key: string): number | null => (typeof obj.attrs[key] === 'number' ? (obj.attrs[key] as number) : null)
  return {
    name: obj.name,
    className: obj.className,
    props: propLines(source, decl, isGroup ? LIFE : PLACE_AND_LIFE).join('\n'),
    x: isGroup ? null : (number('x') ?? 0),
    y: isGroup ? null : (number('y') ?? 0),
    at: roundSeconds(obj.at - base),
    until: obj.until === null ? null : roundSeconds(obj.until - base),
    actions: obj.actions.filter((a) => a.stmt && !a.classAction).map((a) => ({ text: shiftTimes(source.slice(a.stmt!.range.from, a.stmt!.range.to), -base), name: a.name })),
  }
}

/** The drawn size of an object as declared, for its ghost. */
function sizeOf(obj: SceneObject): { width: number; height: number } {
  const num = (key: string): number => (typeof obj.attrs[key] === 'number' ? (obj.attrs[key] as number) : 0)
  const d = obj.attrs['d']
  if (hasPathData(d)) {
    const box = pathDataBounds(parsePathData(d))
    return { width: Math.max(1, box.width), height: Math.max(1, box.height) }
  }
  const points = obj.attrs['points']
  if (Array.isArray(points) && points.length > 0) {
    const xs = points.map((p) => (typeof p[0] === 'number' ? p[0] : 0))
    const ys = points.map((p) => (typeof p[1] === 'number' ? p[1] : 0))
    return { width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) }
  }
  if (num('radius') > 0) return { width: num('radius') * 2, height: num('radius') * 2 }
  if (num('width') > 0 || num('height') > 0) return { width: num('width'), height: num('height') }
  const fontSize = num('fontSize') || 48
  return { width: fontSize * 0.55 * String(obj.attrs['text'] ?? 'Text').length, height: fontSize * 1.2 }
}

/** The box around objects as declared, whenever each exists: its middle is what a group is placed around, its size the group's ghost. */
function declaredBox(model: SceneModel, objects: SceneObject[]): { x: number; y: number; width: number; height: number } {
  if (objects.length === 0) return { x: 0, y: 0, width: 240, height: 140 }
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const o of objects) {
    const p = positionAt(model, o, o.at)
    const size = sizeOf(o)
    left = Math.min(left, p.x - size.width / 2)
    right = Math.max(right, p.x + size.width / 2)
    bottom = Math.min(bottom, p.y - size.height / 2)
    top = Math.max(top, p.y + size.height / 2)
  }
  return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom }
}


export type SaveTarget = { object: string; index?: number } | { className: string }

/** Ask for a name and save an animation, an object, a group, or a class as a preset of the user's own (D227). */
export function requestSavePreset(target: SaveTarget): void {
  const s = useStore.getState()
  const model = s.model && s.model.source === s.source ? s.model : null
  if (!model) return
  let suggested: string
  if ('className' in target) {
    if (!model.classActions.some((c) => c.className === target.className && c.stmt) && !model.classes.has(target.className)) return
    suggested = target.className
  } else {
    const obj = model.objects.find((o) => o.name === target.object)
    if (!obj?.decl) return
    const action = target.index !== undefined ? obj.actions[target.index] : undefined
    if (target.index !== undefined && (!action?.stmt || action.classAction)) return
    if (target.index === undefined && obj.className !== GROUP && !(OBJECT_KINDS as readonly string[]).includes(obj.className)) return
    suggested = action ? (action.name ?? `${obj.name} ${action.verb}`) : obj.name
  }
  const taken = new Set(s.userPresets.map((p) => p.label.trim().toLowerCase()))
  s.openDialog({
    title: 'Save as preset',
    input: { label: 'Name', value: suggested, validate: (value) => (value.trim() === '' ? 'Give it a name' : taken.has(value.trim().toLowerCase()) ? 'One of your presets has this name' : null) },
    confirmLabel: 'Save',
    onConfirm: (label) => {
      const preset = build(target, label.trim())
      if (preset) {
        const fresh = useStore.getState()
        fresh.setUserPresets([...fresh.userPresets, preset])
      }
    },
  })
}

/** The preset for a target, from the scene as it stands. */
function build(target: SaveTarget, label: string): UserPreset | null {
  const s = useStore.getState()
  const model = s.model && s.model.source === s.source ? s.model : null
  if (!model) return null
  const source = s.source
  if ('className' in target) {
    const statements = model.classActions.filter((c) => c.className === target.className && c.stmt).map((c) => source.slice(c.stmt!.range.from, c.stmt!.range.to))
    return { id: newId(), kind: 'class', label, className: target.className, statements }
  }
  const obj = model.objects.find((o) => o.name === target.object)
  if (!obj?.decl) return null
  if (target.index !== undefined) {
    const action = obj.actions[target.index]
    if (!action?.stmt) return null
    const span = Math.max(0, action.end - action.start)
    const lines = propLines(source, action.stmt, PLACING)
    if (!action.stmt.props.some((p) => p.key === 'duration')) lines.push(`  duration: ${formatNumber(roundSeconds(span))},`)
    return { id: newId(), kind: 'animation', label, verb: action.verb, duration: roundSeconds(span), propsText: lines.join('\n') }
  }
  if (obj.className === GROUP) {
    // Everything the group carries, members before the groups that list them, then the group itself; placed around the middle of its members as declared, whenever each exists, timed from the earliest of them.
    const carried = groupCarries(model, obj.name)
      .map((name) => model.objects.find((o) => o.name === name))
      .filter((o): o is SceneObject => !!o?.decl)
    const objects = carried.filter((o) => o.className !== GROUP)
    const base = objects.length > 0 ? Math.min(...objects.map((o) => o.at)) : 0
    const box = declaredBox(model, objects)
    const ordered = [...objects, ...carried.filter((o) => o.className === GROUP), obj]
    return { id: newId(), kind: 'group', label, items: ordered.map((o) => itemOf(source, o, base)), origin: { x: box.x, y: box.y }, size: { width: box.width, height: box.height } }
  }
  const here = positionAt(model, obj, obj.at)
  return { id: newId(), kind: 'object', label, className: obj.className, items: [itemOf(source, obj, obj.at)], origin: { x: here.x, y: here.y }, size: sizeOf(obj), look: lookOf(obj) }
}

export function deleteUserPreset(id: string): void {
  const s = useStore.getState()
  s.setUserPresets(s.userPresets.filter((p) => p.id !== id))
}

/**
 * Add a saved object or group at a place, at the playhead or a time (D227): its declarations go
 * after the last one and its animations at the end, placed around the point, timed from the time,
 * each named after the preset or after itself when that name is free, else numbered, with every
 * reference among them following. Returns the main name.
 */
export function addUserObject(preset: UserPreset, x: number, y: number, at?: number): string | null {
  const s = useStore.getState()
  const model = s.model && s.model.source === s.source ? s.model : null
  const items = preset.items ?? []
  if (!model || (preset.kind !== 'object' && preset.kind !== 'group') || items.length === 0) return null
  const when = roundSeconds(at ?? s.time)
  const origin = preset.origin ?? { x: 0, y: 0 }
  const main = items[items.length - 1]!
  // The main thing takes the preset's name; the rest keep their own; nothing collides, within the batch either.
  const renames: Record<string, string> = {}
  const taken = new Set<string>()
  const pick = (base: string): string => {
    let name = freeName(base)
    let n = 2
    while (taken.has(name)) name = `${base}${n++}`
    taken.add(name)
    return name
  }
  renames[main.name] = pick(presetIdent(preset.label))
  for (const item of items) if (!(item.name in renames)) renames[item.name] = pick(item.name)
  for (const item of items) for (const a of item.actions) if (a.name && !(a.name in renames)) renames[a.name] = pick(a.name)
  const length = s.prefs.objectLength
  const decls = items.map((item) => {
    const lines: string[] = []
    if (item.x !== null && item.y !== null) lines.push(`  x: ${formatNumber(Math.round(x + item.x - origin.x))},`, `  y: ${formatNumber(Math.round(y + item.y - origin.y))},`)
    if (item.props) lines.push(item.props)
    const begins = roundSeconds(when + item.at)
    if (item.className !== GROUP) {
      if (begins > 0) lines.push(`  at: ${formatNumber(begins)},`)
      // Its own life when it had one; else as long as a new object lasts (D145).
      const until = item.until !== null ? roundSeconds(when + item.until) : length !== null ? roundSeconds(begins + length) : null
      if (until !== null) lines.push(`  until: ${formatNumber(until)},`)
    }
    return renameMembers(replaceIdentifiers(`${item.name} = ${item.className}({\n${lines.join('\n')}\n})`, renames), renames)
  })
  const actions = items.flatMap((item) => item.actions.map((a) => replaceIdentifiers(shiftTimes(a.text, when), renames)))
  const edits: TextEdit[] = [insertDeclaration(model.lastDeclEnd, decls.join('\n\n'))]
  if (actions.length > 0) {
    const trimmed = s.source.replace(/\s+$/, '')
    edits.push({ from: trimmed.length, to: s.source.length, insert: `${trimmed.length === 0 ? '' : '\n\n'}${actions.join('\n\n')}\n` })
  }
  applyEdits(edits, { selection: [renames[main.name]!], selectedActions: [] })
  return renames[main.name]!
}

/** Give objects a saved class (D227): the class name goes into each, and the class's statements into the file when it has none for that class yet. */
export function applyClassPreset(preset: UserPreset, names: string[]): void {
  const s = useStore.getState()
  const model = s.model && s.model.source === s.source ? s.model : null
  if (!model || preset.kind !== 'class' || !preset.className || names.length === 0) return
  beginGesture()
  try {
    applyClasses(names, [preset.className], [])
    const fresh = useStore.getState()
    const has = fresh.model?.classActions.some((c) => c.className === preset.className && c.stmt)
    const statements = preset.statements ?? []
    if (!has && statements.length > 0) {
      const trimmed = fresh.source.replace(/\s+$/, '')
      applyEdits([{ from: trimmed.length, to: fresh.source.length, insert: `${trimmed.length === 0 ? '' : '\n\n'}${statements.join('\n\n')}\n` }])
    }
  } finally {
    endGesture()
  }
}
