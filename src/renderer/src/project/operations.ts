import { applyEdits, scrollToPos } from '../code/editor'
import { appendStatement, blockText, insertDeclaration, removeStatements, setProp, type TextEdit } from '../model/edits'
import { classes, VERB_ATTRS, type AttrValue, type Verb } from '../model/registry'
import { definingAction, progressAt, valueAt } from '../model/sample'
import type { Range, SceneModel, SceneObject } from '../model/types'
import { useStore, type Tool } from '../state/store'

/**
 * Every GUI gesture that changes the scene ends here as a minimal text edit (decision D24). The
 * edit goes through the editor, which re-evaluates the model and records the undo step.
 */

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

function uniqueName(base: string): string {
  const taken = new Set(state().model?.objects.map((o) => o.name) ?? [])
  let n = 1
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function roundPixels(v: number): number {
  return Math.round(v)
}

export function roundSeconds(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Place a new object at a world position. Returns its name. */
export function addObject(className: Exclude<Tool, 'select'>, x: number, y: number): string | null {
  const { model } = state()
  if (!model) return null
  const name = uniqueName(className.toLowerCase())
  const attrs: Record<string, AttrValue> = { x: roundPixels(x), y: roundPixels(y) }
  if (className === 'Rect') Object.assign(attrs, { width: 240, height: 140, fill: '#4f8cff' })
  if (className === 'Circle') Object.assign(attrs, { radius: 60, fill: '#f59e0b' })
  if (className === 'Text') Object.assign(attrs, { text: 'Text', fontSize: 48, fill: '#ffffff' })
  applyEdits([insertDeclaration(model.lastDeclEnd, blockText(`${name} = ${className}`, attrs))])
  useStore.getState().select([name])
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
    if (!action.stmt || typeof written !== 'number') return null
    const current = valueAt(model, obj, attr, time)
    if (typeof current !== 'number') return null
    const progress = progressAt(action, time)
    if (progress < 0.05) return null
    return setProp(source, action.stmt, attr, roundPixels(written + (value - current) / progress))
  }
  if (!obj.decl || typeof obj.attrs[attr] === 'function') return null
  return setProp(source, obj.decl, attr, roundPixels(value))
}

/** A plain drag: the object is at this position at this time. */
export function setPositionAt(name: string, x: number, y: number, time: number): boolean {
  const edits = [editFor(name, 'x', x, time), editFor(name, 'y', y, time)].filter((e): e is TextEdit => e !== null)
  applyEdits(edits)
  return edits.length > 0
}

/** Shift-drag begins: add a move from where the object is now, starting at the playhead (D27). */
export function beginMove(name: string): boolean {
  const { source, model, time } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return false
  const at = roundSeconds(time)
  const x = valueAt(model, obj, 'x', time)
  const y = valueAt(model, obj, 'y', time)
  const text = blockText(`${name}.move`, {
    x: roundPixels(typeof x === 'number' ? x : 0),
    y: roundPixels(typeof y === 'number' ? y : 0),
    at,
    duration: 1,
  })
  applyEdits([appendStatement(source, text)])
  // Show the destination while dragging, and leave the playhead where the move ends (D49).
  useStore.getState().setTime(at + 1)
  return true
}

/** Update the target of the object's last action, while a shift-drag continues. */
export function setLastActionTarget(name: string, attrs: Record<string, number>): void {
  const { source } = state()
  const obj = findObject(name)
  const action = obj ? [...obj.actions].reverse().find((a) => a.stmt) : undefined
  if (!action?.stmt) return
  const stmt = action.stmt
  applyEdits(Object.entries(attrs).map(([key, value]) => setProp(source, stmt, key, roundPixels(value))))
}

/** Add an action of a kind at a time. Its values start as the object's current ones, so nothing jumps. */
export function addAction(name: string, verb: Verb, time: number): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const attrs: Record<string, AttrValue> = {}
  const allowed = VERB_ATTRS[verb]
  if (allowed) {
    const schema = classes[obj.className]
    for (const attr of allowed) {
      const def = schema?.attrs.find((a) => a.name === attr)
      if (!def || attr === 'z') continue
      const value = valueAt(model, obj, attr, time)
      attrs[attr] = typeof value === 'number' ? Math.round(value * 100) / 100 : value
    }
  }
  attrs['at'] = roundSeconds(time)
  attrs['duration'] = 1
  const index = obj.actions.length
  applyEdits([appendStatement(source, blockText(`${name}.${verb}`, attrs))])
  useStore.getState().selectAction(name, index)
}

/** Make the object exist from here: base opacity 0, then a short fade to 1 at this time. */
export function appearHere(name: string, time: number): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  const edits: TextEdit[] = []
  const base = obj.decl.props.find((p) => p.key === 'opacity')
  if (!base || base.raw.trim() !== '0') edits.push(setProp(source, obj.decl, 'opacity', 0))
  edits.push(appendStatement(source, blockText(`${name}.fade`, { opacity: 1, at: roundSeconds(time), duration: 0.3 })))
  applyEdits(edits)
  useStore.getState().selectAction(name, obj.actions.length)
}

/** Make the object stop existing from here: a short fade to 0 at this time. */
export function disappearHere(name: string, time: number): void {
  const { source, model } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return
  applyEdits([appendStatement(source, blockText(`${name}.fade`, { opacity: 0, at: roundSeconds(time), duration: 0.3 }))])
  useStore.getState().selectAction(name, obj.actions.length)
}

/** Move or resize a clip. `at` is the start without delay; `duration` the length. */
export function setActionTiming(name: string, index: number, timing: { at?: number; duration?: number }): void {
  const { source } = state()
  const action = findObject(name)?.actions[index]
  if (!action?.stmt) return
  const edits: TextEdit[] = []
  if (timing.at !== undefined) edits.push(setProp(source, action.stmt, 'at', roundSeconds(timing.at)))
  if (timing.duration !== undefined) edits.push(setProp(source, action.stmt, 'duration', roundSeconds(timing.duration)))
  applyEdits(edits)
}

/** Remove objects with every action they have. */
export function deleteObjects(names: string[]): void {
  const { source, model } = state()
  if (!model) return
  const ranges: Range[] = []
  for (const name of names) {
    const obj = model.objects.find((o) => o.name === name)
    if (!obj?.decl) continue
    ranges.push(obj.decl.range)
    for (const action of obj.actions) if (action.stmt) ranges.push(action.stmt.range)
  }
  if (ranges.length === 0) return
  applyEdits(removeStatements(source, ranges))
  useStore.getState().select([])
}

/** Remove one action. */
export function deleteAction(name: string, index: number): void {
  const { source } = state()
  const action = findObject(name)?.actions[index]
  if (!action?.stmt) return
  applyEdits(removeStatements(source, [action.stmt.range]))
  useStore.getState().select([name])
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
