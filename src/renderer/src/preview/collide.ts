import type { SceneObject } from '../model/types'
import type { Frame } from './SceneRenderer'

export interface Point {
  x: number
  y: number
}

/** A convex outline, as points around it. */
export type Polygon = Point[]

/** The convex hull of points, counterclockwise, by the monotone chain; what a concave Shape collides with (D232). */
export function convexHull(points: Point[]): Polygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * The outline an object collides with (D136): a rectangle's four corners, turned and scaled as it
 * is drawn; an oval's rim, as 48 points; text by the box it is drawn in, until its glyphs can be
 * read; a Shape by the convex hull of the line it is drawn with, given as `drawn` (D232). Anything
 * drawn is solid; what is not drawn, an object at opacity zero, never gets here.
 */
export function outlineOf(obj: SceneObject, frame: Frame, drawn?: Point[]): Polygon {
  if (drawn && drawn.length >= 3) return convexHull(drawn)
  const a = (frame.rotation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const place = (lx: number, ly: number): Point => ({ x: frame.x + lx * cos - ly * sin, y: frame.y + lx * sin + ly * cos })
  if (obj.className === 'Circle') {
    const out: Polygon = []
    const n = 48
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      out.push(place((Math.cos(t) * frame.width) / 2, (Math.sin(t) * frame.height) / 2))
    }
    return out
  }
  const w = frame.width / 2
  const h = frame.height / 2
  return [place(-w, -h), place(w, -h), place(w, h), place(-w, h)]
}

function axesOf(poly: Polygon): Point[] {
  const out: Point[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    if (len > 1e-9) out.push({ x: -(q.y - p.y) / len, y: (q.x - p.x) / len })
  }
  return out
}

function project(poly: Polygon, axis: Point): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return [lo, hi]
}

function centroid(poly: Polygon): Point {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p.x
    y += p.y
  }
  return { x: x / poly.length, y: y / poly.length }
}

/** The smallest shift that takes outline `a` clear of outline `b`, or null when they are apart. */
export function separation(a: Polygon, b: Polygon): Point | null {
  let depth = Infinity
  let along: Point | null = null
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const [aLo, aHi] = project(a, axis)
    const [bLo, bHi] = project(b, axis)
    const overlap = Math.min(aHi - bLo, bHi - aLo)
    if (overlap <= 0) return null
    if (overlap < depth) {
      depth = overlap
      along = axis
    }
  }
  if (!along) return null
  const ca = centroid(a)
  const cb = centroid(b)
  const sign = (ca.x - cb.x) * along.x + (ca.y - cb.y) * along.y < 0 ? -1 : 1
  return { x: along.x * depth * sign, y: along.y * depth * sign }
}

/** A thing in the collision: its outlines now, where they began, how far they have moved, and what it does when met. */
export interface Mover {
  name: string
  polys: Polygon[]
  start: Polygon[]
  shift: Point
  /** Anchored: never pushed, so it blocks. */
  anchored: boolean
  /** Soft: drags pass through it, and it is never pushed. */
  soft: boolean
  /** How far the dragged thing had come from where the drag began when this one was first shoved; null while untouched (D167). */
  contact: number | null
}

export type Pushing = 'off' | 'on'

export function makeMover(name: string, polys: Polygon[], anchored: boolean, soft: boolean): Mover {
  return { name, polys: polys.map((poly) => poly.map((p) => ({ ...p }))), start: polys, shift: { x: 0, y: 0 }, anchored, soft, contact: null }
}

function translate(m: Mover, d: Point): void {
  for (const poly of m.polys)
    for (const p of poly) {
      p.x += d.x
      p.y += d.y
    }
  m.shift = { x: m.shift.x + d.x, y: m.shift.y + d.y }
}

function bounds(m: Mover): [number, number, number, number] {
  let l = Infinity
  let r = -Infinity
  let b = Infinity
  let t = -Infinity
  for (const poly of m.polys)
    for (const p of poly) {
      if (p.x < l) l = p.x
      if (p.x > r) r = p.x
      if (p.y < b) b = p.y
      if (p.y > t) t = p.y
    }
  return [l, r, b, t]
}

function near(a: Mover, b: Mover): boolean {
  const [al, ar, ab, at] = bounds(a)
  const [bl, br, bb, bt] = bounds(b)
  return al < br && ar > bl && ab < bt && at > bb
}

/**
 * Undo every overlap `m` has with the others: what can be pushed is shoved clear by the smallest
 * shift and settles in turn, and when it could not go all the way `m` backs off the rest; what
 * cannot be pushed makes `m` back off. A few rounds settle chains.
 */
function settle(m: Mover, all: Mover[], push: boolean, depth = 0): void {
  for (let round = 0; round < 4; round++) {
    let overlapped = false
    for (const o of all) {
      if (o === m || o.soft || !near(m, o)) continue
      for (const a of m.polys)
        for (const b of o.polys) {
          const s = separation(a, b)
          if (!s) continue
          overlapped = true
          if (push && !o.anchored && depth < 6) {
            translate(o, { x: -s.x, y: -s.y })
            settle(o, all, push, depth + 1)
            const left = separation(a, b)
            if (left) translate(m, left)
          } else translate(m, s)
        }
    }
    if (!overlapped) break
  }
}

/** A step of the walk, in world pixels: short enough that nothing slips through a shape between steps. */
const STEP = 4

/**
 * Take the dragged thing toward `target`, its shift from where the drag began, in short steps
 * among the others, undoing each step's overlaps (D136), so it slides along whatever it meets
 * and comes to rest against it. The walk follows the pointer's path from wherever the last step
 * left off, so nothing is met that the dragged thing did not actually touch (D186). With pushing
 * off everything blocks; with it on, what is met is shoved along and stays where it was shoved.
 * Where things are comes out in each mover's `shift`.
 */
export function walk(dragged: Mover, target: Point, others: Mover[], pushing: Pushing, stepLength = STEP): void {
  const all = [dragged, ...others]
  const remaining = { x: target.x - dragged.shift.x, y: target.y - dragged.shift.y }
  const steps = Math.max(1, Math.ceil(Math.hypot(remaining.x, remaining.y) / stepLength))
  const step = { x: remaining.x / steps, y: remaining.y / steps }
  for (let i = 0; i < steps; i++) {
    translate(dragged, step)
    settle(dragged, all, pushing !== 'off')
    // The step that first moves something is where the dragged thing met it (D167).
    for (const o of others) if (o.contact === null && (Math.abs(o.shift.x) > 1e-9 || Math.abs(o.shift.y) > 1e-9)) o.contact = Math.hypot(dragged.shift.x, dragged.shift.y)
  }
}

/** Put a mover back where the drag began, for a sweep that starts over from there (D206). */
export function resetMover(m: Mover): void {
  m.polys = m.start.map((poly) => poly.map((p) => ({ ...p })))
  m.shift = { x: 0, y: 0 }
  m.contact = null
}
