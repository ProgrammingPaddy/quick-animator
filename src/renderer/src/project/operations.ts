import { applyEdits, scrollToPos } from '../code/editor'
import { easingFor } from '../model/easing'
import { appendStatement, blockText, insertDeclaration, removeStatements, setProp, type TextEdit } from '../model/edits'
import type { AttrValue } from '../model/registry'
import { definingAction, valueAt } from '../model/sample'
import type { Range, SceneObject } from '../model/types'
import { useStore, type Tool } from '../state/store'
import { snapToFrame } from '../state/time'

/**
 * Every GUI gesture that changes the scene ends here as a minimal text edit (decision D24). The
 * edit goes through the editor, which re-evaluates the model and records the undo step.
 */

function state() {
  const s = useStore.getState()
  return { source: s.source, model: s.model, fps: s.settings.fps, time: s.time }
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

function roundSeconds(v: number): number {
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
 * action that covers or last changed it, or else the declaration. Returns null when locked.
 */
function editFor(name: string, attr: string, value: number, time: number): TextEdit | null {
  const { source, model } = state()
  if (!model) return null
  const obj = model.objects.find((o) => o.name === name)
  if (!obj) return null
  const action = definingAction(model, obj, attr, time)
  if (action) {
    if (!action.stmt || typeof action.changes[attr] === 'function') return null
    let target = value
    if (time < action.end && action.end > action.start) {
      // Mid-action: choose the target that puts the object under the cursor at this time.
      const progress = easingFor(action.timing, action.end - action.start)((time - action.start) / (action.end - action.start))
      const from = valueAt(model, obj, attr, action.start)
      if (typeof from === 'number' && progress > 0.05) target = from + (value - from) / progress
    }
    return setProp(source, action.stmt, attr, roundPixels(target))
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
  const { source, model, fps, time } = state()
  const obj = model?.objects.find((o) => o.name === name)
  if (!model || !obj || !obj.decl) return false
  const at = snapToFrame(time, fps)
  const x = valueAt(model, obj, 'x', time)
  const y = valueAt(model, obj, 'y', time)
  const text = blockText(`${name}.move`, {
    x: roundPixels(typeof x === 'number' ? x : 0),
    y: roundPixels(typeof y === 'number' ? y : 0),
    at: roundSeconds(at),
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

/** Scroll the code pane to an object's declaration. */
export function jumpToObject(name: string): void {
  const obj = findObject(name)
  if (obj?.decl) scrollToPos(obj.decl.range.from)
}
