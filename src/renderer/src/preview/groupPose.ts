import { positionAt, turnOf, withWritten } from '../model/sample'
import type { Action, SceneModel, SceneObject } from '../model/types'
import type { Frame } from './SceneRenderer'

/** The orbits every one of these objects shares, the same span and the same turn, as a group turn writes them (D118): one list per object, in the first object's order. */
function sharedOrbits(model: SceneModel, objects: SceneObject[], time: number): Action[][] {
  const shared: Action[][] = objects.map(() => [])
  for (const orbit of objects[0]!.actions) {
    if (orbit.verb !== 'orbit' || orbit.overridden) continue
    const turn = turnOf(model, orbit, time)
    const matches = objects.map((obj) => obj.actions.find((a) => a.verb === 'orbit' && !a.overridden && a.start === orbit.start && a.end === orbit.end && Math.abs(turnOf(model, a, time) - turn) < 1e-9))
    if (matches.every((m): m is Action => !!m)) matches.forEach((m, i) => shared[i]!.push(m))
  }
  return shared
}

/**
 * The box around a group, carried along by the turns the group shares (D116, D123). The box is
 * fitted in the group's own frame, the objects as they would be with their shared orbits' angles
 * at zero, on axes turned by `axes` degrees for a box plain drags have turned. The shared turn
 * then moves the box exactly as it moves the objects, so every object keeps its place inside it
 * and the pivot stays attached to them, instead of a box refitted around the turned objects
 * whose center would drift against them.
 */
export function groupPose(model: SceneModel, names: string[], time: number, frameOf: (name: string) => Frame | null, axes = 0): Frame | null {
  const objects = names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o && !!frameOf(o.name))
  if (objects.length === 0) return null
  const shared = sharedOrbits(model, objects, time)
  const turned = shared[0]!.reduce((sum, a) => sum + turnOf(model, a, time), 0)
  let m = model
  const copies = objects.map((obj, i) => {
    let o = obj
    for (const orbit of shared[i]!) [m, o] = withWritten(m, o, orbit, 'angle', 0)
    return o
  })
  const unturned = copies.map((o, i) => {
    const f = frameOf(objects[i]!.name)!
    const p = positionAt(m, o, time)
    return { ...f, x: p.x, y: p.y, rotation: f.rotation - turned }
  })
  const a = (axes * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (const f of unturned) {
    const fa = (f.rotation * Math.PI) / 180
    const fc = Math.cos(fa)
    const fs = Math.sin(fa)
    for (const [lx, ly] of [
      [-f.width / 2, -f.height / 2],
      [f.width / 2, -f.height / 2],
      [-f.width / 2, f.height / 2],
      [f.width / 2, f.height / 2],
    ]) {
      const wx = f.x + lx! * fc - ly! * fs
      const wy = f.y + lx! * fs + ly! * fc
      const u = wx * cos + wy * sin
      const v = -wx * sin + wy * cos
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
  }
  const cu = (minU + maxU) / 2
  const cv = (minV + maxV) / 2
  const center = { x: cu * cos - cv * sin, y: cu * sin + cv * cos }
  // The rigid motion that takes the first object from its unturned place to its drawn one takes the box along.
  const t = (turned * Math.PI) / 180
  const first = frameOf(objects[0]!.name)!
  const dx = center.x - unturned[0]!.x
  const dy = center.y - unturned[0]!.y
  return { x: first.x + dx * Math.cos(t) - dy * Math.sin(t), y: first.y + dx * Math.sin(t) + dy * Math.cos(t), rotation: axes + turned, width: maxU - minU, height: maxV - minV }
}
