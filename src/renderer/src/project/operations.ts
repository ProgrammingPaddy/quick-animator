import { applyEdits, scrollToPos } from '../code/editor'
import { findDependents, type Dependent } from '../model/dependents'
import { appendStatement, blockText, formatNumber, insertDeclaration, removeProp, removeStatements, setProp, type TextEdit } from '../model/edits'
import { isMember } from '../model/evaluate'
import { memberRef } from '../model/groups'
import { classes, VERB_ATTRS, type AttrValue, type Verb } from '../model/registry'
import { identifierEdits, nameProblem, replaceIdentifiers } from '../model/rename'
import { definingAction, progressAt, valueAt } from '../model/sample'
import type { Action, ActionInfo, ClassAction, Range, SceneModel, SceneObject } from '../model/types'
import { useStore, type Clip, type ClipObject, type SelectionState, type Tool } from '../state/store'

/**
 * Every GUI gesture that changes the scene ends here as a minimal text edit (decision D24). The
 * edit goes through the editor, which re-evaluates the model and records the undo step. The
 * editor updates synchronously, so an operation can build on the one before it. When an edit
 * changes what is selected, the selection travels in the same step (D90).
 */

/** A drag's kind of change: the attributes it edits and the verb that animates them (D79, D86). */
export type DragKind = 'move' | 'rotate' | 'resize'

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

const objectsSelected = (names: string[]): SelectionState => ({ selection: names, selectedAction: null })
const actionSelected = (object: string, index: number): SelectionState => ({ selection: [object], selectedAction: { object, index } })

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

export function roundSeconds(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** The attributes a kind of drag changes on a class of object, and the verb that animates them. */
export function dragAttrs(kind: DragKind, className: string): { attrs: string[]; verb: Verb } {
  if (kind === 'rotate') return { attrs: ['rotation'], verb: 'rotate' }
  if (kind === 'resize') {
    const attrs = (VERB_ATTRS['resize'] ?? []).filter((a) => classes[className]?.attrs.some((s) => s.name === a))
    return { attrs, verb: 'resize' }
  }
  return { attrs: ['x', 'y'], verb: 'move' }
}

/**
 * The dimension attributes of an object after scaling its drawn size by factors along its own
 * axes: a Rect's width and height follow each axis; a Circle's radius and a Text's font size
 * follow whichever axis moved.
 */
export function resizedValues(className: string, base: Record<string, number>, fx: number, fy: number): Record<string, number> {
  const uniform = fx !== 1 ? fx : fy
  if (className === 'Rect') return { width: (base['width'] ?? 0) * fx, height: (base['height'] ?? 0) * fy }
  if (className === 'Circle') return { radius: (base['radius'] ?? 0) * uniform }
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
 * Make an attribute have this value at this time by editing whatever defines it then: the
 * action that most recently started changing it, or else the declaration. For an action, the
 * written value moves by the needed change divided by the eased progress, so the object lands
 * under the cursor; a relative action's change is adjusted the same way. Returns null when locked.
 */
function editFor(name: string, attr: string, value: number, time: number): TextEdit | null {
  const { source, model } = state()
  if (!model) return null
  const obj = model.objects.find((o) => o.name === name)
  if (!obj) return null
  const action = definingAction(model, obj, attr, time)
  if (action) {
    const written = action.changes[attr]
    if (!action.stmt || action.classAction || typeof written !== 'number') return null
    const current = valueAt(model, obj, attr, time)
    if (typeof current !== 'number') return null
    const progress = progressAt(action, time)
    if (progress < 0.05) return null
    return setProp(source, action.stmt, attr, roundAttr(attr, written + (value - current) / progress))
  }
  if (!obj.decl || typeof obj.attrs[attr] === 'function') return null
  return setProp(source, obj.decl, attr, roundAttr(attr, value))
}

/**
 * A plain drag: the object has these values at this time. When a class action defines one of
 * them right now, the object first overrides it with its own copy, which is what the drag then
 * edits (D80).
 */
export function setAttrsAt(name: string, attrs: Record<string, number>, time: number): boolean {
  const { model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (model && obj) {
    const done = new Set<ClassAction>()
    for (const attr of Object.keys(attrs)) {
      const action = definingAction(model, obj, attr, time)
      if (!action?.classAction || !action.stmt || done.has(action.classAction)) continue
      done.add(action.classAction)
      overrideClassAction(name, obj.actions.indexOf(action))
    }
  }
  const edits = Object.entries(attrs)
    .map(([attr, value]) => editFor(name, attr, value, time))
    .filter((e): e is TextEdit => e !== null)
  applyEdits(edits)
  return edits.length > 0
}

export function setPositionAt(name: string, x: number, y: number, time: number): boolean {
  return setAttrsAt(name, { x, y }, time)
}

/**
 * A drag while an action is selected: the action's destination follows the pointer. For a
 * relative action the written change is the distance from where the object is when the action
 * starts (D70).
 */
export function setActionDestination(name: string, index: number, destination: Record<string, number>): boolean {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const action = obj?.actions[index]
  if (!model || !obj || !action?.stmt || action.classAction) return false
  const edits: TextEdit[] = []
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
 * Shift-drag begins: add an action of the drag's kind from where the object is now, starting at
 * the playhead (D27, D79). The playhead moves to the action's end so the result is seen (D49).
 */
export function beginTimed(name: string, kind: DragKind): boolean {
  const { source, model, time } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return false
  const { attrs, verb } = dragAttrs(kind, obj.className)
  const at = roundSeconds(time)
  const block: Record<string, AttrValue> = {}
  for (const attr of attrs) {
    const value = valueAt(model, obj, attr, time)
    block[attr] = roundAttr(attr, typeof value === 'number' ? value : 0)
  }
  block['at'] = at
  block['duration'] = 1
  const index = obj.actions.length
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, block))], actionSelected(name, index))
  useStore.getState().setTime(at + 1)
  return true
}

export function beginMove(name: string): boolean {
  return beginTimed(name, 'move')
}

/** Update the target of the object's last own action, while a shift-drag continues. */
export function setLastActionTarget(name: string, attrs: Record<string, number>): void {
  const obj = findObject(name)
  const index = obj ? obj.actions.map((a, i) => (a.stmt && !a.classAction ? i : -1)).filter((i) => i >= 0).pop() : undefined
  if (obj && index !== undefined) setActionValues(name, index, attrs)
}

/** Write values into an action's block: the targets of the change. */
export function setActionValues(name: string, index: number, values: Record<string, number>): void {
  const { source } = state()
  const action = findObject(name)?.actions[index]
  if (!action?.stmt || action.classAction) return
  const stmt = action.stmt
  applyEdits(Object.entries(values).map(([key, value]) => setProp(source, stmt, key, roundAttr(key, value))))
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
  edits.push(appendStatement(source, blockText(`${name}.fade`, { opacity: 1, at: roundSeconds(time), duration: instant ? 0 : 0.3 })))
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
  edits.push(appendStatement(source, blockText(`${name}.fade`, { opacity: 0, at: roundSeconds(time), duration: instant ? 0 : 0.3 })))
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
  edits.push(appendStatement(source, blockText(`all('${className}').fade`, { opacity: 1, at: roundSeconds(time), duration: instant ? 0 : 0.3 })))
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
  edits.push(appendStatement(source, blockText(`all('${className}').fade`, { opacity: 0, at: roundSeconds(time), duration: instant ? 0 : 0.3 })))
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

/** Remove one action, after confirming when other code refers to its name. A class action goes for every member. */
export function deleteAction(name: string, index: number, confirmed = false): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  const action = obj?.actions[index]
  if (!model || !obj || !action?.stmt) return
  const classAction: ClassAction | null = action.classAction
  const removedActions = classAction ? classAction.members.map((m) => ({ object: m.object.name, index: m.object.actions.indexOf(m) })) : [{ object: name, index }]
  const dependents = action.name ? findDependents(model, [action.name], { objects: [], actions: removedActions }) : []
  const run = () => {
    const current = state()
    if (!current.model || current.model !== model) return deleteAction(name, index, true)
    applyEdits([...removeStatements(source, [action.stmt!.range]), ...resolutionEdits(model, source, dependents)], objectsSelected([name]))
  }
  const label = classAction ? `all('${classAction.className}').${action.verb} for every member` : action.name ? `${action.name} (${obj.name}.${action.verb})` : `${obj.name}.${action.verb}`
  if (confirmed) run()
  else confirmRemoval(`Delete ${label}?`, dependents, run)
}

/** Remove a class action for every member. */
export function deleteClassAction(id: number): void {
  const classAction = state().model?.classActions[id]
  const ref = classAction ? memberRef(classAction) : null
  if (ref) deleteAction(ref.object, ref.index)
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
function actionClip(name: string, index: number): Clip | null {
  const { source, model } = state()
  const action = model?.objects.find((o) => o.name === name)?.actions[index]
  if (!action?.stmt) return null
  return { kind: 'action', objectName: name, verb: action.verb, name: action.classAction ? null : action.name, propsText: source.slice(action.stmt.propsOpen, action.stmt.propsClose) }
}

/** Ctrl+C: the selected action, or else the selected objects with their actions (D81). */
export function copySelection(): boolean {
  const { selection, selectedAction, setClipboard } = useStore.getState()
  let clip: Clip | null = null
  if (selectedAction) clip = actionClip(selectedAction.object, selectedAction.index)
  else {
    const items = selection.map(objectClip).filter((c): c is ClipObject => !!c)
    if (items.length > 0) clip = { kind: 'objects', items }
  }
  if (!clip) return false
  setClipboard(clip)
  const text = clip.kind === 'action' ? `${clip.objectName}.${clip.verb}({${clip.propsText}})` : clip.items.flatMap((item) => [`${item.name} = ${item.className}({${item.propsText}})`, ...item.actions.map((a) => a.text)]).join('\n\n')
  void navigator.clipboard?.writeText(text).catch(() => undefined)
  return true
}

/**
 * Ctrl+V: objects paste as numbered copies; an action pastes onto the selected object, or back
 * onto its own when nothing else is selected (D81).
 */
export function pasteClipboard(): boolean {
  const { source, model } = state()
  const { clipboard, selection } = useStore.getState()
  if (!model || !clipboard) return false
  if (clipboard.kind === 'action') {
    const target = selection[0] ?? clipboard.objectName
    const obj = model.objects.find((o) => o.name === target)
    if (!obj?.decl) return false
    const renames = clipboard.name ? numberedCopies(model, [clipboard.name], 2) : {}
    const head = clipboard.name ? `${renames[clipboard.name]} = ` : ''
    applyEdits([appendStatement(source, `${head}${target}.${clipboard.verb}({${clipboard.propsText}})`)], actionSelected(target, obj.actions.length))
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
