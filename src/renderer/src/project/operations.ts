import { applyEdits, beginGesture, endGesture, foldShapes, scrollToPos } from '../code/editor'
import { findDependents, type Dependent } from '../model/dependents'
import { appendStatement, blockText, formatNumber, insertDeclaration, moveStatementEdits, removeProp, removeStatements, setProp, setPropFrom, setPropText, type TextEdit } from '../model/edits'
import { isMember } from '../model/evaluate'
import { memberRef, normalizeSelection } from '../model/groups'
import { classes, GROUP, TIMING_KEY_NAMES, VERB_ATTRS, type AttrValue, type Verb } from '../model/registry'
import { absoluteAt, anchorTime, memberBox, pathFrame, pathHolds, pathShift, positionAt, rawFromWorld, travelFrame, type Point } from '../model/sample'
import { insertPointsEdit, pointText, removePointEdit, setPointEdit, shapeLiteral, type ShapeLiteral } from '../model/pathEdits'
import { identifierEdits, nameProblem, renameMembers, replaceIdentifiers } from '../model/rename'
import { currentWritten, definingAction, shownValue, valueAt, withWritten, writesFrom, writtenValues } from '../model/sample'
import type { Action, ActionInfo, BlockInfo, ClassAction, Range, SceneModel, SceneObject } from '../model/types'
import { useStore, type ActionRef, type Clip, type ClipAction, type ClipObject, type Pin, type SelectionState, type ObjectKind } from '../state/store'

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

/** A name not in use yet: the base itself, else the base with the first free number from 2 (D219). */
export function freeName(base: string): string {
  const { model } = state()
  const taken = model ? takenNames(model) : new Set<string>()
  return taken.has(base) ? uniqueName(base, 2) : base
}

export function uniqueName(base: string, from = 1): string {
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

/** Seconds as written: at most four decimals, so a frame's length and a frame-aligned start survive. */
export function roundSeconds(v: number): number {
  return Math.round(v * 10000) / 10000
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
  // A group resizes by scaling around its anchor (D124).
  if (className === GROUP) return ['scale']
  const has = (a: string) => classes[className]?.attrs.some((s) => s.name === a)
  if (has('width') && has('height')) return ['width', 'height']
  return RESIZE_ATTRS.filter(has)
}

/** The verb that reads best for a set of changing attributes: a move, a turn, a resize, or `to`. */
export function verbFor(attrs: string[]): Verb {
  const set = new Set(attrs)
  if (set.size > 0 && [...set].every((a) => a === 'x' || a === 'y' || a === 'z')) return 'move'
  if (set.size === 1 && set.has('rotation')) return 'rotate'
  // A scaling is a resize by a factor (D211).
  if (set.size === 1 && set.has('scale')) return 'resize'
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
  if (className === GROUP) return { scale: (base['scale'] || 1) * uniform }
  if (className === 'Rect' || className === 'Circle') return { width: (base['width'] ?? 0) * fx, height: (base['height'] ?? 0) * fy }
  if (className === 'Text') return { fontSize: (base['fontSize'] ?? 0) * uniform }
  return {}
}

/** Place a new object at a world position. Returns its name. */
export function addObject(className: ObjectKind, x: number, y: number, at = state().time): string | null {
  const { model } = state()
  if (!model) return null
  const name = uniqueName(className.toLowerCase())
  const attrs: Record<string, AttrValue> = { x: Math.round(x), y: Math.round(y) }
  if (className === 'Rect') Object.assign(attrs, { width: 240, height: 140, fill: '#4f8cff' })
  if (className === 'Circle') Object.assign(attrs, { radius: 60, fill: '#f59e0b' })
  if (className === 'Text') Object.assign(attrs, { text: 'Text', fontSize: 48, fill: '#ffffff' })
  // A new object begins where the playhead is and lasts as long as the preferences say (D138, D145).
  if (at > 0) attrs['at'] = roundSeconds(at)
  const length = useStore.getState().prefs.objectLength
  if (length !== null) attrs['until'] = roundSeconds(at + length)
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = ${className}`, attrs))], objectsSelected([name]))
  return name
}

/**
 * Write a value into what defines an attribute: the action that most recently started naming
 * it gets it as its change, written directly (D102), otherwise the declaration gets it. Returns
 * null when locked: a linked value, a class action, or code the GUI cannot edit.
 */
function writeTo(source: string, obj: SceneObject, definer: Action | null, attr: string, value: number, time: number): TextEdit | null {
  if (definer) {
    if (!definer.stmt || definer.classAction) return null
    // At the start of an action given its own start, the `from` of its range is what shows and what changes (D221).
    if (writesFrom(definer, attr, time)) return typeof definer.from[attr] === 'number' ? setPropFrom(definer.stmt, attr, roundAttr(attr, value)) : null
    if (typeof definer.changes[attr] !== 'number') return null
    return setProp(source, definer.stmt, attr, roundAttr(attr, value))
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
      const action = definingAction(obj, attr, time)
      // One at its own start, with a start of its own, is edited there, not at its end (D221).
      if (!action?.stmt || action.classAction || time >= action.end || writesFrom(action, attr, time)) continue
      const index = obj.actions.indexOf(action)
      if (!refs.some((r) => r.object === name && r.index === index)) refs.push({ object: name, index })
    }
  }
  return refs
}

/**
 * A plain drag or nudge: these objects show these values at this time, in one step. When a
 * class action defines one of the values right now, the object first overrides it with its own
 * action, which is what then gets edited (D80). What gets written is whatever makes the shown
 * values true, with everything stacked on top left in place (D122).
 */
export function setAttrsAtMany(entries: { name: string; attrs: Record<string, number> }[], time: number): boolean {
  const done = new Set<ClassAction>()
  for (const { name, attrs } of entries) {
    const obj = state().model?.objects.find((o) => o.name === name)
    if (!obj) continue
    for (const attr of Object.keys(attrs)) {
      const action = definingAction(obj, attr, time)
      if (!action?.classAction || !action.stmt || done.has(action.classAction)) continue
      done.add(action.classAction)
      overrideClassAction(name, obj.actions.indexOf(action))
    }
  }
  const { model, source } = state()
  if (!model) return false
  const edits: TextEdit[] = []
  for (const { name, attrs: wanted } of entries) {
    const found = model.objects.find((o) => o.name === name)
    if (!found) continue
    // A value a path owns right now cannot be written to show: the path is edited instead (D205), and the solver is kept off it.
    const attrs = Object.fromEntries(Object.entries(wanted).filter(([attr]) => !pathHolds(found, attr, time)))
    edits.push(...heldByPathEdits(model, found, wanted, time))
    if (Object.keys(attrs).length === 0) continue
    let obj: SceneObject = found
    let probed = model
    const definers = Object.fromEntries(['x', 'y', ...Object.keys(attrs)].map((attr) => [attr, definingAction(found, attr, time)]))
    // A group's own turn or scale pivots on a point its declaration keeps: the first the GUI writes fixes it at the center of the members' box, so a member moved later never moves it (D124).
    const decl = found.decl
    if (found.className === GROUP && decl && ['rotation', 'scale'].some((attr) => attr in attrs && !definers[attr])) {
      const box = memberBox(model, found, time)
      if (box) {
        for (const [attr, value] of [['pivotX', Math.round(box.x)], ['pivotY', Math.round(box.y)]] as const) {
          if (found.attrs[attr] !== undefined) continue
          edits.push(setProp(source, decl, attr, value))
          ;[probed, obj] = withWritten(probed, obj, null, attr, value)
        }
      }
    }
    for (const [attr, value] of Object.entries(writtenValues(probed, obj, time, attrs, definers))) {
      // What is written already stays as it is; nothing to change is nothing to undo.
      const current = currentWritten(probed, obj, definers[attr] ?? null, attr, time)
      if (Math.abs(value - current) < 1e-6 || roundAttr(attr, value) === roundAttr(attr, current)) continue
      const edit = writeTo(source, obj, definers[attr] ?? null, attr, value, time)
      if (edit && source.slice(edit.from, edit.to) !== edit.insert) edits.push(edit)
    }
  }
  applyEdits(edits)
  return edits.length > 0
}

/**
 * The edits for the values a path owns at a time (D205, D224): each goes into the path, along
 * its own axis, at the anchor the object is at, the first at the path's start and the last
 * after that, so a drag held by a move on one axis and a path on the other still lands where
 * the pointer is. A path whose shape is code takes nothing.
 */
function heldByPathEdits(model: SceneModel, obj: SceneObject, wanted: Record<string, number>, time: number): TextEdit[] {
  const byPath = new Map<Action, Record<string, number>>()
  for (const [attr, value] of Object.entries(wanted)) {
    if (attr !== 'x' && attr !== 'y') continue
    const holder = pathHolds(obj, attr, time)
    if (!holder) continue
    byPath.set(holder, { ...(byPath.get(holder) ?? {}), [attr]: value })
  }
  const edits: TextEdit[] = []
  for (const [holder, values] of byPath) {
    const e = editableShape({ object: obj.name, index: obj.actions.indexOf(holder) })
    const frame = travelFrame(model, obj, holder)
    if (!e || !frame || frame.anchors.length === 0) continue
    const anchor = time <= holder.start ? 0 : frame.anchors.length - 1
    const world = { ...frame.anchors[anchor]!, ...values }
    const raw = rawFromWorld(model, obj, holder, anchorTime(model, holder, anchor), world)
    const edit = setPointEdit(e.shape, anchor, Math.round(raw.x), Math.round(raw.y))
    if (edit && e.source.slice(edit.from, edit.to) !== edit.insert) edits.push(edit)
  }
  return edits
}

export function setAttrsAt(name: string, attrs: Record<string, number>, time: number): boolean {
  return setAttrsAtMany([{ name, attrs }], time)
}

export function setPositionAt(name: string, x: number, y: number, time: number): boolean {
  return setAttrsAt(name, { x, y }, time)
}

/** Arrow keys: move objects by whole pixels at the playhead (D95). A group's members move; the group itself is untouched (D124). */
export function nudgeObjects(names: string[], dx: number, dy: number): void {
  const { model, time } = state()
  if (!model) return
  const entries = [...new Set(names)].flatMap((name) => {
    const obj = model.objects.find((o) => o.name === name)
    if (!obj?.decl) return []
    const x = shownValue(model, obj, 'x', time)
    const y = shownValue(model, obj, 'y', time)
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
  const stmt = action.stmt
  const schema = classes[obj.className]
  // A path's position comes from its shape: a drag edits the shape instead (D197), never this.
  if (action.verb === 'path') return false
  // An animation given a change its verb cannot hold becomes a `to`, which holds any (D188): a resize whose center moves, a turn that is also dragged.
  const allowed = VERB_ATTRS[action.verb]
  const animatable = (attr: string): boolean => !!schema?.attrs.some((a) => a.name === attr && a.animatable)
  const upgrade = action.verb !== 'to' && Object.keys(destination).some((attr) => !(attr in action.changes) && animatable(attr) && allowed !== null && !allowed.includes(attr))
  const takes = (attr: string): boolean => (attr in action.changes && typeof action.changes[attr] !== 'function') || (upgrade && animatable(attr))
  const wanted = Object.fromEntries(Object.entries(destination).filter(([attr]) => takes(attr)))
  if (Object.keys(wanted).length === 0) return false
  const definers = Object.fromEntries(['x', 'y', ...Object.keys(wanted)].map((attr) => [attr, takes(attr) ? action : definingAction(obj, attr, action.end)]))
  const edits: TextEdit[] = []
  if (upgrade) {
    const head = source.slice(stmt.range.from, stmt.propsOpen)
    const at = head.lastIndexOf(`.${action.verb}(`)
    if (at < 0) return false
    edits.push({ from: stmt.range.from + at + 1, to: stmt.range.from + at + 1 + action.verb.length, insert: 'to' })
  }
  for (const [attr, value] of Object.entries(writtenValues(model, obj, action.end, wanted, definers))) {
    if (!takes(attr)) continue
    const edit = setProp(source, stmt, attr, roundAttr(attr, value))
    if (source.slice(edit.from, edit.to) !== edit.insert) edits.push(edit)
  }
  if (edits.length === (upgrade ? 1 : 0)) return false
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
export function beginTimed(name: string, attrs: string[], pin: Pin = 'start', when = state().time, duration = 1): number | null {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return null
  const present = attrs.filter((a) => classes[obj.className]?.attrs.some((s) => s.name === a))
  if (present.length === 0) return null
  const verb = verbFor(present)
  const block: Record<string, AttrValue> = {}
  for (const attr of present) {
    const value = valueAt(model, obj, attr, when)
    block[attr] = roundAttr(attr, typeof value === 'number' ? value : 0)
  }
  return appendTimed(name, verb, block, pin, when, duration)
}

/** Where an action pinned to a time sits (D103): with `start` it starts here and lasts `length` seconds, a second unless the gesture chose otherwise; with `end` it ends here, starting that long earlier or at zero. */
function pinnedSpan(pin: Pin, when: number, length = 1): { at: number; duration: number } {
  const now = roundSeconds(when)
  const wanted = Math.max(frameSeconds(state().fps), roundSeconds(length))
  const endHere = pin === 'end' && now >= frameSeconds(state().fps)
  const at = endHere ? roundSeconds(Math.max(0, now - wanted)) : now
  return { at, duration: endHere ? roundSeconds(now - at) : wanted }
}

/**
 * The edits that widen an object's life to hold an animation from `start` to `end` (D146): `at`
 * moves earlier and `until` later, measured from `origin` when a drag began, so a drag back inside
 * lets the life return to what it was. A written time reference is left alone, as is an `until`
 * that is omitted, and a group has no life to widen.
 */
export function coverEdits(source: string, obj: SceneObject, start: number, end: number, origin?: { at: number; until: number | null }): TextEdit[] {
  if (!obj.decl || obj.className === GROUP) return []
  const base = origin ?? { at: obj.at, until: obj.until }
  const literal = (key: string): boolean => {
    const prop = obj.decl!.props.find((p) => p.key === key)
    return !prop || prop.kind === 'literal'
  }
  const edits: (TextEdit | null)[] = []
  const at = roundSeconds(Math.min(base.at, Math.max(0, start)))
  if (literal('at') && at !== roundSeconds(obj.at)) edits.push(at <= 0 ? removeProp(source, obj.decl, 'at') : setProp(source, obj.decl, 'at', at))
  if (base.until !== null && obj.until !== null && literal('until')) {
    const until = roundSeconds(Math.max(base.until, end))
    if (until !== roundSeconds(obj.until)) edits.push(setProp(source, obj.decl, 'until', until))
  }
  return edits.filter((e): e is TextEdit => !!e)
}

/** Write a new action pinned to a time (D103) and select it; the object's life widens to hold it (D146). Returns its end, or null. */
/** Append an action written as text, widening the object's life to hold its span, and select it (D217). */
export function appendActionText(name: string, text: string, start: number, end: number): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl) return
  applyEdits([appendStatement(source, text), ...coverEdits(source, obj, start, end)], actionSelected(name, obj.actions.length))
}

export function appendTimed(name: string, verb: Verb, block: Record<string, AttrValue>, pin: Pin, when: number, length = 1): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj) return null
  const { at, duration } = pinnedSpan(pin, when, length)
  Object.assign(block, pivotFor(model, obj, block, at))
  block['at'] = at
  block['duration'] = duration
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, block)), ...coverEdits(source, obj, at, at + duration)], actionSelected(name, obj.actions.length))
  return at + duration
}

/**
 * The move written for something a drag pushed while making or editing an animation (D136): the
 * same span as the drag's own, starting from where the thing is then, its destination set as the
 * push goes on. Not selected, so the drag's own animation stays the one selected. Returns its index.
 */
export function appendPushedMove(name: string, at: number, duration: number): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return null
  const block: Record<string, AttrValue> = {}
  for (const attr of ['x', 'y']) {
    const value = valueAt(model, obj, attr, at)
    block[attr] = roundAttr(attr, typeof value === 'number' ? value : 0)
  }
  block['at'] = roundSeconds(at)
  block['duration'] = roundSeconds(duration)
  applyEdits([appendStatement(source, blockText(`${name}.move`, block))])
  return obj.actions.length
}

export function beginMove(name: string): boolean {
  const end = beginTimed(name, ['x', 'y'])
  if (end !== null) useStore.getState().setTime(end)
  return end !== null
}

/** The index of the object's last own action, the one a Shift-drag is writing, or null. */
export function lastActionIndex(name: string): number | null {
  const obj = findObject(name)
  const index = obj ? obj.actions.map((a, i) => (a.stmt && !a.classAction ? i : -1)).filter((i) => i >= 0).pop() : undefined
  return index ?? null
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

/**
 * The point a group's turn or scale pivots on, written into the action: the center of the
 * members' box when the action begins, so that nothing done later can move it (D124).
 */
function pivotFor(model: SceneModel, obj: SceneObject, block: Record<string, AttrValue>, at: number): Record<string, AttrValue> {
  if (obj.className !== GROUP || !('rotation' in block || 'scale' in block)) return {}
  const box = memberBox(model, obj, at)
  return box ? { pivotX: Math.round(box.x), pivotY: Math.round(box.y) } : {}
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
    // A resize starts with the object's dimensions; the scale factor is for what has none, a group (D211).
    if (verb === 'resize' && attr === 'scale' && obj.className !== GROUP) continue
    const value = valueAt(model, obj, attr, time)
    attrs[attr] = typeof value === 'number' ? roundAttr(attr, value) : value
  }
  return attrs
}

/** Add an action of a kind at a time. Its values start as the object's current ones, so nothing jumps. */
export function addAction(name: string, verb: Verb, time: number): void {
  if (verb === 'path') {
    addPath(name, time)
    return
  }
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const attrs = startingValues(model, obj, verb, time)
  Object.assign(attrs, pivotFor(model, obj, attrs, roundSeconds(time)))
  attrs['at'] = roundSeconds(time)
  attrs['duration'] = 1
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, attrs)), ...coverEdits(source, obj, roundSeconds(time), roundSeconds(time) + 1)], actionSelected(name, obj.actions.length))
}

/** Add an action for every member of a class at a time, written once as `all('name').verb` (D80). */
export function addClassAction(className: string, verb: Verb, time: number): void {
  const { source, model } = state()
  const first = model?.objects.find((o) => isMember(o, className))
  if (!model || !first) return
  if (verb === 'path') {
    // Every member takes the same path, which begins where the first member is (D194).
    const here = positionAt(model, first, roundSeconds(time))
    applyEdits([appendStatement(source, pathText(`all('${className}').path`, [{ x: Math.round(here.x), y: Math.round(here.y) }], roundSeconds(time), 1))], actionSelected(first.name, first.actions.length))
    return
  }
  const attrs = startingValues(model, first, verb, time)
  attrs['at'] = roundSeconds(time)
  attrs['duration'] = 1
  applyEdits([appendStatement(source, blockText(`all('${className}').${verb}`, attrs))], actionSelected(first.name, first.actions.length))
}

/** The statement of a new path: its points one per line, then when it runs (D194). */
function pathText(head: string, points: Point[], at: number, duration: number): string {
  const lines = points.map((p) => `    ${pointText(p.x, p.y)},`)
  return `${head}({\n  shape: [\n${lines.join('\n')}\n  ],\n  at: ${formatNumber(at)},\n  duration: ${formatNumber(duration)},\n})`
}

/**
 * Add a path to an object at a time (D194): its shape begins with one point, where the object is
 * then, and the Draw tool adds the rest. The object's life widens to hold it. Returns the index
 * of the new action.
 */
export function addPath(name: string, time: number): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return null
  const at = roundSeconds(time)
  // The path's first point is where the absolute actions put the object, so what relative changes add on top, an orbit say, goes on adding and the object stays put as the path begins (D225).
  const here = { x: absoluteAt(model, obj, 'x', at), y: absoluteAt(model, obj, 'y', at) }
  const index = obj.actions.length
  applyEdits([appendStatement(source, pathText(`${name}.path`, [{ x: Math.round(here.x), y: Math.round(here.y) }], at, 1)), ...coverEdits(source, obj, at, at + 1)], actionSelected(name, index))
  // The points stay folded in the code until wanted (D204).
  foldShapes()
  return index
}

interface EditableShape {
  source: string
  model: SceneModel
  obj: SceneObject
  action: Action
  shape: ShapeLiteral
}

/** A path action with its shape written as literal points, in the object's own statement, which the GUI edits point by point (D194). */
function editableShape(ref: ActionRef): EditableShape | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  if (!model || !obj || !action?.stmt || action.classAction || action.verb !== 'path') return null
  const shape = shapeLiteral(source, action.stmt)
  return shape ? { source, model, obj, action, shape } : null
}

/** Whether the preview can edit a path's points: they are written as literals in the object's own statement. */
export function pathEditable(ref: ActionRef): boolean {
  return editableShape(ref) !== null
}

/**
 * The literal a point of the scene is written as, in whole pixels (D223): what the object's groups
 * do to it at the time the object reaches the anchor taken back, what lies under a relative path
 * then taken off, and `offset` taken off. The time is the anchor's, or that of the one before a
 * point being put in.
 */
function rawPoint(e: EditableShape, world: Point, time: number): Point {
  const p = rawFromWorld(e.model, e.obj, e.action, time, world)
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

/** The time at which a point put in at an index is reached: that of the anchor before it, or the path's start for the first. */
function insertTime(e: EditableShape, index: number): number {
  return index > 0 ? anchorTime(e.model, e.action, Math.min(index, e.shape.points.length) - 1) : e.action.start
}

/** Move several points of a path at once, each to a place in the scene (D198). */
export function setPathPoints(ref: ActionRef, entries: { index: number; world: Point }[]): void {
  const e = editableShape(ref)
  if (!e) return
  const edits: TextEdit[] = []
  for (const { index, world } of entries) {
    const p = rawPoint(e, world, anchorTime(e.model, e.action, index))
    const edit = setPointEdit(e.shape, index, p.x, p.y)
    if (edit) edits.push(edit)
  }
  if (edits.length > 0) applyEdits(edits)
}

/** A path's `offset` as written, for a drag that carries the whole path by changing it. */
export function pathOffset(ref: ActionRef): Point {
  const action = findObject(ref.object)?.actions[ref.index]
  return action ? pathShift(action) : { x: 0, y: 0 }
}

/**
 * Carry a whole path whose shape is code, a function or a link, by how far the pointer has gone
 * in the scene (D223): its `offset` takes the shift from what it was when the drag began, so the
 * shape's math stays as written. An offset of nothing is taken out.
 */
export function setPathShift(ref: ActionRef, base: Point, from: Point, to: Point): void {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  if (!model || !obj || !action?.stmt || action.classAction || action.verb !== 'path') return
  const a = rawFromWorld(model, obj, action, action.start, from)
  const b = rawFromWorld(model, obj, action, action.start, to)
  const next = { x: Math.round(base.x + b.x - a.x), y: Math.round(base.y + b.y - a.y) }
  const current = pathShift(action)
  if (next.x === current.x && next.y === current.y) return
  if (next.x === 0 && next.y === 0) setActionProp(ref, 'offset', null)
  else setActionProp(ref, 'offset', pointText(next.x, next.y), true)
}

/** Take several points out of a path, as one undo step; at least one point stays (D198). */
export function removePathPoints(ref: ActionRef, indices: number[]): void {
  const sorted = [...new Set(indices)].sort((a, b) => b - a)
  if (sorted.length === 0) return
  beginGesture()
  for (const index of sorted) removePathPoint(ref, index)
  endGesture()
}

/** Make a path a smooth curve through its points, or straight lines between them (D199). */
export function setPathSmooth(ref: ActionRef, smooth: boolean): void {
  setActionProp(ref, 'smooth', smooth ? true : null)
}

/**
 * Where a drag of an object that a path places goes (D197, D205), as a drag during a move goes to
 * the move's end: the path, selected or else the one that owns the position at the playhead, and
 * the anchor to move: the first at the path's start, the last anywhere after that, with the
 * playhead shown at the path's end while it is running. Null when no path has a say.
 */
export function pathDragTarget(name: string, selectedIndex: number | null, time: number): { ref: ActionRef; index: number; showTime: number | null } | null {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj) return null
  const action = selectedIndex !== null ? obj.actions[selectedIndex] : pathHolds(obj, 'x', time)
  if (!action || action.verb !== 'path' || action.classAction || !action.stmt || action.overridden || action.timing.relative) return null
  const index = obj.actions.indexOf(action)
  const ref = { object: name, index }
  if (!pathEditable(ref)) return null
  const frame = pathFrame(model, action, time)
  if (!frame || frame.anchors.length === 0) return null
  const atStart = time <= action.start
  return { ref, index: atStart ? 0 : frame.anchors.length - 1, showTime: !atStart && time < action.end ? action.end : null }
}

/** Move one point of a path to a place in the scene (D194). */
export function setPathPoint(ref: ActionRef, index: number, world: Point): void {
  const e = editableShape(ref)
  if (!e) return
  const p = rawPoint(e, world, anchorTime(e.model, e.action, index))
  const edit = setPointEdit(e.shape, index, p.x, p.y)
  if (edit) applyEdits([edit])
}

/** Put points into a path so that the first lands at `index`; the count appends (D194). */
export function insertPathPoints(ref: ActionRef, index: number, worlds: Point[]): void {
  const e = editableShape(ref)
  if (!e) return
  const time = insertTime(e, index)
  const edit = insertPointsEdit(e.source, e.shape, index, worlds.map((w) => rawPoint(e, w, time)))
  if (edit) applyEdits([edit])
}

/** Take one point out of a path; the last point stays (D194). */
export function removePathPoint(ref: ActionRef, index: number): void {
  const e = editableShape(ref)
  if (!e) return
  const edit = removePointEdit(e.source, e.shape, index)
  if (edit) applyEdits([edit])
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
export function setActionTiming(name: string, index: number, timing: { at?: number; duration?: number; easeIn?: number; easeOut?: number }): void {
  const { source } = state()
  const obj = findObject(name)
  const action = obj?.actions[index]
  if (!obj || !action?.stmt || action.classAction) return
  const edits: TextEdit[] = []
  if (timing.at !== undefined) edits.push(setProp(source, action.stmt, 'at', roundSeconds(timing.at)))
  if (timing.duration !== undefined) edits.push(setProp(source, action.stmt, 'duration', roundSeconds(timing.duration)))
  if (timing.easeIn !== undefined) edits.push(setProp(source, action.stmt, 'easeIn', roundSeconds(timing.easeIn)))
  if (timing.easeOut !== undefined) edits.push(setProp(source, action.stmt, 'easeOut', roundSeconds(timing.easeOut)))
  // The object's life widens to hold the animation where it now is (D146).
  const delay = action.timing.delay ?? 0
  const start = timing.at !== undefined ? timing.at + delay : action.start
  const end = start + (timing.duration ?? action.end - action.start)
  edits.push(...coverEdits(source, obj, start, end))
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
 * measured from there, so a drag can keep sending its total. The snapshot may also hold each
 * object's life when the drag began, under `name:life` with `until` as `end` (Infinity when
 * omitted): the life widens to hold the retimed actions, measured from there (D146).
 */
export function retimeActions(refs: ActionRef[], change: { shift?: number; grow?: number; trimStart?: number }, from?: Record<string, { start: number; end: number }>): void {
  const { source, model, fps } = state()
  if (!model) return
  const minimum = frameSeconds(fps)
  const edits: TextEdit[] = []
  const done = new Set<ActionInfo>()
  /** The span each object's own retimed actions now take, for widening its life. */
  const spans = new Map<SceneObject, { start: number; end: number }>()
  const span = (action: Action, start: number, end: number): void => {
    if (action.classAction) return
    const prior = spans.get(action.object)
    spans.set(action.object, prior ? { start: Math.min(prior.start, start), end: Math.max(prior.end, end) } : { start, end })
  }
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
    if (change.trimStart !== undefined) {
      // The end stays put: the duration changes first, and the start follows it, so hitting the
      // one-frame floor never nudges the end.
      const newDuration = Math.max(minimum, duration - change.trimStart)
      if (!untilProp) edits.push(setProp(source, stmt, 'duration', roundSeconds(newDuration)))
      if (!atLocked) edits.push(setProp(source, stmt, 'at', roundSeconds(Math.max(0, origin.end - newDuration - delay))))
      if (!atLocked && !untilProp) span(action, Math.max(0, origin.end - newDuration), origin.end)
      continue
    }
    const move = change.shift ?? 0
    if ((move !== 0 || from) && !atLocked) edits.push(setProp(source, stmt, 'at', roundSeconds(Math.max(0, origin.start + move - delay))))
    const grow = change.grow ?? 0
    if ((grow !== 0 || (from && change.grow !== undefined)) && !untilProp) edits.push(setProp(source, stmt, 'duration', roundSeconds(Math.max(minimum, duration + grow))))
    const newStart = atLocked ? origin.start : Math.max(0, origin.start + move)
    span(action, newStart, newStart + (untilProp ? duration : Math.max(minimum, duration + grow)))
  }
  for (const [obj, s] of spans) {
    const life = from?.[`${obj.name}:life`]
    edits.push(...coverEdits(source, obj, s.start, s.end, life ? { at: life.start, until: Number.isFinite(life.end) ? life.end : null } : undefined))
  }
  applyEdits(edits)
}

/** An object's lifetime as written, `at` and `until` on its declaration (D138): 0 or null means the line goes. */
export function setLifetime(name: string, life: { at?: number | null; until?: number | null }): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || obj.className === GROUP) return
  const edits: (TextEdit | null)[] = []
  if (life.at !== undefined) edits.push(life.at === null || life.at <= 0 ? removeProp(source, obj.decl, 'at') : setProp(source, obj.decl, 'at', roundSeconds(life.at)))
  if (life.until !== undefined) edits.push(life.until === null ? removeProp(source, obj.decl, 'until') : setProp(source, obj.decl, 'until', roundSeconds(life.until)))
  applyEdits(edits.filter((e): e is TextEdit => !!e))
}

/** A snapshot of an object's timing when a drag begins, so the drag can keep sending its total (D139). */
export interface LifetimeOrigin {
  at: number
  until: number | null
  actions: Record<string, { start: number; end: number }>
}

/**
 * Move an object in time (D139): its start, its end when set, and its own actions with a written
 * `at` shift together, in one step; actions that start when the object does, or at a reference,
 * follow on their own, and class actions stay with their class. With `edge: 'start'` the end stays
 * where it is: the start edge is dragged and the actions keep their place against it.
 */
export function placeObject(name: string, at: number, edge: 'all' | 'start' = 'all', from?: LifetimeOrigin): void {
  const { source, model, fps } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || obj.className === GROUP) return
  const origin: LifetimeOrigin = from ?? { at: obj.at, until: obj.until, actions: {} }
  const target = Math.max(0, roundSeconds(at))
  const shift = target - origin.at
  const until = origin.until === null ? null : edge === 'all' ? origin.until + shift : Math.max(target + frameSeconds(fps), origin.until)
  const edits: (TextEdit | null)[] = [target <= 0 ? removeProp(source, obj.decl, 'at') : setProp(source, obj.decl, 'at', target)]
  if (until !== origin.until || from) edits.push(until === null ? removeProp(source, obj.decl, 'until') : setProp(source, obj.decl, 'until', roundSeconds(until)))
  obj.actions.forEach((action, index) => {
    const stmt = action.stmt
    if (!stmt || action.classAction || action.overridden || action.codeDriven) return
    const atProp = stmt.props.find((p) => p.key === 'at')
    if (!atProp || atProp.kind !== 'literal') return
    const start = origin.actions[`${name}:${index}`]?.start ?? action.start
    edits.push(setProp(source, stmt, 'at', roundSeconds(Math.max(0, start + shift - (action.timing.delay ?? 0)))))
  })
  applyEdits(edits.filter((e): e is TextEdit => !!e))
}

/** What a link can point at (D170): an action, a class action, or when an object begins or is removed. */
export type LinkTarget = { action: ActionRef } | { classAction: number } | { object: string }
export type LinkPart = 'start' | 'end' | 'progress'

/**
 * The name a target can be referred to by. An action or class action without one gets named in
 * the code first, `boxMove`, then `boxMove2`, so the reference has something to hold on to.
 */
function linkName(model: SceneModel, target: LinkTarget, edits: TextEdit[]): string | null {
  if ('object' in target) return model.objects.some((o) => o.name === target.object) ? target.object : null
  const classAction = 'classAction' in target ? model.classActions[target.classAction] : null
  const action = 'action' in target ? model.objects.find((o) => o.name === target.action.object)?.actions[target.action.index] : null
  const stmt = classAction ? classAction.stmt : action && !action.classAction ? action.stmt : null
  const existing = classAction ? classAction.name : action?.name
  if (!stmt) return null
  if (existing) return existing
  const verb = classAction ? classAction.verb : action!.verb
  const owner = classAction ? classAction.className : action!.object.name
  const base = `${owner}${verb.charAt(0).toUpperCase()}${verb.slice(1)}`.replace(/[^A-Za-z0-9_$]/g, '')
  const taken = takenNames(model)
  let name = base
  for (let n = 2; taken.has(name) || nameProblem(name, taken); n++) name = `${base}${n}`
  edits.push({ from: stmt.range.from, to: stmt.range.from, insert: `${name} = ` })
  return name
}

function refText(name: string, part: LinkPart, fraction: number): string {
  return part === 'progress' ? `${name}.progress(${fraction})` : `${name}.${part}`
}

/** Link an action's start or end to another's timing, or to when an object begins or is removed (D170, D172): `at: slide.end` or `until: box.end`, naming the target first when it has no name. */
export function linkAction(ref: ActionRef, key: 'at' | 'until', target: LinkTarget, part: LinkPart, fraction = 0.5): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  if (!model || !obj || !action?.stmt || action.classAction) return
  if ('action' in target && target.action.object === ref.object && target.action.index === ref.index) return
  const edits: TextEdit[] = []
  const name = linkName(model, target, edits)
  if (!name) return
  rememberReplaced(action.stmt, ref.object, key, ref.index)
  edits.push(setPropText(source, action.stmt, key, refText(name, part, fraction)))
  applyEdits(edits)
}

/** Unlink an action's start or end: what the link replaced comes back, else the time it came to (D170, D189). */
export function unlinkAction(ref: ActionRef, key: 'at' | 'until'): void {
  restoreActionProp(ref, key)
}

/**
 * What each link replaced, as it was written, or '' when nothing was: unlinking puts it back, so a
 * value linked and unlinked is as it was (D189). Kept per object and attribute, and per action by
 * its place, for the session.
 */
const replacedByLinks = new Map<string, string>()
const replacedKey = (object: string, key: string, index?: number): string => (index === undefined ? `${object}:${key}` : `${object}:${index}:${key}`)
function rememberReplaced(block: BlockInfo, object: string, key: string, index?: number): void {
  const prop = block.props.find((p) => p.key === key)
  if (prop && prop.kind !== 'literal') return
  replacedByLinks.set(replacedKey(object, key, index), prop ? prop.raw : '')
}

/** Set, or with null remove, one property of an action's block: a value it changes, or its timing (D174). Text is written as given, and what it replaces is remembered. */
export function setActionProp(ref: ActionRef, key: string, value: AttrValue | null, asText = false): void {
  const { source, model } = state()
  const action = model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
  if (!model || !action?.stmt || action.classAction) return
  if (asText) rememberReplaced(action.stmt, ref.object, key, ref.index)
  const edit = value === null ? removeProp(source, action.stmt, key) : asText && typeof value === 'string' ? setPropText(source, action.stmt, key, value) : setProp(source, action.stmt, key, typeof value === 'number' ? (TIMING_KEY_NAMES.has(key) ? roundSeconds(value) : roundAttr(key, value)) : value)
  if (edit) applyEdits([edit])
}

/** Set where an attribute of an action begins, the `from` of a range `[from, to]` (D221); nothing happens when the attribute is not written as a range. */
export function setActionFrom(ref: ActionRef, key: string, value: number): void {
  const { source, model } = state()
  const action = model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
  if (!model || !action?.stmt || action.classAction) return
  const edit = setPropFrom(action.stmt, key, roundAttr(key, value))
  if (edit && source.slice(edit.from, edit.to) !== edit.insert) applyEdits([edit])
}

/** Set, or with null remove, one attribute in an object's declaration, as written (D174). Text is written as given, and what it replaces is remembered. */
export function setObjectProp(name: string, key: string, value: AttrValue | null, asText = false): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl) return
  if (asText) rememberReplaced(obj.decl, name, key)
  const edit = value === null ? removeProp(source, obj.decl, key) : asText && typeof value === 'string' ? setPropText(source, obj.decl, key, value) : setProp(source, obj.decl, key, typeof value === 'number' ? roundAttr(key, value) : value)
  if (edit) applyEdits([edit])
}

/** Unlink an object's attribute: what the link replaced comes back, or, when nothing is remembered, the default (D189). */
export function restoreObjectProp(name: string, key: string): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl) return
  const remembered = replacedByLinks.get(replacedKey(name, key))
  replacedByLinks.delete(replacedKey(name, key))
  const edit = remembered ? setPropText(source, obj.decl, key, remembered) : removeProp(source, obj.decl, key)
  if (edit) applyEdits([edit])
}

/** Unlink an action's property: what the link replaced comes back; a timing with nothing remembered keeps the time it came to, a change with nothing remembered goes (D189). */
export function restoreActionProp(ref: ActionRef, key: string): void {
  const { source, model } = state()
  const action = model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
  if (!model || !action?.stmt || action.classAction) return
  const id = replacedKey(ref.object, key, ref.index)
  const remembered = replacedByLinks.get(id)
  replacedByLinks.delete(id)
  let edit: TextEdit | null
  if (remembered) edit = setPropText(source, action.stmt, key, remembered)
  else if (key === 'at') edit = setProp(source, action.stmt, 'at', roundSeconds(action.start - (action.timing.delay ?? 0)))
  else if (key === 'until') edit = setProp(source, action.stmt, 'until', roundSeconds(action.end))
  else edit = removeProp(source, action.stmt, key)
  if (edit) applyEdits([edit])
}

/** Bake an object's linked attribute: what it comes to at the playhead stays as the value, and the link goes (D189). */
export function bakeObjectProp(name: string, key: string, time: number): void {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl) return
  if (key === 'at') return setLifetime(name, { at: obj.at })
  if (key === 'until') return setLifetime(name, { until: obj.until })
  const now = valueAt(model, obj, key, time)
  if (typeof now === 'number' || typeof now === 'string' || typeof now === 'boolean') setObjectProp(name, key, now)
}

/** Bake an action's linked property: a change keeps what it comes to when the animation ends; a start or end keeps its time (D189). */
export function bakeActionProp(ref: ActionRef, key: string): void {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  if (!model || !obj || !action?.stmt || action.classAction) return
  if (key === 'at') return setActionProp(ref, 'at', action.start - (action.timing.delay ?? 0))
  if (key === 'until') return setActionProp(ref, 'until', action.end)
  const now = valueAt(model, obj, key, action.end)
  if (typeof now === 'number' || typeof now === 'string' || typeof now === 'boolean') setActionProp(ref, key, now)
}

/** Link when an object begins or is removed to an action's timing or another object's life (D170). */
export function linkLifetime(objectName: string, key: 'at' | 'until', target: LinkTarget, part: LinkPart, fraction = 0.5): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === objectName)
  if (!model || !obj?.decl || obj.className === GROUP) return
  if ('object' in target && target.object === objectName) return
  const edits: TextEdit[] = []
  const name = linkName(model, target, edits)
  if (!name) return
  rememberReplaced(obj.decl, objectName, key)
  edits.push(setPropText(source, obj.decl, key, refText(name, part, fraction)))
  applyEdits(edits)
}

/** Unlink when an object begins or is removed: what the link replaced comes back, else the time it came to (D170, D189). */
export function unlinkLifetime(objectName: string, key: 'at' | 'until'): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === objectName)
  if (!model || !obj?.decl) return
  const id = replacedKey(objectName, key)
  const remembered = replacedByLinks.get(id)
  replacedByLinks.delete(id)
  if (remembered !== undefined) {
    const edit = remembered ? setPropText(source, obj.decl, key, remembered) : removeProp(source, obj.decl, key)
    if (edit) applyEdits([edit])
    return
  }
  const value = key === 'at' ? obj.at : obj.until
  const edit = value === null || (key === 'at' && value <= 0) ? removeProp(source, obj.decl, key) : setProp(source, obj.decl, key, roundSeconds(value))
  if (edit) applyEdits([edit])
}

/** Arrow keys with the timeline in use: the selected objects move by whole frames in time, as one step (D141). */
export function nudgeObjectsInTime(names: string[], frames: number): void {
  const { model, fps } = state()
  if (!model) return
  beginGesture()
  for (const name of names) {
    const obj = model.objects.find((o) => o.name === name)
    if (obj?.decl && obj.className !== GROUP) placeObject(name, obj.at + frames / fps)
  }
  endGesture()
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
  // A group has no body of its own: deleting it takes it apart and keeps its members (D124).
  const groups = names.filter((n) => model.objects.some((o) => o.name === n && o.className === GROUP))
  if (groups.length > 0) {
    const rest = names.filter((n) => !groups.includes(n))
    if (rest.length > 0) deleteObjects(rest, confirmed)
    for (const g of groups) ungroup(g, confirmed)
    return
  }
  const objects = model.objects.filter((o) => names.includes(o.name) && o.decl)
  if (objects.length === 0) return
  // A class statement whose members all go would be left talking to no one: it goes too (D121).
  const orphaned = model.classActions.filter((c) => c.stmt && c.members.length > 0 && c.members.every((m) => objects.includes(m.object)))
  const removedNames = [...objects.map((o) => o.name), ...objects.flatMap((o) => o.actions.filter((a) => !a.classAction).map((a) => a.name).filter((n): n is string => !!n)), ...orphaned.map((c) => c.name).filter((n): n is string => !!n)]
  const dependents = findDependents(model, removedNames, { objects: objects.map((o) => o.name), actions: orphaned.flatMap((c) => c.members.map((m) => ({ object: m.object.name, index: m.object.actions.indexOf(m) }))) })
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteObjects(names, true)
    const ranges: Range[] = []
    for (const obj of objects) {
      ranges.push(obj.decl!.range)
      for (const action of obj.actions) if (action.stmt && !action.classAction) ranges.push(action.stmt.range)
    }
    for (const c of orphaned) ranges.push(c.stmt!.range)
    // Members leave the groups that list them; a group left with no one goes too (D121, D124).
    const lists: TextEdit[] = []
    for (const group of model.objects) {
      if (group.className !== GROUP || !group.decl || objects.includes(group)) continue
      const list = memberNames(group)
      const next = list.filter((n) => !objects.some((o) => o.name === n))
      if (next.length === list.length) continue
      if (next.length > 0) lists.push(setProp(source, group.decl, 'members', next.join(' ')))
      else {
        ranges.push(group.decl.range)
        for (const action of group.actions) if (action.stmt && !action.classAction) ranges.push(action.stmt.range)
      }
    }
    applyEdits([...removeStatements(source, ranges), ...resolutionEdits(model, source, dependents), ...lists], objectsSelected([]))
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
  // Deleting an object's last fade puts its written opacity back to the default, so nothing stays invisible or half shown by accident (D154).
  const resets: TextEdit[] = []
  for (const name of new Set(removed.map((r) => r.object))) {
    const obj = model.objects.find((o) => o.name === name)
    const prop = obj?.decl?.props.find((p) => p.key === 'opacity')
    if (!obj?.decl || !prop || prop.kind !== 'literal') continue
    const gone = new Set(removed.filter((r) => r.object === name).map((r) => r.index))
    const wasFade = obj.actions.some((a, i) => gone.has(i) && 'opacity' in a.changes)
    const fadesLeft = obj.actions.some((a, i) => !gone.has(i) && !a.overridden && 'opacity' in a.changes)
    if (!wasFade || fadesLeft) continue
    const reset = removeProp(source, obj.decl, 'opacity')
    if (reset) resets.push(reset)
  }
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteActions(refs, true)
    applyEdits([...removeStatements(source, [...stmts].map((s) => s.range)), ...resolutionEdits(model, source, dependents), ...resets], objectsSelected(keep))
  }
  if (confirmed) run()
  else confirmRemoval(labels.length === 1 ? `Delete ${labels[0]}?` : `Delete ${labels.length} actions?`, dependents, run)
}

export function deleteAction(name: string, index: number): void {
  deleteActions([{ object: name, index }])
}

/**
 * Take a class away: its name leaves every member's `class`, and every `all('name')` statement
 * goes, after confirming when other code refers to them. The objects stay (D121).
 */
export function deleteClass(className: string, confirmed = false): void {
  const { source, model } = state()
  if (!model) return
  const statements = model.classActions.filter((c) => c.className === className && c.stmt)
  const members = model.objects.filter((o) => o.classes.includes(className) && o.decl)
  const names = statements.map((c) => c.name).filter((n): n is string => !!n)
  const dependents = names.length > 0 ? findDependents(model, names, { objects: [], actions: statements.flatMap((c) => c.members.map((m) => ({ object: m.object.name, index: m.object.actions.indexOf(m) }))) }) : []
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteClass(className, true)
    const edits: TextEdit[] = [...removeStatements(source, statements.map((c) => c.stmt!.range)), ...resolutionEdits(model, source, dependents)]
    for (const member of members) {
      const next = member.classes.filter((c) => c !== className)
      const edit = next.length > 0 ? setProp(source, member.decl!, 'class', next.join(' ')) : removeProp(source, member.decl!, 'class')
      if (edit) edits.push(edit)
    }
    applyEdits(edits, objectsSelected([]))
  }
  if (confirmed) run()
  else confirmRemoval(`Delete the class ${className}?`, dependents, run)
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
  applyEdits(moveStatementEdits(source, obj.decl.range, other.decl.range, 'before' in target ? 'before' : 'after'), objectsSelected([name]))
}

/**
 * Put an action's statement before or after another of the same object's own, which moves it in
 * the stack (D210): higher in the file is higher in the clip, and has the say while it runs. The
 * selection follows the moved action to its new index.
 */
export function moveAction(ref: ActionRef, target: { before: ActionRef } | { after: ActionRef }): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const other = 'before' in target ? target.before : target.after
  const action = obj?.actions[ref.index]
  const otherAction = obj?.actions[other.index]
  if (!model || !obj || other.object !== ref.object || !action?.stmt || action.classAction || !otherAction?.stmt || otherAction.classAction || action === otherAction) return
  const where = 'before' in target ? 'before' : 'after'
  const at = obj.actions.indexOf(action)
  const otherAt = obj.actions.indexOf(otherAction)
  if (where === 'before' ? at === otherAt - 1 : at === otherAt + 1) return
  const reordered = obj.actions.filter((a) => a !== action)
  reordered.splice(reordered.indexOf(otherAction) + (where === 'after' ? 1 : 0), 0, action)
  applyEdits(moveStatementEdits(source, action.stmt.range, otherAction.stmt.range, where), actionSelected(ref.object, reordered.indexOf(action)))
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
  // A copied group lists the copies of its members (D124).
  const declTexts = items.map((i) => renameMembers(replaceIdentifiers(`${renames[i.name]} = ${i.className}({${i.propsText}})`, renames), renames))
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
    // Groups list members by name in a string, which the identifier edits do not reach (D124).
    const edits = identifierEdits(source, { [obj.name]: newName })
    for (const group of model.objects) {
      if (group.className !== GROUP || !group.decl) continue
      const list = memberNames(group)
      if (list.includes(obj.name)) edits.push(setProp(source, group.decl, 'members', list.map((n) => (n === obj.name ? newName : n)).join(' ')))
    }
    applyEdits(edits, objectsSelected([newName]))
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
  const valid = names.filter((n) => model?.objects.some((o) => o.name === n && o.decl && o.className !== GROUP))
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

/** The names a group lists, as written. */
function memberNames(group: SceneObject): string[] {
  const written = group.attrs['members']
  return typeof written === 'string' ? written.split(/\s+/).filter(Boolean) : []
}

/**
 * Make several things one group: one declaration listing them, nothing written into the
 * members (D124). The new group is selected. Returns its name, or null.
 */
export function createGroup(names: string[]): string | null {
  const { model } = state()
  if (!model) return null
  // One set of things is one group: a member of a selected group is already in it, and a set that already is a group is that group (D124).
  const members = normalizeSelection(model, names.filter((n) => model.objects.some((o) => o.name === n && o.decl)))
  if (members.length === 1) {
    const only = model.objects.find((o) => o.name === members[0])
    if (only?.className !== GROUP) return null
    useStore.getState().select([only.name])
    return only.name
  }
  if (members.length === 0) return null
  const name = uniqueName('group')
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = Group`, { members: members.join(' ') }))], objectsSelected([name]))
  return name
}

/**
 * Take a group apart: its members keep their own values, its declaration and its animations go,
 * and any group listing it lists its members instead (D124). Asks first when it has animations
 * or something refers to it.
 */
export function ungroup(name: string, confirmed = false): void {
  const { source, model } = state()
  const group = model?.objects.find((o) => o.name === name && o.className === GROUP)
  if (!model || !group?.decl) return
  const actions = group.actions.filter((a) => a.stmt && !a.classAction)
  const names = [group.name, ...actions.map((a) => a.name).filter((n): n is string => !!n)]
  const dependents = findDependents(model, names, { objects: [group.name], actions: actions.map((a) => ({ object: group.name, index: group.actions.indexOf(a) })) })
  const members = model.groups.get(group.name) ?? []
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return ungroup(name, true)
    const edits: TextEdit[] = []
    for (const outer of model.objects) {
      if (outer.className !== GROUP || outer === group || !outer.decl) continue
      const list = memberNames(outer)
      if (!list.includes(group.name)) continue
      edits.push(setProp(source, outer.decl, 'members', [...new Set(list.flatMap((n) => (n === group.name ? members : [n])))].join(' ')))
    }
    const ranges: Range[] = [group.decl!.range, ...actions.map((a) => a.stmt!.range)]
    applyEdits([...removeStatements(source, ranges), ...resolutionEdits(model, source, dependents), ...edits], objectsSelected(members.filter((m) => model.objects.some((o) => o.name === m))))
  }
  // What the group itself has moved, turned, or scaled goes with it, so its members would move back.
  const posed = ['x', 'y', 'rotation', 'scale'].filter((attr) => group.attrs[attr] !== undefined)
  if (confirmed || (actions.length === 0 && dependents.length === 0 && posed.length === 0)) run()
  else
    useStore.getState().openDialog({
      title: `Ungroup ${name}?`,
      message: 'Its members keep their own values; what the group itself has moved, turned, or scaled goes with it, as do its animations. Time references keep the time they resolve to now, links and overrides fall back to nothing.',
      items: [...(posed.length > 0 ? [`${name}: ${posed.join(', ')}`] : []), ...actions.map((a) => `${a.name ? `${a.name} = ` : ''}${name}.${a.verb}`), ...dependents.map((d) => d.label)],
      confirmLabel: 'Ungroup',
      danger: true,
      onConfirm: run,
    })
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
