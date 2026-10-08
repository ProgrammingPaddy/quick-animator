import { applyEdits, scrollToPos } from '../code/editor'
import { findDependents, type Dependent } from '../model/dependents'
import { appendStatement, blockText, formatNumber, insertDeclaration, removeProp, removeStatements, setProp, type TextEdit } from '../model/edits'
import { isMember } from '../model/evaluate'
import { memberRef } from '../model/groups'
import { classes, VERB_ATTRS, type AttrValue, type Verb } from '../model/registry'
import { identifierEdits, nameProblem, replaceIdentifiers } from '../model/rename'
import { definingAction, valueAt } from '../model/sample'
import type { Action, ActionInfo, ClassAction, Range, SceneModel, SceneObject } from '../model/types'
import { useStore, type ActionRef, type Clip, type ClipAction, type ClipObject, type Pin, type SelectionState, type Tool } from '../state/store'

/**
 * Every GUI gesture that changes the scene ends here as a minimal text edit (decision D24). The
 * edit goes through the editor, which re-evaluates the model and records the undo step. The
 * editor updates synchronously, so an operation can build on the one before it. When an edit
 * changes what is selected, the selection travels in the same step (D90).
 */

export const RESIZE_ATTRS = ['width', 'height', 'radius', 'fontSize']

/**
 * The current text and the model that describes it. While the text has an error, the last good
 * model describes older text, so its positions cannot be trusted and GUI edits are refused.
 */
function state(): { source: string; model: SceneModel | null; fps: number; time: number } {
  const s = useStore.getState()
  const model = s.model && s.model.source === s.source ? s.model : null
  return { source: s.source, model, fps: s.settings.fps, time: s.time }
}

/** True when the preview and timeline may edit the code right now. */
export function canEdit(): boolean {
  return state().model !== null
}

function findObject(name: string): SceneObject | null {
  return state().model?.objects.find((o) => o.name === name) ?? null
}

const objectsSelected = (names: string[]): SelectionState => ({ selection: names, selectedActions: [] })
const actionSelected = (object: string, index: number): SelectionState => ({ selection: [object], selectedActions: [{ object, index }] })

/** Every name in use: objects, named actions, and named class actions. */
function takenNames(model: SceneModel): Set<string> {
  const taken = new Set<string>()
  for (const obj of model.objects) {
    taken.add(obj.name)
    for (const action of obj.actions) if (action.name) taken.add(action.name)
  }
  for (const classAction of model.classActions) if (classAction.name) taken.add(classAction.name)
  return taken
}

function uniqueName(base: string, from = 1): string {
  const { model } = state()
  const taken = model ? takenNames(model) : new Set<string>()
  let n = from
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

/** How a written number is rounded: whole pixels, tenths of a degree, hundredths for factors. */
function roundAttr(attr: string, value: number): number {
  if (attr === 'scale' || attr === 'opacity') return Math.round(value * 100) / 100
  if (attr === 'rotation') return Math.round(value * 10) / 10
  return Math.round(value)
}

/** Seconds as written: thousandths, or ten-thousandths under a tenth, so a frame's length survives. */
export function roundSeconds(v: number): number {
  const digits = Math.abs(v) < 0.1 ? 10000 : 1000
  return Math.round(v * digits) / digits
}

/**
 * The shortest duration written: one frame, as a touch under the frame's length, so the end
 * lands on the next frame and never between frames, where it would show two frames of change
 * (D110).
 */
export function frameSeconds(fps: number): number {
  return Math.floor((1 / fps) * 10000) / 10000
}

/** The dimension attributes the GUI writes for a class of object: width and height when it has them, else what it has. */
export function resizeAttrs(className: string): string[] {
  const has = (a: string) => classes[className]?.attrs.some((s) => s.name === a)
  if (has('width') && has('height')) return ['width', 'height']
  return RESIZE_ATTRS.filter(has)
}

/** The verb that reads best for a set of changing attributes: a move, a turn, a resize, or `to`. */
export function verbFor(attrs: string[]): Verb {
  const set = new Set(attrs)
  if (set.size > 0 && [...set].every((a) => a === 'x' || a === 'y' || a === 'z')) return 'move'
  if (set.size === 1 && set.has('rotation')) return 'rotate'
  if (set.size === 1 && set.has('scale')) return 'scale'
  if (set.size === 1 && set.has('opacity')) return 'fade'
  if (set.size > 0 && [...set].every((a) => RESIZE_ATTRS.includes(a))) return 'resize'
  return 'to'
}

/**
 * The dimension attributes of an object after scaling its drawn size by factors along the
 * gizmo's axes: width and height follow each axis, so a circle pulled on one side becomes an
 * oval (D106); a Text's font size follows whichever axis changed more.
 */
export function resizedValues(className: string, base: Record<string, number>, fx: number, fy: number): Record<string, number> {
  const uniform = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy
  if (className === 'Rect' || className === 'Circle') return { width: (base['width'] ?? 0) * fx, height: (base['height'] ?? 0) * fy }
  if (className === 'Text') return { fontSize: (base['fontSize'] ?? 0) * uniform }
  return {}
}

/** Place a new object at a world position. Returns its name. */
export function addObject(className: Exclude<Tool, 'select'>, x: number, y: number): string | null {
  const { model } = state()
  if (!model) return null
  const name = uniqueName(className.toLowerCase())
  const attrs: Record<string, AttrValue> = { x: Math.round(x), y: Math.round(y) }
  if (className === 'Rect') Object.assign(attrs, { width: 240, height: 140, fill: '#4f8cff' })
  if (className === 'Circle') Object.assign(attrs, { radius: 60, fill: '#f59e0b' })
  if (className === 'Text') Object.assign(attrs, { text: 'Text', fontSize: 48, fill: '#ffffff' })
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = ${className}`, attrs))], objectsSelected([name]))
  return name
}

/**
 * Make an attribute end up at this value by editing whatever defines it at this time: the
 * action that most recently started changing it gets the value as its end state, written
 * directly (D102); otherwise the declaration gets it. A relative action's change is measured
 * from where the object is when the action starts. Returns null when locked.
 */
function editFor(name: string, attr: string, value: number, time: number): TextEdit | null {
  const { source, model } = state()
  if (!model) return null
  const obj = model.objects.find((o) => o.name === name)
  if (!obj) return null
  const action = definingAction(model, obj, attr, time)
  if (action) {
    if (!action.stmt || action.classAction || typeof action.changes[attr] !== 'number') return null
    let written = value
    if (action.timing.relative) {
      const before = valueAt(model, obj, attr, action.start)
      if (typeof before !== 'number') return null
      written = value - before
    }
    return setProp(source, action.stmt, attr, roundAttr(attr, written))
  }
  if (!obj.decl || typeof obj.attrs[attr] === 'function') return null
  return setProp(source, obj.decl, attr, roundAttr(attr, value))
}

/**
 * The object's own actions still running at this time that define any of these attributes: a
 * drag then edits their end states, and the preview shows the end (D102).
 */
export function inProgressActions(names: string[], attrs: string[], time: number): ActionRef[] {
  const { model } = state()
  const refs: ActionRef[] = []
  if (!model) return refs
  for (const name of names) {
    const obj = model.objects.find((o) => o.name === name)
    if (!obj) continue
    for (const attr of attrs) {
      const action = definingAction(model, obj, attr, time)
      if (!action?.stmt || action.classAction || time >= action.end) continue
      const index = obj.actions.indexOf(action)
      if (!refs.some((r) => r.object === name && r.index === index)) refs.push({ object: name, index })
    }
  }
  return refs
}

/**
 * A plain drag or nudge: these objects have these values at this time, in one step. When a
 * class action defines one of the values right now, the object first overrides it with its own
 * action, which is what then gets edited (D80).
 */
export function setAttrsAtMany(entries: { name: string; attrs: Record<string, number> }[], time: number): boolean {
  const { model } = state()
  if (model) {
    const done = new Set<ClassAction>()
    for (const { name, attrs } of entries) {
      const obj = model.objects.find((o) => o.name === name)
      if (!obj) continue
      for (const attr of Object.keys(attrs)) {
        const action = definingAction(model, obj, attr, time)
        if (!action?.classAction || !action.stmt || done.has(action.classAction)) continue
        done.add(action.classAction)
        overrideClassAction(name, obj.actions.indexOf(action))
      }
    }
  }
  const edits: TextEdit[] = []
  for (const { name, attrs } of entries) {
    for (const [attr, value] of Object.entries(attrs)) {
      const edit = editFor(name, attr, value, time)
      if (edit) edits.push(edit)
    }
  }
  applyEdits(edits)
  return edits.length > 0
}

export function setAttrsAt(name: string, attrs: Record<string, number>, time: number): boolean {
  return setAttrsAtMany([{ name, attrs }], time)
}

export function setPositionAt(name: string, x: number, y: number, time: number): boolean {
  return setAttrsAt(name, { x, y }, time)
}

/** Arrow keys: move objects by whole pixels at the playhead (D95). */
export function nudgeObjects(names: string[], dx: number, dy: number): void {
  const { model, time } = state()
  if (!model) return
  const entries = names.flatMap((name) => {
    const obj = model.objects.find((o) => o.name === name)
    if (!obj?.decl) return []
    const x = valueAt(model, obj, 'x', time)
    const y = valueAt(model, obj, 'y', time)
    return [{ name, attrs: { x: (typeof x === 'number' ? x : 0) + dx, y: (typeof y === 'number' ? y : 0) + dy } }]
  })
  setAttrsAtMany(entries, time)
}

/**
 * A drag while an action is selected: the action's destination follows the pointer. For a
 * relative action the written change is the distance from where the object is when the action
 * starts (D70). A `resize` asked to move as well becomes a `to`, since only `to` changes both
 * the size and the position (D104).
 */
export function setActionDestination(name: string, index: number, destination: Record<string, number>): boolean {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const action = obj?.actions[index]
  if (!model || !obj || !action?.stmt || action.classAction) return false
  const edits: TextEdit[] = []
  const stmt = action.stmt
  const schema = classes[obj.className]
  const wantsPosition = ('x' in destination || 'y' in destination) && !('x' in action.changes) && !('y' in action.changes)
  if (action.verb === 'resize' && wantsPosition) {
    const head = source.slice(stmt.range.from, stmt.propsOpen)
    const at = head.lastIndexOf('.resize(')
    if (at >= 0) {
      edits.push({ from: stmt.range.from + at + 1, to: stmt.range.from + at + 1 + 'resize'.length, insert: 'to' })
      for (const attr of ['x', 'y']) if (attr in destination && schema?.attrs.some((a) => a.name === attr)) edits.push(setProp(source, stmt, attr, roundAttr(attr, destination[attr]!)))
    }
  }
  for (const [attr, value] of Object.entries(destination)) {
    if (!(attr in action.changes) || typeof action.changes[attr] === 'function') continue
    let written = value
    if (action.timing.relative) {
      const before = valueAt(model, obj, attr, action.start)
      if (typeof before !== 'number') continue
      written = value - before
    }
    edits.push(setProp(source, action.stmt, attr, roundAttr(attr, written)))
  }
  applyEdits(edits)
  return edits.length > 0
}

/**
 * Shift-drag begins: add an action changing these attributes from where the object is now,
 * pinned to the playhead (D27, D79, D103): with `start` it starts here and lasts a second, and
 * the playhead moves to its end so the result is seen; with `end` it ends here, starting a
 * second earlier, and the playhead stays. The verb follows the attributes: a move, a turn, a
 * resize, or `to`.
 */
export function beginTimed(name: string, attrs: string[], pin: Pin = 'start'): boolean {
  const { source, model, time, fps } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return false
  const present = attrs.filter((a) => classes[obj.className]?.attrs.some((s) => s.name === a))
  if (present.length === 0) return false
  const verb = verbFor(present)
  const now = roundSeconds(time)
  const endHere = pin === 'end' && now >= frameSeconds(fps)
  const at = endHere ? roundSeconds(Math.max(0, now - 1)) : now
  const duration = endHere ? roundSeconds(now - at) : 1
  const block: Record<string, AttrValue> = {}
  for (const attr of present) {
    const value = valueAt(model, obj, attr, time)
    block[attr] = roundAttr(attr, typeof value === 'number' ? value : 0)
  }
  block['at'] = at
  block['duration'] = duration
  const index = obj.actions.length
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, block))], actionSelected(name, index))
  if (!endHere) useStore.getState().setTime(at + duration)
  return true
}

export function beginMove(name: string): boolean {
  return beginTimed(name, ['x', 'y'])
}

/** Update the target of the object's last own action, while a shift-drag continues. */
export function setLastActionTarget(name: string, attrs: Record<string, number>): void {
  const obj = findObject(name)
  const index = obj ? obj.actions.map((a, i) => (a.stmt && !a.classAction ? i : -1)).filter((i) => i >= 0).pop() : undefined
  if (obj && index !== undefined) setActionValues(name, index, attrs)
}

/** Write values into an action's block: the targets of the change. Only attributes the action has. */
export function setActionValues(name: string, index: number, values: Record<string, number>): void {
  const { source } = state()
  const action = findObject(name)?.actions[index]
  if (!action?.stmt) return
  const stmt = action.stmt
  const edits = Object.entries(values)
    .filter(([key]) => key in action.changes)
    .map(([key, value]) => setProp(source, stmt, key, roundAttr(key, value)))
  applyEdits(edits)
}

/** Write values into a class action's block, for every member. */
export function setClassActionValues(id: number, values: Record<string, number>): void {
  const { source, model } = state()
  const stmt = model?.classActions[id]?.stmt
  if (!stmt) return
  applyEdits(Object.entries(values).map(([key, value]) => setProp(source, stmt, key, roundAttr(key, value))))
}

/** The values an action of a kind starts with: the object's current ones, so nothing jumps. */
function startingValues(model: SceneModel, obj: SceneObject, verb: Verb, time: number): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = {}
  const allowed = VERB_ATTRS[verb]
  if (!allowed) return attrs
  const schema = classes[obj.className]
  for (const attr of allowed) {
    const def = schema?.attrs.find((a) => a.name === attr)
    if (!def || attr === 'z') continue
    const value = valueAt(model, obj, attr, time)
    attrs[attr] = typeof value === 'number' ? roundAttr(attr, value) : value
  }
  return attrs
}

/** Add an action of a kind at a time. Its values start as the object's current ones, so nothing jumps. */
export function addAction(name: string, verb: Verb, time: number): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const attrs = startingValues(model, obj, verb, time)
  attrs['at'] = roundSeconds(time)
  attrs['duration'] = 1
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, attrs))], actionSelected(name, obj.actions.length))
}

/** Add an action for every member of a class at a time, written once as `all('name').verb` (D80). */
export function addClassAction(className: string, verb: Verb, time: number): void {
  const { source, model } = state()
  const first = model?.objects.find((o) => isMember(o, className))
  if (!model || !first) return
  const attrs = startingValues(model, first, verb, time)
  attrs['at'] = roundSeconds(time)
  attrs['duration'] = 1
  applyEdits([appendStatement(source, blockText(`all('${className}').${verb}`, attrs))], actionSelected(first.name, first.actions.length))
}

/** Make the object exist from here: base opacity 0, then a fade to 1 at this time, or a pop with `instant`. */
export function appearHere(name: string, time: number, instant = false): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const edits: TextEdit[] = []
  const base = obj.decl.props.find((p) => p.key === 'opacity')
  if (!base || base.raw.trim() !== '0') edits.push(setProp(source, obj.decl, 'opacity', 0))
  edits.push(appendStatement(source, blockText(`${name}.fade`, { opacity: 1, at: roundSeconds(time), duration: instant ? frameSeconds(state().fps) : 0.3 })))
  applyEdits(edits, actionSelected(name, obj.actions.length))
}

/**
 * Make the object stop existing from here: a fade to 0 at this time, or a pop with `instant`.
 * Fading out something that has never been visible would fade from nothing, so in that case the
 * object is first made visible from the start (D71).
 */
export function disappearHere(name: string, time: number, instant = false): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const edits: TextEdit[] = []
  const now = valueAt(model, obj, 'opacity', time)
  if (typeof now === 'number' && now <= 0) edits.push(setProp(source, obj.decl, 'opacity', 1))
  edits.push(appendStatement(source, blockText(`${name}.fade`, { opacity: 0, at: roundSeconds(time), duration: instant ? frameSeconds(state().fps) : 0.3 })))
  applyEdits(edits, actionSelected(name, obj.actions.length))
}

/** Every member of a class appears here: each base opacity 0, then one class fade to 1 (D93). */
export function appearClassHere(className: string, time: number, instant = false): void {
  const { source, model } = state()
  if (!model) return
  const members = model.objects.filter((o) => isMember(o, className) && o.decl)
  if (members.length === 0) return
  const edits: TextEdit[] = []
  for (const member of members) {
    const base = member.decl!.props.find((p) => p.key === 'opacity')
    if (!base || base.raw.trim() !== '0') edits.push(setProp(source, member.decl!, 'opacity', 0))
  }
  edits.push(appendStatement(source, blockText(`all('${className}').fade`, { opacity: 1, at: roundSeconds(time), duration: instant ? frameSeconds(state().fps) : 0.3 })))
  applyEdits(edits, actionSelected(members[0]!.name, members[0]!.actions.length))
}

/** Every member of a class disappears here with one class fade to 0; never-visible members first become visible (D71). */
export function disappearClassHere(className: string, time: number, instant = false): void {
  const { source, model } = state()
  if (!model) return
  const members = model.objects.filter((o) => isMember(o, className) && o.decl)
  if (members.length === 0) return
  const edits: TextEdit[] = []
  for (const member of members) {
    const now = valueAt(model, member, 'opacity', time)
    if (typeof now === 'number' && now <= 0) edits.push(setProp(source, member.decl!, 'opacity', 1))
  }
  edits.push(appendStatement(source, blockText(`all('${className}').fade`, { opacity: 0, at: roundSeconds(time), duration: instant ? frameSeconds(state().fps) : 0.3 })))
  applyEdits(edits, actionSelected(members[0]!.name, members[0]!.actions.length))
}

/** Move or resize a clip. `at` is the start without delay; `duration` the length. */
export function setActionTiming(name: string, index: number, timing: { at?: number; duration?: number }): void {
  const { source } = state()
  const action = findObject(name)?.actions[index]
  if (!action?.stmt || action.classAction) return
  const edits: TextEdit[] = []
  if (timing.at !== undefined) edits.push(setProp(source, action.stmt, 'at', roundSeconds(timing.at)))
  if (timing.duration !== undefined) edits.push(setProp(source, action.stmt, 'duration', roundSeconds(timing.duration)))
  applyEdits(edits)
}

/** Move or resize a class action's clip: the one statement every member follows. */
export function setClassActionTiming(id: number, timing: { at?: number; duration?: number }): void {
  const { source, model } = state()
  const classAction = model?.classActions[id]
  if (!classAction?.stmt) return
  const edits: TextEdit[] = []
  if (timing.at !== undefined) edits.push(setProp(source, classAction.stmt, 'at', roundSeconds(timing.at)))
  if (timing.duration !== undefined) edits.push(setProp(source, classAction.stmt, 'duration', roundSeconds(timing.duration)))
  applyEdits(edits)
}

/**
 * Retime several actions at once, in one step (D97): `shift` moves every start, `grow` adds to
 * every duration, `trimStart` moves the starts and keeps the ends. A class member retimes its
 * class statement, once. Durations never drop under one frame. Written time references are left
 * alone. With `from`, a snapshot of starts and ends taken when a drag began, the change is
 * measured from there, so a drag can keep sending its total.
 */
export function retimeActions(refs: ActionRef[], change: { shift?: number; grow?: number; trimStart?: number }, from?: Record<string, { start: number; end: number }>): void {
  const { source, model, fps } = state()
  if (!model) return
  const minimum = frameSeconds(fps)
  const edits: TextEdit[] = []
  const done = new Set<ActionInfo>()
  for (const ref of refs) {
    const action = model.objects.find((o) => o.name === ref.object)?.actions[ref.index]
    const stmt = action?.classAction ? action.classAction.stmt : action?.stmt
    if (!action || !stmt || action.overridden || done.has(stmt)) continue
    done.add(stmt)
    const atProp = stmt.props.find((p) => p.key === 'at')
    const untilProp = stmt.props.find((p) => p.key === 'until')
    const atLocked = !!atProp && atProp.kind !== 'literal'
    const delay = action.timing.delay ?? 0
    const origin = from?.[`${ref.object}:${ref.index}`] ?? { start: action.start, end: action.end }
    const duration = origin.end - origin.start
    const move = (change.shift ?? 0) + (change.trimStart ?? 0)
    if ((move !== 0 || from) && !atLocked) edits.push(setProp(source, stmt, 'at', roundSeconds(Math.max(0, origin.start + move - delay))))
    const grow = (change.grow ?? 0) - (change.trimStart ?? 0)
    if ((grow !== 0 || (from && change.grow !== undefined)) && !untilProp) edits.push(setProp(source, stmt, 'duration', roundSeconds(Math.max(minimum, duration + grow))))
  }
  applyEdits(edits)
}

/** Arrow keys: move the selected actions by whole frames (D95). */
export function nudgeActions(refs: ActionRef[], frames: number): void {
  retimeActions(refs, { shift: frames / state().fps })
}

/**
 * Shift and the wheel over the object: every selected action grows or shrinks by the same amount
 * (D97). With the start pinned the end moves; with the end pinned the start moves (D103).
 */
export function adjustDurations(refs: ActionRef[], seconds: number, pin: Pin = 'start'): void {
  if (pin === 'end') retimeActions(refs, { trimStart: -seconds })
  else retimeActions(refs, { grow: seconds })
}

/**
 * The text of a member's own block copied from a class statement: the same lines, with `at`
 * written in when the class statement had none (so the copy keeps its time), plus extra lines.
 */
function copiedBlock(source: string, stmt: ActionInfo, action: Action, extra: string[]): string {
  const props = source.slice(stmt.propsOpen, stmt.propsClose)
  const hasAt = stmt.props.some((p) => p.key === 'at')
  const lines = [...(hasAt ? [] : [`at: ${formatNumber(roundSeconds(action.start - (action.timing.delay ?? 0)))}`]), ...extra]
  if (props.includes('\n')) {
    let body = props.replace(/\s+$/, '')
    if (body.length > 0 && !/,$/.test(body)) body += ','
    const before = lines.length > 0 && !hasAt ? `\n${stmt.indent}${lines[0]},` : ''
    const after = (hasAt ? lines : lines.slice(1)).map((l) => `\n${stmt.indent}${l},`).join('')
    return `{${before}${body}${after}\n}`
  }
  const inner = props.trim().replace(/,$/, '')
  const parts = hasAt ? [inner, ...lines] : [lines[0]!, inner, ...lines.slice(1)]
  return `{ ${parts.filter(Boolean).join(', ')} }`
}

/**
 * Give one member its own action in place of a class action: the class action is named if it
 * has no name yet, and the member gets a copy of its block with `overrides: name`, which
 * switches the class action off for that object (D80). Returns the index of the new action.
 */
export function overrideClassAction(name: string, index: number): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const action = obj?.actions[index]
  const classAction = action?.classAction
  if (!model || !obj || !action || !classAction?.stmt) return null
  const existing = obj.actions.findIndex((a) => a.overrides === classAction)
  if (existing >= 0) return existing
  const stmt = classAction.stmt
  const edits: TextEdit[] = []
  let refName = classAction.name
  if (!refName) {
    refName = uniqueName(classAction.verb)
    edits.push({ from: stmt.range.from, to: stmt.range.from, insert: `${refName} = ` })
  }
  const newIndex = obj.actions.length
  edits.push(appendStatement(source, `${name}.${action.verb}(${copiedBlock(source, stmt, action, [`overrides: ${refName}`])})`))
  applyEdits(edits, actionSelected(name, newIndex))
  return newIndex
}

/**
 * Give one member a standalone copy of a class action, written after the class statement so it
 * takes over from its start while the class action still applies where the copy does not (D53).
 * Returns the index of the new action.
 */
export function materializeClassAction(name: string, index: number): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const action = obj?.actions[index]
  if (!model || !obj || !action?.classAction?.stmt) return null
  const newIndex = obj.actions.length
  applyEdits([appendStatement(source, `${name}.${action.verb}(${copiedBlock(source, action.classAction.stmt, action, [])})`)], actionSelected(name, newIndex))
  return newIndex
}

/** The index of an action the object owns: the one given, or its override of a class action. */
export function ownAction(name: string, index: number): number | null {
  const action = findObject(name)?.actions[index]
  if (!action) return null
  return action.classAction ? overrideClassAction(name, index) : index
}

/**
 * Edits that keep other statements valid when names disappear: a time reference becomes the
 * time it currently resolves to, and a link or an `overrides` falls back to nothing (D72).
 */
function resolutionEdits(model: SceneModel, source: string, dependents: Dependent[]): TextEdit[] {
  const edits: TextEdit[] = []
  for (const dep of dependents) {
    const owner = model.objects.find((o) => o.name === dep.owner)
    const action = dep.index !== null ? owner?.actions[dep.index] : undefined
    if ((dep.key === 'at' || dep.key === 'until') && action) {
      const literal = dep.key === 'at' ? action.start - (action.timing.delay ?? 0) : action.end
      edits.push(setProp(source, dep.block, dep.key, roundSeconds(literal)))
      continue
    }
    const removal = removeProp(source, dep.block, dep.key)
    if (removal) edits.push(removal)
  }
  return edits
}

function confirmRemoval(title: string, dependents: Dependent[], run: () => void): void {
  if (dependents.length === 0) {
    run()
    return
  }
  useStore.getState().openDialog({
    title,
    message: 'These refer to it. Time references keep the time they resolve to now; links and overrides fall back to nothing.',
    items: dependents.map((d) => d.label),
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: run,
  })
}

/** Remove objects with every action they have, after confirming when other code refers to them. */
export function deleteObjects(names: string[], confirmed = false): void {
  const { source, model } = state()
  if (!model) return
  const objects = model.objects.filter((o) => names.includes(o.name) && o.decl)
  if (objects.length === 0) return
  const removedNames = [...objects.map((o) => o.name), ...objects.flatMap((o) => o.actions.filter((a) => !a.classAction).map((a) => a.name).filter((n): n is string => !!n))]
  const dependents = findDependents(model, removedNames, { objects: objects.map((o) => o.name), actions: [] })
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteObjects(names, true)
    const ranges: Range[] = []
    for (const obj of objects) {
      ranges.push(obj.decl!.range)
      for (const action of obj.actions) if (action.stmt && !action.classAction) ranges.push(action.stmt.range)
    }
    applyEdits([...removeStatements(source, ranges), ...resolutionEdits(model, source, dependents)], objectsSelected([]))
  }
  if (confirmed) run()
  else confirmRemoval(`Delete ${objects.length === 1 ? objects[0]!.name : `${objects.length} objects`}?`, dependents, run)
}

/**
 * Remove actions, after confirming when other code refers to their names. A class action goes
 * for every member; a selection of several actions goes in one step.
 */
export function deleteActions(refs: ActionRef[], confirmed = false): void {
  const { source, model } = state()
  if (!model) return
  const stmts = new Set<ActionInfo>()
  const names: string[] = []
  const removed: { object: string; index: number }[] = []
  const labels: string[] = []
  for (const ref of refs) {
    const obj = model.objects.find((o) => o.name === ref.object)
    const action = obj?.actions[ref.index]
    if (!obj || !action?.stmt) continue
    const stmt = action.classAction ? action.classAction.stmt : action.stmt
    if (!stmt || stmts.has(stmt)) continue
    stmts.add(stmt)
    if (action.classAction) {
      if (action.classAction.name) names.push(action.classAction.name)
      for (const m of action.classAction.members) removed.push({ object: m.object.name, index: m.object.actions.indexOf(m) })
      labels.push(`all('${action.classAction.className}').${action.verb} for every member`)
    } else {
      if (action.name) names.push(action.name)
      removed.push({ object: obj.name, index: ref.index })
      labels.push(action.name ? `${action.name} (${obj.name}.${action.verb})` : `${obj.name}.${action.verb}`)
    }
  }
  if (stmts.size === 0) return
  const dependents = names.length > 0 ? findDependents(model, names, { objects: [], actions: removed }) : []
  const keep = [...new Set(refs.map((r) => r.object))]
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteActions(refs, true)
    applyEdits([...removeStatements(source, [...stmts].map((s) => s.range)), ...resolutionEdits(model, source, dependents)], objectsSelected(keep))
  }
  if (confirmed) run()
  else confirmRemoval(labels.length === 1 ? `Delete ${labels[0]}?` : `Delete ${labels.length} actions?`, dependents, run)
}

export function deleteAction(name: string, index: number): void {
  deleteActions([{ object: name, index }])
}

/** Remove a class action for every member. */
export function deleteClassAction(id: number): void {
  const classAction = state().model?.classActions[id]
  const ref = classAction ? memberRef(classAction) : null
  if (ref) deleteActions([ref])
}

/**
 * Move an object's declaration before or after another's. Declaration order is the order of the
 * rows and the drawing order, later on top (D92).
 */
export function moveDeclaration(name: string, target: { before: string } | { after: string }): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const otherName = 'before' in target ? target.before : target.after
  const other = model?.objects.find((o) => o.name === otherName)
  if (!model || !obj?.decl || !other?.decl || obj === other) return
  const declared = model.objects.filter((o) => o.decl)
  const at = declared.indexOf(obj)
  const otherAt = declared.indexOf(other)
  if ('before' in target ? at === otherAt - 1 : at === otherAt + 1) return
  const text = source.slice(obj.decl.range.from, obj.decl.range.to)
  const removal = removeStatements(source, [obj.decl.range])[0]!
  const insert: TextEdit = 'before' in target ? { from: other.decl.range.from, to: other.decl.range.from, insert: `${text}\n\n` } : { from: other.decl.range.to, to: other.decl.range.to, insert: `\n\n${text}` }
  applyEdits([removal, insert], objectsSelected([name]))
}

function numberedCopies(model: SceneModel, names: string[], from: number): Record<string, string> {
  const taken = takenNames(model)
  const renames: Record<string, string> = {}
  for (const name of names) {
    const base = name.replace(/\d+$/, '') || name
    let n = from
    while (taken.has(`${base}${n}`)) n++
    renames[name] = `${base}${n}`
    taken.add(`${base}${n}`)
  }
  return renames
}

/** One object with its own actions, as source text. */
function objectClip(name: string): ClipObject | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl) return null
  return {
    name,
    className: obj.className,
    propsText: source.slice(obj.decl.propsOpen, obj.decl.propsClose),
    actions: obj.actions.filter((a) => a.stmt && !a.classAction).map((a) => ({ text: source.slice(a.stmt!.range.from, a.stmt!.range.to), name: a.name })),
  }
}

/** One action, as source text. */
function actionClip(ref: ActionRef): ClipAction | null {
  const { source, model } = state()
  const action = model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
  if (!action?.stmt) return null
  return { objectName: ref.object, verb: action.verb, name: action.classAction ? null : action.name, propsText: source.slice(action.stmt.propsOpen, action.stmt.propsClose) }
}

/** Ctrl+C: the selected actions, or else the selected objects with their actions (D81). */
export function copySelection(): boolean {
  const { selection, selectedActions, setClipboard } = useStore.getState()
  let clip: Clip | null = null
  if (selectedActions.length > 0) {
    const items = selectedActions.map(actionClip).filter((c): c is ClipAction => !!c)
    if (items.length > 0) clip = { kind: 'actions', items }
  } else {
    const items = selection.map(objectClip).filter((c): c is ClipObject => !!c)
    if (items.length > 0) clip = { kind: 'objects', items }
  }
  if (!clip) return false
  setClipboard(clip)
  const text =
    clip.kind === 'actions'
      ? clip.items.map((a) => `${a.name ? `${a.name} = ` : ''}${a.objectName}.${a.verb}({${a.propsText}})`).join('\n\n')
      : clip.items.flatMap((item) => [`${item.name} = ${item.className}({${item.propsText}})`, ...item.actions.map((a) => a.text)]).join('\n\n')
  void navigator.clipboard?.writeText(text).catch(() => undefined)
  return true
}

/** Ctrl+X: copy the selected actions, or else the selected objects, then delete them (D115). */
export function cutSelection(): boolean {
  if (!copySelection()) return false
  const { selection, selectedActions } = useStore.getState()
  if (selectedActions.length > 0) deleteActions(selectedActions)
  else deleteObjects(selection)
  return true
}

/**
 * Ctrl+V: objects paste as numbered copies; actions paste onto the selected object, or back onto
 * their own when nothing else is selected (D81).
 */
export function pasteClipboard(): boolean {
  const { source, model } = state()
  const { clipboard, selection } = useStore.getState()
  if (!model || !clipboard) return false
  if (clipboard.kind === 'actions') {
    const target = selection[0] ?? clipboard.items[0]?.objectName
    const obj = target ? model.objects.find((o) => o.name === target) : undefined
    if (!obj?.decl) return false
    const named = clipboard.items.map((a) => a.name).filter((n): n is string => !!n)
    const renames = numberedCopies(model, named, 2)
    const texts = clipboard.items.map((a) => `${a.name ? `${renames[a.name]} = ` : ''}${obj.name}.${a.verb}({${a.propsText}})`)
    const trimmed = source.replace(/\s+$/, '')
    const refs = clipboard.items.map((_, i) => ({ object: obj.name, index: obj.actions.length + i }))
    applyEdits([{ from: trimmed.length, to: source.length, insert: `${trimmed.length === 0 ? '' : '\n\n'}${texts.join('\n\n')}\n` }], { selection: [obj.name], selectedActions: refs })
    return true
  }
  return insertCopies(model, source, clipboard.items, null).length > 0
}

/**
 * Write copies of objects and their actions, numbered after the originals: `box` gives `box2`,
 * and its `slide` gives `slide2`. References among the copies point at the copies. The
 * declarations go after `afterDecl`, or after the last declaration.
 */
function insertCopies(model: SceneModel, source: string, items: ClipObject[], afterDecl: Range | null): string[] {
  if (items.length === 0) return []
  const renames = numberedCopies(model, [...items.map((i) => i.name), ...items.flatMap((i) => i.actions.map((a) => a.name).filter((n): n is string => !!n))], 2)
  const declTexts = items.map((i) => replaceIdentifiers(`${renames[i.name]} = ${i.className}({${i.propsText}})`, renames))
  const edits: TextEdit[] = [afterDecl ? { from: afterDecl.to, to: afterDecl.to, insert: `\n\n${declTexts.join('\n\n')}` } : insertDeclaration(model.lastDeclEnd, declTexts.join('\n\n'))]
  const actionTexts = items.flatMap((i) => i.actions.map((a) => replaceIdentifiers(a.text, renames)))
  if (actionTexts.length > 0) {
    const trimmed = source.replace(/\s+$/, '')
    edits.push({ from: trimmed.length, to: source.length, insert: `\n\n${actionTexts.join('\n\n')}\n` })
  }
  const newNames = items.map((i) => renames[i.name]!)
  applyEdits(edits, objectsSelected(newNames))
  return newNames
}

/** Copies of objects with all their actions, right after the last of them (D74). */
export function duplicateObjects(names: string[]): string[] {
  const { source, model } = state()
  if (!model) return []
  const items = names.map(objectClip).filter((c): c is ClipObject => !!c)
  const last = [...model.objects].reverse().find((o) => names.includes(o.name) && o.decl)
  return insertCopies(model, source, items, last?.decl?.range ?? null)
}

export function duplicateObject(name: string): string | null {
  return duplicateObjects([name])[0] ?? null
}

type RenameTarget = { object: string } | { object: string; index: number } | { classAction: number }

/** Ask for a new name for an object, an action, or a class action, naming it when it has no name yet. */
export function requestRename(target: RenameTarget): void {
  const { model } = state()
  if (!model) return
  let current: string
  let title: string
  let verb: string | undefined
  if ('classAction' in target) {
    const classAction = model.classActions[target.classAction]
    if (!classAction?.stmt) return
    current = classAction.name ?? ''
    verb = classAction.verb
    title = current ? `Rename ${current}` : `Name this all('${classAction.className}').${verb}`
  } else {
    const obj = model.objects.find((o) => o.name === target.object)
    if (!obj) return
    if ('index' in target) {
      const action = obj.actions[target.index]
      if (!action?.stmt || action.classAction) return
      current = action.name ?? ''
      verb = action.verb
      title = current ? `Rename ${current}` : `Name this ${obj.name}.${verb}`
    } else {
      current = obj.name
      title = `Rename ${obj.name}`
    }
  }
  const taken = takenNames(model)
  taken.delete(current)
  useStore.getState().openDialog({
    title,
    message: verb ? 'Other actions can refer to its timing by this name.' : 'Every reference in the code is renamed too.',
    input: { label: 'Name', value: current || `${verb}1`, validate: (value) => nameProblem(value, taken) },
    confirmLabel: current ? 'Rename' : 'Name',
    onConfirm: (value) => applyRename(target, value),
  })
}

function applyRename(target: RenameTarget, newName: string): void {
  const { source, model } = state()
  if (!model) return
  if ('classAction' in target) {
    const classAction = model.classActions[target.classAction]
    if (!classAction?.stmt) return
    if (classAction.name) applyEdits(identifierEdits(source, { [classAction.name]: newName }))
    else applyEdits([{ from: classAction.stmt.range.from, to: classAction.stmt.range.from, insert: `${newName} = ` }])
    return
  }
  const obj = model.objects.find((o) => o.name === target.object)
  if (!obj) return
  if (!('index' in target)) {
    applyEdits(identifierEdits(source, { [obj.name]: newName }), objectsSelected([newName]))
    return
  }
  const action = obj.actions[target.index]
  if (!action?.stmt) return
  if (action.name) applyEdits(identifierEdits(source, { [action.name]: newName }), actionSelected(obj.name, target.index))
  else applyEdits([{ from: action.stmt.range.from, to: action.stmt.range.from, insert: `${newName} = ` }], actionSelected(obj.name, target.index))
}

/** Open the Classes dialog for objects (D88). */
export function requestClasses(names: string[]): void {
  const { model } = state()
  const valid = names.filter((n) => model?.objects.some((o) => o.name === n && o.decl))
  if (valid.length > 0) useStore.getState().openClassesDialog(valid)
}

/** Add classes to objects and take others away, written into each `class` attribute. */
export function applyClasses(names: string[], add: string[], remove: string[]): void {
  const { source, model } = state()
  if (!model) return
  const edits: TextEdit[] = []
  for (const name of names) {
    const obj = model.objects.find((o) => o.name === name)
    if (!obj?.decl) continue
    const next = obj.classes.filter((c) => !remove.includes(c))
    for (const c of add) if (!next.includes(c)) next.push(c)
    if (next.join(' ') === obj.classes.join(' ')) continue
    const edit = next.length > 0 ? setProp(source, obj.decl, 'class', next.join(' ')) : removeProp(source, obj.decl, 'class')
    if (edit) edits.push(edit)
  }
  applyEdits(edits, objectsSelected(names))
}

export function removeFromClass(name: string, className: string): void {
  applyClasses([name], [], [className])
}

/** Scroll the code pane to an object's declaration. */
export function jumpToObject(name: string): void {
  const obj = useStore.getState().model?.objects.find((o) => o.name === name)
  if (obj?.decl) scrollToPos(obj.decl.range.from)
}

/** Scroll the code pane to an action's block. */
export function jumpToAction(name: string, index: number): void {
  const action = useStore.getState().model?.objects.find((o) => o.name === name)?.actions[index]
  if (action?.stmt) scrollToPos(action.stmt.range.from)
}

/** Scroll the code pane to a class's first action, or else to its first member. */
export function jumpToClass(className: string): void {
  const model = useStore.getState().model
  const classAction = model?.classActions.find((a) => a.className === className && a.stmt)
  if (classAction?.stmt) return scrollToPos(classAction.stmt.range.from)
  const member = model?.objects.find((o) => isMember(o, className) && o.decl)
  if (member?.decl) scrollToPos(member.decl.range.from)
}

/** Select every member of a class. */
export function selectClass(className: string): void {
  const names = useStore.getState().model?.classes.get(className) ?? []
  useStore.getState().select(names)
}

/** Select a class action, through one of its members, so it is marked everywhere. */
export function selectClassAction(classAction: ClassAction): void {
  const ref = memberRef(classAction)
  if (ref) useStore.getState().selectAction(ref.object, ref.index)
}

/** The current action, for callers that need to know whether it is a class action. */
export function actionAt(name: string, index: number): Action | null {
  return findObject(name)?.actions[index] ?? null
}
