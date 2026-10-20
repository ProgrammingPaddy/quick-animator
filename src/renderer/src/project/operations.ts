import { applyEdits, beginGesture, endGesture, foldShapes, gestureOpen, scrollToPos } from '../code/editor'
import { findDependents, type Dependent } from '../model/dependents'
import { appendStatement, blockText, formatNumber, insertDeclaration, lineEdit, moveStatementEdits, removeProp, removeStatements, setProp, setPropFrom, setPropText, type TextEdit } from '../model/edits'
import { isMember } from '../model/evaluate'
import { memberRef, normalizeSelection } from '../model/groups'
import { classes, GROUP, SHAPE, TIMING_KEY_NAMES, VERB_ATTRS, type AttrValue, type Verb } from '../model/registry'
import { absoluteAt, anchorTime, memberBox, pathFrame, pathHolds, pathShift, pointsCenter, positionAt, rawFromWorld, shapeCurves, shapeOwnFromWorld, shapeOwnPoints, shapeOwnSegs, travelFrame, type Point, type ShapePiece } from '../model/sample'
import { anchorCurved, anchorKind, closePath, cornerAnchors, curveSegment, dragAnchorHandle, ellipsePathData, flattenPathData, formatCurves, hasPathData, moveAnchor, openPath, parsePathData, pathAnchors, pathDataBounds, polygonPathData, removeAnchor, scalePathData, segmentKind, serializePathData, smoothAnchors, smoothPathData, splitSegment, straightenAll, straightenAnchors, straightenSegment, translatePathData, type Anchor, type AnchorKind, type Seg } from '../model/pathData'
import { insertPointsEdit, pointText, removePointEdit, setPointEdit, shapeLiteral, stringLiteral, type ShapeLiteral } from '../model/pathEdits'
import { readSvg, scaleImported, type ImportedItem } from './svgImport'
import { identifierEdits, nameProblem, renameMembers, replaceIdentifiers } from '../model/rename'
import { currentWritten, definingAction, shownValue, valueAt, withWritten, writesFrom, writtenValues } from '../model/sample'
import type { Action, ActionInfo, BlockInfo, ClassAction, PropInfo, Range, SceneModel, SceneObject } from '../model/types'
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
  // A stock Shape is a triangle; the Shape tool draws one point by point instead (D233).
  if (className === SHAPE) Object.assign(attrs, { points: [[0, 50], [-60, -50], [60, -50]], fill: '#4f8cff' })
  // A new object begins where the playhead is and lasts as long as the preferences say (D138, D145).
  if (at > 0) attrs['at'] = roundSeconds(at)
  const length = useStore.getState().prefs.objectLength
  if (length !== null) attrs['until'] = roundSeconds(at + length)
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = ${className}`, attrs))], objectsSelected([name]))
  // A Shape's points stay folded until wanted (D204, D244).
  if (className === SHAPE) foldShapes()
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

/** The outline a new morph starts from, as path data in the shape's own space (D257): the target of the morph in force at the time, else the shape's own curves, or its points as lines or as their smooth curve. */
function outlineSegsAt(model: SceneModel, obj: SceneObject, time: number): Seg[] | null {
  const inForce = obj.actions.filter((a) => a.verb === 'morph' && !a.overridden && a.start <= time).sort((a, b) => a.id - b.id).pop()
  const raw = inForce?.changes['to']
  if (hasPathData(raw)) return parsePathData(raw)
  if (Array.isArray(raw)) {
    const points = (raw as unknown[]).filter((p): p is number[] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map((p) => ({ x: p[0]!, y: p[1]! }))
    if (points.length >= 2) return polygonPathData(points, true)
  }
  const own = shapeOwnSegs(model, obj, time)
  if (own) return own
  const points = shapeOwnPoints(model, obj, time)
  if (points.length < 2) return null
  const closed = valueAt(model, obj, 'closed', time) !== false
  return valueAt(model, obj, 'smooth', time) === true && points.length >= 3 ? smoothPathData(points, closed) : polygonPathData(points, closed)
}

/** Add a morph to a Shape (D257): its target the outline as it is then, written as curves, the morph selected and the playhead at its end, so the Shape tool's handles then shape the target. Returns the morph's index, or null. */
export function addMorph(name: string, time: number, length = 1, pin: Pin = 'start'): number | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || obj.className !== SHAPE) return null
  const segs = outlineSegsAt(model, obj, time)
  if (!segs) return null
  const { at, duration } = pinnedSpan(pin, time, length)
  const index = obj.actions.length
  applyEdits([appendStatement(source, blockText(`${name}.morph`, { to: serializePathData(segs), at, duration })), ...coverEdits(source, obj, at, at + duration)], actionSelected(name, index))
  useStore.getState().setTime(at + duration)
  foldShapes()
  return index
}

/** Add an action of a kind at a time. Its values start as the object's current ones, so nothing jumps. */
export function addAction(name: string, verb: Verb, time: number): void {
  if (verb === 'path') {
    addPath(name, time)
    return
  }
  if (verb === 'morph') {
    addMorph(name, time)
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
  if (verb === 'morph') {
    // Every member morphs to the same target, which starts as the first member's outline (D257).
    const segs = first.className === SHAPE ? outlineSegsAt(model, first, roundSeconds(time)) : null
    if (!segs) return
    applyEdits([appendStatement(source, blockText(`all('${className}').morph`, { to: serializePathData(segs), at: roundSeconds(time), duration: 1 }))], actionSelected(first.name, first.actions.length))
    foldShapes()
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
  /** The statement the shape is written in: the object's own, or the class statement every member follows (D247). */
  stmt: ActionInfo
  shape: ShapeLiteral
}

/** The statement a path is written in, when it can be edited: a class path is edited where it is written, for every member at once (D247). */
function pathStmt(action: Action | undefined): ActionInfo | null {
  if (!action || action.verb !== 'path' || action.overridden) return null
  return action.classAction ? action.classAction.stmt : action.stmt
}

/** A path action with its shape written as literal points, in the object's own statement, which the GUI edits point by point (D194). */
function editableShape(ref: ActionRef): EditableShape | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  const stmt = pathStmt(action)
  if (!model || !obj || !action || !stmt) return null
  const shape = shapeLiteral(source, stmt)
  return shape ? { source, model, obj, action, stmt, shape } : null
}

interface EditableCurves {
  source: string
  model: SceneModel
  obj: SceneObject
  action: Action
  stmt: ActionInfo
  literal: { prop: PropInfo; range: Range; value: string }
  segs: Seg[]
}

/** A path action whose shape is written as curves, SVG path data, in its statement, which the GUI edits anchor by anchor (D246). */
function editableCurves(ref: ActionRef): EditableCurves | null {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === ref.object)
  const action = obj?.actions[ref.index]
  const stmt = pathStmt(action)
  if (!model || !obj || !action || !stmt) return null
  const literal = stringLiteral(source, stmt, 'shape')
  return literal && hasPathData(literal.value) ? { source, model, obj, action, stmt, literal, segs: parsePathData(literal.value) } : null
}

/** What the preview can edit of a path's shape: points written as a list (D194), curves written as a string (D246), or nothing. */
export function pathEditableKind(ref: ActionRef): 'points' | 'curves' | null {
  if (editableCurves(ref)) return 'curves'
  return editableShape(ref) ? 'points' : null
}

/** Whether the preview can edit a path's shape: its points or its curves are written out in the object's own statement. */
export function pathEditable(ref: ActionRef): boolean {
  return pathEditableKind(ref) !== null
}

/** Write a path's curves, the anchors that did not move keeping their numbers. */
function writePathCurves(e: EditableCurves, segs: Seg[]): void {
  const edit = lineEdit(e.source, e.literal.range.from, e.literal.range.to, formatCurves(serializePathData(segs), e.stmt.indent))
  if (edit) applyEdits([edit])
}

/** The literal a point of the scene is written as in a path's curves, to a hundredth, at the time the object reaches an anchor: as `rawPoint`. */
function rawCurvePoint(e: EditableCurves, world: Point, time: number): Point {
  const p = rawFromWorld(e.model, e.obj, e.action, time, world)
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }
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

/** Move several points of a path at once, each to a place in the scene (D198); on a curves path, the anchors, their controls along (D246). */
export function setPathPoints(ref: ActionRef, entries: { index: number; world: Point }[]): void {
  const cur = editableCurves(ref)
  if (cur) {
    let segs = cur.segs
    const count = pathAnchors(segs).length
    for (const { index, world } of entries) {
      if (index < 0 || index >= count) continue
      const p = rawCurvePoint(cur, world, anchorTime(cur.model, cur.action, index))
      segs = moveAnchor(segs, index, p.x, p.y)
    }
    writePathCurves(cur, segs)
    return
  }
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

/** Take several points out of a path, as one undo step; at least one point stays (D198); on a curves path the segments on either side of a gone anchor become one (D246). */
export function removePathPoints(ref: ActionRef, indices: number[]): void {
  const sorted = [...new Set(indices)].sort((a, b) => b - a)
  if (sorted.length === 0) return
  const cur = editableCurves(ref)
  if (cur) {
    let segs = cur.segs
    for (const index of sorted) {
      const anchors = pathAnchors(segs)
      if (anchors.length <= 1) break
      if (index >= 0 && index < anchors.length) segs = removeAnchor(segs, index)
    }
    if (segs !== cur.segs) writePathCurves(cur, segs)
    return
  }
  beginGesture()
  for (const index of sorted) removePathPoint(ref, index)
  endGesture()
}

/** Make a path a smooth curve through its points, or straight lines between them (D199); a curves path is its own curve and keeps it. A class path changes for every member (D247). */
export function setPathSmooth(ref: ActionRef, smooth: boolean): void {
  if (editableCurves(ref)) return
  const { source, model } = state()
  const stmt = pathStmt(model?.objects.find((o) => o.name === ref.object)?.actions[ref.index])
  if (!stmt) return
  const edit = smooth ? setProp(source, stmt, 'smooth', true) : removeProp(source, stmt, 'smooth')
  if (edit) applyEdits([edit])
}

/** Move one control of an anchor of a curves path to a place in the scene; with `smooth`, the other control stays in line (D246). */
export function setPathHandle(ref: ActionRef, index: number, which: 'in' | 'out', world: Point, smooth = false): void {
  const cur = editableCurves(ref)
  if (!cur) return
  const p = rawCurvePoint(cur, world, anchorTime(cur.model, cur.action, index))
  writePathCurves(cur, dragAnchorHandle(cur.segs, index, which, p.x, p.y, smooth))
}

/** What an anchor of a path is (D252): smooth, a corner, or straight; a points path's are straight, or smooth when the path is. */
export function pathAnchorKind(ref: ActionRef, index: number): AnchorKind {
  const cur = editableCurves(ref)
  if (cur) return anchorKind(cur.segs, index)
  const e = editableShape(ref)
  if (e && (index === 0 || index === e.shape.points.length - 1)) return 'end'
  return e?.action.changes['smooth'] === true ? 'smooth' : 'straight'
}

/** Whether a segment on either side of a path's anchor is a curve, so an end of it has a handle to straighten (D252). */
export function pathAnchorCurved(ref: ActionRef, index: number): boolean {
  const cur = editableCurves(ref)
  if (cur) return anchorCurved(cur.segs, index)
  return editableShape(ref)?.action.changes['smooth'] === true
}

/** Whether an anchor of a path is smooth, its controls in line, so a drag of one control turns the other (D245). */
export function pathAnchorSmooth(ref: ActionRef, index: number): boolean {
  return pathAnchorKind(ref, index) === 'smooth'
}

/** Whether a segment of a path, the one ending at the anchor of `seg`, is a curve or a line (D252); on a points path, `seg` is the index of the point it ends at. */
export function pathSegmentKind(ref: ActionRef, seg: number): 'curve' | 'line' {
  const cur = editableCurves(ref)
  if (cur) return segmentKind(cur.segs, seg)
  return editableShape(ref)?.action.changes['smooth'] === true ? 'curve' : 'line'
}

/** A points path as curves, its lines or its spline, so one anchor or segment can be edited (D249). */
function pathAsCurves(ref: ActionRef): EditableCurves | null {
  const cur = editableCurves(ref)
  if (cur) return cur
  convertPathToCurves(ref)
  return editableCurves(ref)
}

/** Make anchors of a path smooth, corners, or straight (D252); a points path becomes curves first. */
export function setPathAnchorKind(ref: ActionRef, indices: number[], kind: AnchorKind): void {
  beginGesture()
  try {
    const cur = pathAsCurves(ref)
    if (!cur) return
    writePathCurves(cur, kind === 'smooth' ? smoothAnchors(cur.segs, indices) : kind === 'corner' ? cornerAnchors(cur.segs, indices) : straightenAnchors(cur.segs, indices))
  } finally {
    endGesture()
  }
}

/** Make a segment of a path a curve or a line (D252); a points path becomes curves first, where `seg` is the index of the point the segment ends at. */
export function setPathSegment(ref: ActionRef, seg: number, kind: 'curve' | 'line'): void {
  beginGesture()
  try {
    const cur = pathAsCurves(ref)
    if (!cur) return
    writePathCurves(cur, kind === 'curve' ? curveSegment(cur.segs, seg) : straightenSegment(cur.segs, seg))
  } finally {
    endGesture()
  }
}

/** Make a path smooth (D249): every anchor of its curves smooth; a points path becomes curves, the spline through its points, with handles. */
export function smoothPath(ref: ActionRef): void {
  const cur = editableCurves(ref)
  if (cur) {
    writePathCurves(cur, smoothAnchors(cur.segs, pathAnchors(cur.segs).map((_, i) => i)))
    return
  }
  convertPathToCurves(ref, true)
}

/** Make a path straight (D249): every segment of its curves a line; a points path loses `smooth`. */
export function straightenPath(ref: ActionRef): void {
  const cur = editableCurves(ref)
  if (cur) {
    writePathCurves(cur, straightenAll(cur.segs))
    return
  }
  setPathSmooth(ref, false)
}

/** Put an anchor into a curves path on a segment, a fraction of the way along it, the curve kept (D246). Returns the new anchor's index. */
export function insertPathAnchor(ref: ActionRef, seg: number, t: number): number | null {
  const cur = editableCurves(ref)
  if (!cur) return null
  const { segs, anchor } = splitSegment(cur.segs, seg, t)
  if (segs === cur.segs) return null
  writePathCurves(cur, segs)
  return anchor
}

/** Write a points path as curves (D246, D249): its lines as lines, or its smooth curve as the cubic curves it is; `smooth` goes. */
export function convertPathToCurves(ref: ActionRef, smoothen?: boolean): void {
  const e = editableShape(ref)
  if (!e || e.shape.points.length < 2) return
  const points = e.shape.points.map((p) => ({ x: p.x, y: p.y }))
  const smooth = smoothen ?? e.action.changes['smooth'] === true
  const segs = smooth && points.length >= 3 ? smoothPathData(points, false) : polygonPathData(points, false)
  const edits: TextEdit[] = [setPropText(e.source, e.stmt, 'shape', formatCurves(serializePathData(segs), e.stmt.indent))]
  const dropSmooth = removeProp(e.source, e.stmt, 'smooth')
  if (dropSmooth) edits.push(dropSmooth)
  applyEdits(edits, actionSelected(ref.object, ref.index))
  foldShapes()
}

/**
 * Add a path to a class (D247): `all('name').path`, relative, so every member follows it from
 * its own place, beginning at the playhead; the Path tool adds the rest of its points.
 */
export function addClassPath(className: string, time: number): void {
  const { source, model } = state()
  if (!model) return
  const at = roundSeconds(time)
  applyEdits([appendStatement(source, `all('${className}').path({\n  shape: [\n    [0, 0],\n  ],\n  relative: true,\n  at: ${formatNumber(at)},\n  duration: 1,\n})`)])
  foldShapes()
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

/** Put points into a path so that the first lands at `index`; the count appends (D194). On a curves path they come in as corners, with lines to and from them (D246). */
export function insertPathPoints(ref: ActionRef, index: number, worlds: Point[]): void {
  const cur = editableCurves(ref)
  if (cur) {
    const anchors = pathAnchors(cur.segs)
    const at = Math.max(0, Math.min(index, anchors.length))
    const time = at > 0 ? anchorTime(cur.model, cur.action, Math.min(at, anchors.length) - 1) : cur.action.start
    const raws = worlds.map((w) => rawCurvePoint(cur, w, time))
    const lines = raws.map((p): Seg => ({ c: 'L', x: p.x, y: p.y }))
    const segs = [...cur.segs]
    if (at >= anchors.length) segs.push(...lines)
    else if (at === 0) {
      const first = segs[0]
      if (first?.c === 'M') segs[0] = { c: 'L', x: first.x, y: first.y }
      segs.unshift({ c: 'M', x: raws[0]!.x, y: raws[0]!.y }, ...lines.slice(1))
    } else segs.splice(anchors[at]!.seg, 0, ...lines)
    writePathCurves(cur, segs)
    return
  }
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

interface EditableShapePoints {
  source: string
  model: SceneModel
  obj: SceneObject
  shape: ShapeLiteral
}

/** A Shape whose points are written as a literal list in its declaration, which the GUI edits point by point (D233), and which draws them rather than a path. */
function shapeLiteralOf(name: string): EditableShapePoints | null {
  const { source, model, time } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || obj.className !== SHAPE || shapeCurves(model, obj, time) !== null) return null
  const shape = shapeLiteral(source, obj.decl, 'points')
  return shape ? { source, model, obj, shape } : null
}

interface EditableShapeCurves {
  source: string
  model: SceneModel
  obj: SceneObject
  literal: { prop: PropInfo; range: Range; value: string }
  /** The path as written, which the shape draws with the center of its box at its x and y (D235); a morph's target as written, drawn where it is (D257). */
  written: Seg[]
  /** The center of the box around the written path's line; the origin for a morph's target. */
  center: Point
  /** The morph whose target this is, when one of the shape's morphs is selected (D257). */
  target?: Action
}

/** The morph of a Shape that is selected, when one is and it is written in the object's own statement (D257). */
function selectedMorph(obj: SceneObject): Action | null {
  const { selectedActions } = useStore.getState()
  const ref = selectedActions.length === 1 ? selectedActions[0]! : null
  if (!ref || ref.object !== obj.name) return null
  const action = obj.actions[ref.index]
  return action && action.verb === 'morph' && !action.overridden && !action.classAction && action.stmt ? action : null
}

/** Whether one of a Shape's morphs is selected, so the Shape tool edits its target (D257). */
export function shapeMorphSelected(name: string): boolean {
  const obj = findObject(name)
  return !!obj && selectedMorph(obj) !== null
}

/** A Shape whose curves are written as a literal string in its declaration, which the GUI edits anchor by anchor (D240); with one of its morphs selected, that morph's target when it is written as curves (D257). */
function shapeCurvesOf(name: string): EditableShapeCurves | null {
  const { source, model, time } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || obj.className !== SHAPE) return null
  const target = selectedMorph(obj)
  if (target) {
    const literal = stringLiteral(source, target.stmt!, 'to')
    if (!literal || !hasPathData(literal.value)) return null
    return { source, model, obj, literal, written: parsePathData(literal.value), center: { x: 0, y: 0 }, target }
  }
  if (shapeCurves(model, obj, time) === null) return null
  const literal = stringLiteral(source, obj.decl, 'curves')
  if (!literal || !hasPathData(literal.value)) return null
  const written = parsePathData(literal.value)
  const b = pathDataBounds(written)
  return { source, model, obj, literal, written, center: { x: b.x, y: b.y } }
}

/** What the preview can edit of a Shape: its points, written as a list (D233), its curves, written as a string (D240), or nothing; a selected morph whose target is not written as curves is edited in the code (D257). */
export function shapeEditable(name: string): 'points' | 'curves' | null {
  if (shapeCurvesOf(name)) return 'curves'
  const obj = findObject(name)
  if (obj && selectedMorph(obj)) return null
  return shapeLiteralOf(name) ? 'points' : null
}

/** The anchors the Shape tool edits, in the shape's own space (D257): the selected morph's target, or the shape's own curves as they are drawn. */
export function shapeEditAnchors(name: string): Anchor[] {
  const cur = shapeCurvesOf(name)
  return cur ? pathAnchors(translatePathData(cur.written, -cur.center.x, -cur.center.y)) : []
}

/** The pieces of the outline the Shape tool edits, in the shape's own space, each point with where it came from (D257). */
export function shapeEditPieces(name: string): ShapePiece[] {
  const cur = shapeCurvesOf(name)
  return cur ? flattenPathData(translatePathData(cur.written, -cur.center.x, -cur.center.y)).map((sp) => ({ curve: sp.points, closed: sp.closed, filled: sp.points.length >= 3, at: sp.at })) : []
}

/** Whether the preview can edit a Shape's points: they are a literal list in its declaration. */
export function shapePointsEditable(name: string): boolean {
  return shapeLiteralOf(name) !== null
}

/** What a gesture on a Shape's points or curves starts from (D243): the geometry as written and the shape's position, so every write of the gesture is computed afresh from them and nothing drifts. */
export type ShapeEditBase = { kind: 'points'; points: Point[]; center: Point; origin: Point | null } | { kind: 'curves'; segs: Seg[]; center: Point; origin: Point | null }

export function shapeEditBase(name: string): ShapeEditBase | null {
  const origin = (obj: SceneObject): Point | null => (typeof obj.attrs['x'] === 'number' && typeof obj.attrs['y'] === 'number' ? { x: obj.attrs['x'], y: obj.attrs['y'] } : null)
  const cur = shapeCurvesOf(name)
  if (cur) return { kind: 'curves', segs: cur.written, center: cur.center, origin: origin(cur.obj) }
  const e = shapeLiteralOf(name)
  if (!e) return null
  const points = e.shape.points.map((p) => ({ x: p.x, y: p.y }))
  return { kind: 'points', points, center: pointsCenter(points), origin: origin(e.obj) }
}

/**
 * The edits that move a shape's x and y by where the center of its geometry went, through its
 * own turn and scale, so every other point stays where it is drawn (D235, D243): `delta` is the
 * new center against the old, in the shape's own space, and `origin` the position a gesture
 * began from, so repeated writes never pile the shift up. The shift is written to a hundredth
 * of a pixel, so nothing else moves.
 */
function centerShift(source: string, obj: SceneObject, delta: Point, origin?: Point | null): TextEdit[] {
  const x = origin ? origin.x : obj.attrs['x']
  const y = origin ? origin.y : obj.attrs['y']
  if (typeof x !== 'number' || typeof y !== 'number') return []
  const rotation = typeof obj.attrs['rotation'] === 'number' ? obj.attrs['rotation'] : 0
  const scale = typeof obj.attrs['scale'] === 'number' && obj.attrs['scale'] !== 0 ? obj.attrs['scale'] : 1
  const a = (rotation * Math.PI) / 180
  const nx = Math.round((x + scale * (Math.cos(a) * delta.x - Math.sin(a) * delta.y)) * 100) / 100
  const ny = Math.round((y + scale * (Math.sin(a) * delta.x + Math.cos(a) * delta.y)) * 100) / 100
  const edits: TextEdit[] = []
  if (nx !== obj.attrs['x']) edits.push(setProp(source, obj.decl!, 'x', nx))
  if (ny !== obj.attrs['y']) edits.push(setProp(source, obj.decl!, 'y', ny))
  return edits
}

/** Write a Shape's curves whole, recentered (D240): the box around its line at the origin, to a hundredth of a pixel, with its x and y moved by where the center went. For a resize or a conversion, where every number changes anyway. */
function writeShapeCurves(e: EditableShapeCurves, own: Seg[], origin?: Point): void {
  // A morph's target is drawn where it is written, so it is written as it is (D257).
  if (e.target) {
    writeCurvesAsIs(e, own)
    return
  }
  const c = pathDataBounds(own)
  const edits: TextEdit[] = []
  const edit = lineEdit(e.source, e.literal.range.from, e.literal.range.to, formatCurves(serializePathData(translatePathData(own, -c.x, -c.y)), e.obj.decl!.indent))
  if (edit) edits.push(edit)
  edits.push(...centerShift(e.source, e.obj, { x: c.x, y: c.y }, origin))
  if (edits.length > 0) applyEdits(edits)
}

/** Write a Shape's curves as they are, the anchors that did not move keeping their numbers (D243), by the lines that changed, so the fold over them stays (D254): x and y take the shift of the center, from the base of the gesture when there is one. */
function writeCurvesAsIs(e: EditableShapeCurves, segs: Seg[], base?: ShapeEditBase): void {
  const edits: TextEdit[] = []
  const edit = lineEdit(e.source, e.literal.range.from, e.literal.range.to, formatCurves(serializePathData(segs), e.target ? e.target.stmt!.indent : e.obj.decl!.indent))
  if (edit) edits.push(edit)
  // A morph's target is drawn where it is written, so x and y stay (D257).
  if (!e.target) {
    const c = pathDataBounds(segs)
    const ref = base ? base.center : e.center
    edits.push(...centerShift(e.source, e.obj, { x: c.x - ref.x, y: c.y - ref.y }, base?.origin))
  }
  if (edits.length > 0) applyEdits(edits)
}

/** A place in the scene as a Shape's points are written: against the center of their box as it is written now (D243). */
function writtenPoint(e: EditableShapePoints, world: Point): Point {
  const c = pointsCenter(e.shape.points)
  const own = ownPoint(e, world)
  return { x: Math.round(c.x + own.x), y: Math.round(c.y + own.y) }
}

/** A place in the scene as a Shape's curves are written. */
function writtenCurvePoint(e: EditableShapeCurves, world: Point): Point {
  const own = shapeOwnFromWorld(e.model, e.obj, state().time, world)
  return { x: e.center.x + own.x, y: e.center.y + own.y }
}

/** A place in the scene in a Shape's own space, where its points live (D235). */
function ownPoint(e: EditableShapePoints, world: Point): Point {
  return shapeOwnFromWorld(e.model, e.obj, state().time, world)
}

/**
 * Write a Shape's points whole (D235): centered on their box, whole pixels, one per line when
 * the list was written that way; and the shape's x and y moved by where the center went,
 * through its own turn and scale, so every other point stays where it is drawn. Only where the
 * points are against each other counts, so a list written off center is centered the first time
 * the GUI writes it, and nothing moves.
 */
function writeShapePoints(e: EditableShapePoints, own: Point[], origin?: Point): void {
  const c = pointsCenter(own)
  const points = own.map((p) => ({ x: Math.round(p.x - c.x), y: Math.round(p.y - c.y) }))
  const decl = e.obj.decl!
  const indent = decl.indent
  const text = e.shape.multiline ? `[\n${points.map((p) => `${indent}  ${pointText(p.x, p.y)},`).join('\n')}\n${indent}]` : `[${points.map((p) => pointText(p.x, p.y)).join(', ')}]`
  const edits: TextEdit[] = []
  const edit = lineEdit(e.source, e.shape.range.from, e.shape.range.to, text)
  if (edit) edits.push(edit)
  edits.push(...centerShift(e.source, e.obj, c, origin))
  if (edits.length > 0) applyEdits(edits)
}

/**
 * Move points of a Shape, each to a place in the scene: its points (D233), or the anchors of its
 * curves, their controls along (D240). Only those points' numbers change; x and y take the shift
 * of the center, so nothing else moves, and a gesture computes every write from its base (D243).
 */
export function setShapePoints(name: string, entries: { index: number; world: Point }[], base?: ShapeEditBase): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    let segs = base?.kind === 'curves' ? base.segs : cur.written
    const count = pathAnchors(segs).length
    for (const { index, world } of entries) {
      if (index < 0 || index >= count) continue
      const p = writtenCurvePoint(cur, world)
      segs = moveAnchor(segs, index, p.x, p.y)
    }
    writeCurvesAsIs(cur, segs, base)
    return
  }
  const e = shapeLiteralOf(name)
  if (!e) return
  const points = (base?.kind === 'points' ? base.points : e.shape.points).map((p) => ({ x: p.x, y: p.y }))
  const edits: TextEdit[] = []
  for (const { index, world } of entries) {
    if (index < 0 || index >= points.length) continue
    points[index] = writtenPoint(e, world)
    const edit = setPointEdit(e.shape, index, points[index]!.x, points[index]!.y)
    if (edit && e.source.slice(edit.from, edit.to) !== edit.insert) edits.push(edit)
  }
  const c = pointsCenter(points)
  const ref = base?.kind === 'points' ? base.center : pointsCenter(e.shape.points)
  edits.push(...centerShift(e.source, e.obj, { x: c.x - ref.x, y: c.y - ref.y }, base?.origin))
  if (edits.length > 0) applyEdits(edits)
}

/** Put points into a Shape so that the first lands at `index`; the count appends (D233). Only the new points are written; x and y take the center's shift (D243). */
export function insertShapePoints(name: string, index: number, worlds: Point[]): void {
  const e = shapeLiteralOf(name)
  if (!e || worlds.length === 0) return
  const at = Math.max(0, Math.min(index, e.shape.points.length))
  const added = worlds.map((w) => writtenPoint(e, w))
  const edit = insertPointsEdit(e.source, e.shape, at, added)
  if (!edit) return
  const before = pointsCenter(e.shape.points)
  const after = pointsCenter([...e.shape.points.slice(0, at), ...added, ...e.shape.points.slice(at)])
  applyEdits([edit, ...centerShift(e.source, e.obj, { x: after.x - before.x, y: after.y - before.y })])
}

/** Take points out of a Shape; a closed one keeps three, a line two (D233); curves keep two anchors, the segments on either side of a gone one becoming one (D240). The rest keep their numbers; x and y take the center's shift (D243). */
export function removeShapePoints(name: string, indices: number[]): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    let segs = cur.written
    for (const index of [...new Set(indices)].sort((a, b) => b - a)) {
      const anchors = pathAnchors(segs)
      if (anchors.length <= 2) break
      if (index >= 0 && index < anchors.length) segs = removeAnchor(segs, index)
    }
    if (segs !== cur.written) writeCurvesAsIs(cur, segs)
    return
  }
  const e = shapeLiteralOf(name)
  if (!e) return
  const least = e.obj.attrs['closed'] === false ? 2 : 3
  const gone = new Set<number>()
  for (const index of [...new Set(indices)].sort((a, b) => b - a)) {
    if (e.shape.points.length - gone.size <= least) break
    if (index >= 0 && index < e.shape.points.length) gone.add(index)
  }
  if (gone.size === 0) return
  const before = pointsCenter(e.shape.points)
  const after = pointsCenter(e.shape.points.filter((_, i) => !gone.has(i)))
  beginGesture()
  try {
    // One point at a time, each edit on the text as it then is; then x and y take the center's shift.
    for (const index of [...gone].sort((a, b) => b - a)) {
      const fresh = shapeLiteralOf(name)
      const edit = fresh && removePointEdit(fresh.source, fresh.shape, index)
      if (edit) applyEdits([edit])
    }
    const fresh = shapeLiteralOf(name)
    const shift = fresh ? centerShift(fresh.source, fresh.obj, { x: after.x - before.x, y: after.y - before.y }) : []
    if (shift.length > 0) applyEdits(shift)
  } finally {
    endGesture()
  }
}

/** Scale a Shape's points about a point of its own space, from the points and the position it had when the gesture began, and write them (D233); the anchor stays where it is drawn. */
export function scaleShapePoints(name: string, base: Point[], origin: Point, anchor: Point, fx: number, fy: number): void {
  const e = shapeLiteralOf(name)
  if (!e) return
  writeShapePoints(
    e,
    base.map((p) => ({ x: anchor.x + (p.x - anchor.x) * fx, y: anchor.y + (p.y - anchor.y) * fy })),
    origin,
  )
}

/** Scale a Shape's curves about a point of its own space, from the curves and the position it had when the gesture began, and write them centered (D240); the anchor stays where it is drawn. */
export function scaleShapeCurves(name: string, base: Seg[], origin: Point, anchor: Point, fx: number, fy: number): void {
  const cur = shapeCurvesOf(name)
  if (!cur) return
  writeShapeCurves(cur, scalePathData(base, anchor, fx, fy), origin)
}

/** Move one control of an anchor of a Shape's curves to a place in the scene: `in`, the control before the anchor, or `out`, the one after; with `smooth`, the other control stays in line (D240, D245). */
export function setShapeHandle(name: string, index: number, which: 'in' | 'out', world: Point, base?: ShapeEditBase, smooth = false): void {
  const cur = shapeCurvesOf(name)
  if (!cur) return
  const p = writtenCurvePoint(cur, world)
  writeCurvesAsIs(cur, dragAnchorHandle(base?.kind === 'curves' ? base.segs : cur.written, index, which, p.x, p.y, smooth), base)
}

/** What an anchor of a Shape is (D252): smooth, a corner, or straight; a points shape's are straight, or smooth when the shape is. */
export function shapeAnchorKind(name: string, index: number): AnchorKind {
  const cur = shapeCurvesOf(name)
  if (cur) return anchorKind(cur.written, index)
  const e = shapeLiteralOf(name)
  if (e && e.obj.attrs['closed'] === false && (index === 0 || index === e.shape.points.length - 1)) return 'end'
  return findObject(name)?.attrs['smooth'] === true ? 'smooth' : 'straight'
}

/** Whether a segment on either side of a Shape's anchor is a curve, so an end of a line has a handle to straighten (D252). */
export function shapeAnchorCurved(name: string, index: number): boolean {
  const cur = shapeCurvesOf(name)
  if (cur) return anchorCurved(cur.written, index)
  return findObject(name)?.attrs['smooth'] === true
}

/** Whether an anchor of a Shape is smooth, its controls in line, so a drag of one control turns the other (D245). */
export function shapeAnchorSmooth(name: string, index: number): boolean {
  return shapeAnchorKind(name, index) === 'smooth'
}

/** Whether a segment of a Shape, the one ending at the anchor of `seg`, is a curve or a line (D252); on a points shape, `seg` is the index of the point it ends at. */
export function shapeSegmentKind(name: string, seg: number): 'curve' | 'line' {
  const cur = shapeCurvesOf(name)
  if (cur) return segmentKind(cur.written, seg)
  return findObject(name)?.attrs['smooth'] === true ? 'curve' : 'line'
}

/** A points Shape as curves, its lines or its spline, so one anchor or segment can be edited (D249). */
function shapeAsCurves(name: string): EditableShapeCurves | null {
  const cur = shapeCurvesOf(name)
  if (cur) return cur
  convertToCurves(name)
  return shapeCurvesOf(name)
}

/** Make anchors of a Shape smooth, corners, or straight (D252); a points shape becomes curves first. */
export function setShapeAnchorKind(name: string, indices: number[], kind: AnchorKind): void {
  beginGesture()
  try {
    const cur = shapeAsCurves(name)
    if (!cur) return
    writeCurvesAsIs(cur, kind === 'smooth' ? smoothAnchors(cur.written, indices) : kind === 'corner' ? cornerAnchors(cur.written, indices) : straightenAnchors(cur.written, indices))
  } finally {
    endGesture()
  }
}

/** Make a segment of a Shape a curve or a line (D252); a points shape becomes curves first, where `seg` is the index of the point the segment ends at. */
export function setShapeSegment(name: string, seg: number, kind: 'curve' | 'line'): void {
  beginGesture()
  try {
    const cur = shapeAsCurves(name)
    if (!cur) return
    writeCurvesAsIs(cur, kind === 'curve' ? curveSegment(cur.written, seg) : straightenSegment(cur.written, seg))
  } finally {
    endGesture()
  }
}

/** Put an anchor into a Shape's curves on a segment, a fraction of the way along it, the curve kept as it was (D240). Returns the new anchor's index. */
export function insertShapeAnchor(name: string, seg: number, t: number): number | null {
  const cur = shapeCurvesOf(name)
  if (!cur) return null
  const { segs, anchor } = splitSegment(cur.written, seg, t)
  if (segs === cur.written) return null
  writeCurvesAsIs(cur, segs)
  return anchor
}

/**
 * Write a points Shape as curves (D239, D249): its lines as lines, or its smooth curve as the
 * cubic curves it is, exactly. The points, `smooth`, and `closed` go; an open line keeps its
 * look with `fill: 'none'`, since curves fill as SVG does.
 */
export function convertToCurves(name: string, smoothen?: boolean): void {
  const e = shapeLiteralOf(name)
  if (!e) return
  const own = shapeOwnPoints(e.model, e.obj, state().time)
  if (own.length < 2) return
  const closed = e.obj.attrs['closed'] !== false
  const smooth = smoothen ?? e.obj.attrs['smooth'] === true
  const segs = smooth && own.length >= 3 ? smoothPathData(own, closed) : polygonPathData(own, closed)
  // Curves are centered by the box around their line, which a smooth curve bulges beyond the points' box, so x and y follow the center as every write of curves has them (D238).
  const c = pathDataBounds(segs)
  // Inside a gesture already, the conversion joins it, so an edit of one point or segment undoes as one step (D252).
  const started = !gestureOpen()
  if (started) beginGesture()
  try {
    applyEdits([setPropText(e.source, e.obj.decl!, 'curves', formatCurves(serializePathData(translatePathData(segs, -c.x, -c.y)), e.obj.decl!.indent)), ...centerShift(e.source, e.obj, { x: c.x, y: c.y })], objectsSelected([name]))
    const fresh = state()
    const decl = fresh.model?.objects.find((o) => o.name === name)?.decl
    if (!decl) return
    const edits: TextEdit[] = []
    for (const key of ['points', 'smooth', 'closed']) {
      const edit = removeProp(fresh.source, decl, key)
      if (edit) edits.push(edit)
    }
    applyEdits(edits, objectsSelected([name]))
    if (!closed && e.obj.attrs['fill'] !== 'none') setObjectProp(name, 'fill', 'none')
  } finally {
    if (started) endGesture()
  }
  foldShapes()
}

/**
 * Put an SVG's drawing into the scene (D241): its elements as objects, grouped as the file
 * groups them, centered on `at`, beginning at the playhead and lasting as the preferences say,
 * as placed objects do; the whole drawing is selected after. What could not be kept is said in
 * the preview.
 */
export function importSvg(text: string, fileName: string, at: Point): void {
  const { model, time } = state()
  const notice = useStore.getState().setNotice
  if (!model) {
    notice('Open a project before importing.')
    return
  }
  let read: ReturnType<typeof readSvg>
  try {
    read = readSvg(text, fileName, takenNames(model))
  } catch (err) {
    notice(`Could not read the SVG: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if ('error' in read) {
    notice(read.error)
    return
  }
  // A small drawing, an icon, would be lost at one unit a pixel: it comes in at a fifth of the frame's height (D241).
  const side = Math.max(read.width, read.height)
  const scale = side > 0 && side < 100 ? Math.round((useStore.getState().settings.height / 5 / side) * 100) / 100 : 1
  const items = scale !== 1 ? scaleImported(read.items, scale) : read.items
  const blocks: string[] = []
  let count = 0
  const length = useStore.getState().prefs.objectLength
  // Each thing says the file it came in from, which the object pane tags (D241).
  const from = `${fileName}.svg`
  const emit = (item: ImportedItem): void => {
    if (item.kind === 'group') {
      item.members.forEach(emit)
      blocks.push(blockText(`${item.name} = ${GROUP}`, { members: item.members.map((m) => m.name).join(' '), imported: from }))
      return
    }
    const attrs = { ...item.attrs }
    if (typeof attrs['x'] === 'number') attrs['x'] = Math.round(attrs['x'] + at.x)
    if (typeof attrs['y'] === 'number') attrs['y'] = Math.round(attrs['y'] + at.y)
    attrs['imported'] = from
    if (time > 0) attrs['at'] = roundSeconds(time)
    if (length !== null) attrs['until'] = roundSeconds(time + length)
    blocks.push(blockText(`${item.name} = ${item.className}`, attrs))
    count++
  }
  items.forEach(emit)
  if (blocks.length === 0) {
    notice(`Nothing to import${read.dropped.length > 0 ? `: ${read.dropped.join(', ')} not supported` : ''}.`)
    return
  }
  applyEdits([insertDeclaration(model.lastDeclEnd, blocks.join('\n\n'))], objectsSelected(items.map((i) => i.name)))
  foldShapes()
  // Select shows what came in, with its box.
  useStore.getState().setTool('select')
  notice(`Imported ${count} ${count === 1 ? 'object' : 'objects'}${scale !== 1 ? ` at ${scale}×` : ''}${read.dropped.length > 0 ? `; dropped ${read.dropped.join(', ')}` : ''}.`)
}

/**
 * Close a Shape or open it (D233, D253): the close goes in or comes out, and that is all; its
 * fill and its stroke are its own, so a closed line stays hollow and an opened polygon keeps
 * its fill. Opening takes the segment drawn back to the start with the close, so the ends part.
 * Closed is the default of a points shape, so closing removes the key.
 */
export function setShapeClosed(name: string, closed: boolean): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    const segs = closed ? closePath(cur.written) : openPath(cur.written)
    if (segs !== cur.written) writeCurvesAsIs(cur, segs)
    return
  }
  setObjectProp(name, 'closed', closed ? null : false)
}

export function setShapeSmooth(name: string, smooth: boolean): void {
  setObjectProp(name, 'smooth', smooth ? true : null)
}

/**
 * Start a Shape with the Shape tool (D233, D253): one point where the pointer is, drawn as a
 * line, a stroke and no fill, until it is closed. Returns its name.
 */
export function beginShape(x: number, y: number): string | null {
  const { model, time } = state()
  if (!model) return null
  const name = uniqueName('shape')
  // Drawn as curves, the one form the GUI writes (D249): a move to the first corner, lines to the rest, smoothed where a line was drawn.
  const attrs: Record<string, AttrValue> = { x: Math.round(x), y: Math.round(y), curves: 'M 0 0', fill: 'none', stroke: '#ffffff', strokeWidth: 3 }
  if (time > 0) attrs['at'] = roundSeconds(time)
  const length = useStore.getState().prefs.objectLength
  if (length !== null) attrs['until'] = roundSeconds(time + length)
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = ${SHAPE}`, attrs))], objectsSelected([name]))
  return name
}

/** Add corners to a Shape being drawn, at places in the scene (D233): lines to them on curves, before the close if there is one (D249), or points on a points shape. */
export function appendShapePoints(name: string, worlds: Point[]): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    const lines = worlds.map((w): Seg => {
      const p = writtenCurvePoint(cur, w)
      return { c: 'L', x: p.x, y: p.y }
    })
    const segs = [...cur.written]
    const at = segs.length > 0 && segs[segs.length - 1]!.c === 'Z' ? segs.length - 1 : segs.length
    segs.splice(at, 0, ...lines)
    writeCurvesAsIs(cur, segs)
    return
  }
  const e = shapeLiteralOf(name)
  if (!e) return
  insertShapePoints(name, e.shape.points.length, worlds)
}

/** Smooth a run of anchors of a Shape's curves: those just drawn and the one they left (D249). */
export function smoothShapeRun(name: string, indices: number[]): void {
  const cur = shapeCurvesOf(name)
  if (!cur) return
  writeCurvesAsIs(cur, smoothAnchors(cur.written, indices))
}

/** How many corners a Shape is drawn with: its anchors, or its points. */
export function shapeAnchorCount(name: string): number {
  const cur = shapeCurvesOf(name)
  if (cur) return pathAnchors(cur.written).length
  return shapeLiteralOf(name)?.shape.points.length ?? 0
}

/** Whether a Shape is closed: its curves end with a close, or its points are not open. */
export function isShapeClosed(name: string): boolean {
  const cur = shapeCurvesOf(name)
  if (cur) return cur.written.length > 0 && cur.written[cur.written.length - 1]!.c === 'Z'
  return findObject(name)?.attrs['closed'] !== false
}

/** Make a Shape smooth (D249): every anchor of its curves smooth, its controls in line along the way from the anchor before to the one after; a points shape becomes curves, the spline through its points. */
export function smoothShape(name: string): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    writeCurvesAsIs(cur, smoothAnchors(cur.written, pathAnchors(cur.written).map((_, i) => i)))
    return
  }
  convertToCurves(name, true)
}

/** Make a Shape straight (D249): every segment of its curves a line; a points shape loses `smooth`. */
export function straightenShape(name: string): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    writeCurvesAsIs(cur, straightenAll(cur.written))
    return
  }
  setObjectProp(name, 'smooth', null)
}

/**
 * Finish a Shape being drawn (D233): closed and filled, its stroke dropped, or left as a line;
 * recentered on its points so that its x and y are their middle; one with too few points goes.
 */
export function finishShape(name: string, close: boolean): void {
  const cur = shapeCurvesOf(name)
  if (cur) {
    if (pathAnchors(cur.written).length < (close ? 3 : 2)) {
      deleteObjects([name], true)
      return
    }
    beginGesture()
    try {
      // Centered on its line, as every whole write leaves it (D235), with a close when asked.
      const segs = close ? closePath(cur.written) : cur.written
      writeShapeCurves(cur, translatePathData(segs, -cur.center.x, -cur.center.y))
      if (close) {
        // Closed, it is a polygon (D253): filled, its drawing stroke gone.
        const fresh = findObject(name)
        if (!fresh?.decl) return
        const { source } = state()
        const edits: TextEdit[] = [setProp(source, fresh.decl, 'fill', '#4f8cff')]
        for (const key of ['stroke', 'strokeWidth']) {
          const edit = removeProp(source, fresh.decl, key)
          if (edit) edits.push(edit)
        }
        applyEdits(edits, objectsSelected([name]))
      }
    } finally {
      endGesture()
    }
    foldShapes()
    return
  }
  const e = shapeLiteralOf(name)
  if (!e) return
  if (e.shape.points.length < (close ? 3 : 2)) {
    deleteObjects([name], true)
    return
  }
  beginGesture()
  try {
    // Centered on its points, as every write leaves it (D235).
    writeShapePoints(e, shapeOwnPoints(e.model, e.obj, state().time))
    if (close) {
      const fresh = shapeLiteralOf(name)
      if (!fresh) return
      const edits: TextEdit[] = []
      for (const key of ['closed', 'stroke', 'strokeWidth']) {
        const edit = removeProp(fresh.source, fresh.obj.decl!, key)
        if (edit) edits.push(edit)
      }
      if (edits.length > 0) applyEdits(edits, objectsSelected([name]))
    }
  } finally {
    endGesture()
  }
  foldShapes()
}

/**
 * Make a Rect or a Circle a Shape with the same look (D234): its corners as points, or the
 * oval as a path of four curves, exact (D238); the name, place, fill, and animations stay, and
 * a size it animated gets a note from the evaluator, since a Shape has none.
 */
export function convertToShape(name: string): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj?.decl || (obj.className !== 'Rect' && obj.className !== 'Circle')) return
  const num = (key: string): number => {
    const v = valueAt(model, obj, key, obj.at)
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  let geometry: { key: 'points'; points: Point[] } | { key: 'curves'; d: string }
  if (obj.className === 'Rect') {
    const w = num('width') / 2
    const h = num('height') / 2
    geometry = {
      key: 'points',
      points: [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ],
    }
  } else geometry = { key: 'curves', d: serializePathData(ellipsePathData(num('width') / 2, num('height') / 2)) }
  const decl = obj.decl
  const head = source.slice(decl.range.from, decl.propsOpen)
  const at = head.lastIndexOf(`${obj.className}(`)
  if (at < 0) return
  beginGesture()
  try {
    // The kind and the sizes first, then the points into the block as it then is, so no two edits overlap.
    const first: TextEdit[] = [{ from: decl.range.from + at, to: decl.range.from + at + obj.className.length, insert: SHAPE }]
    for (const key of ['width', 'height', 'radius']) {
      const edit = removeProp(source, decl, key)
      if (edit) edits(first, edit)
    }
    applyEdits(first, objectsSelected([name]))
    const fresh = state()
    const again = fresh.model?.objects.find((o) => o.name === name)?.decl
    if (!fresh.model || !again) return
    const indent = again.indent
    const text = geometry.key === 'points' ? `[\n${geometry.points.map((p) => `${indent}  ${pointText(Math.round(p.x), Math.round(p.y))},`).join('\n')}\n${indent}]` : formatCurves(geometry.d, again.indent)
    applyEdits([setPropText(fresh.source, again, geometry.key, text)], objectsSelected([name]))
  } finally {
    endGesture()
  }
  foldShapes()
}

function edits(list: TextEdit[], edit: TextEdit): void {
  list.push(edit)
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
