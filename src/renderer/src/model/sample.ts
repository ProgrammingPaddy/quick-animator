import { attrSchema, defaultFor, GROUP, type AttrType, type AttrValue } from './registry'
import { easingFor, unease, type Easing } from './easing'
import type { Action, AttrSource, SceneModel, SceneObject, StateDirection, StateName } from './types'

/**
 * While a sample is in progress, attribute reads on object handles (inside link functions)
 * return the value at this time instead of the base value.
 */
export const samplingContext: { model: SceneModel | null; time: number; depth: number } = { model: null, time: 0, depth: 0 }

/** How a Text is measured. The renderer registers the measurement it draws with, so boxes agree with what is drawn. */
export const textMeasurer: { current: ((text: string, fontSize: number, font: string) => { width: number; height: number }) | null } = { current: null }

interface Segment {
  action: Action
  to: AttrSource
  /** Where the action begins from, when written as a range (D221). */
  from?: AttrSource
  ease: Easing
}

/**
 * The actions that change one attribute, in start order. Absolute ones take over from their
 * start; relative ones add their change on top of everything else, in any order (decision D53).
 */
interface Segments {
  absolute: Segment[]
  relative: Segment[]
}

export interface Point {
  x: number
  y: number
}

/** A center, a rotation in degrees, and a scale: where something is drawn. */
export interface Pose {
  x: number
  y: number
  rotation: number
  scale: number
}

/** A box: its center, its rotation in degrees, and its size. */
export interface BoxFrame {
  x: number
  y: number
  rotation: number
  width: number
  height: number
}

/** A similarity, what a group's turns and scales make of a point: m ↦ s·R·m + d. The angle is kept in degrees as it adds up, so turns past half a circle keep counting (D105). */
export interface Motion {
  s: number
  angle: number
  cos: number
  sin: number
  dx: number
  dy: number
}

const IDENTITY: Motion = { s: 1, angle: 0, cos: 1, sin: 0, dx: 0, dy: 0 }

interface Cache {
  segments: Map<string, Segments>
  /** The groups that carry an object, inner first. */
  containers: Map<number, SceneObject[]>
  /** The center of a group's box when one of its actions begins, by action id: what that action turns or scales around. */
  pivots: Map<number, Point>
  /** What a group's own rotation and scale turn and scale around, by group id (D124). */
  basePivots: Map<number, Point>
  /** The value an attribute of a group has reached when one of its actions begins, by `${action}:${attr}`. */
  starts: Map<string, number>
  /** A group's motion at the time it was last asked for. */
  motions: Map<number, { time: number; motion: Motion; shift: Point }>
  /** The line an object travels during each of its paths, by action id (D223). */
  travels: Map<number, PathFrame | null>
}

const cache = new WeakMap<SceneModel, Cache>()

function cacheFor(model: SceneModel): Cache {
  let c = cache.get(model)
  if (!c) {
    c = { segments: new Map(), containers: new Map(), pivots: new Map(), basePivots: new Map(), starts: new Map(), motions: new Map(), travels: new Map() }
    cache.set(model, c)
  }
  return c
}

/** The order animations stack in (D210): later in the file is on top, and of those running, the top one wins. */
function byStack(a: Action, b: Action): number {
  return a.id - b.id
}

/**
 * The action that has a say at a time, among those given in stack order (D210): of the ones
 * running, the top one; with none running, the one that ended last, the top one among those;
 * null when none has begun. With `strictStart`, an action at its very start is left out, for
 * edits that set the start state (D102 note).
 */
function topActionAt<T extends { action: Action }>(items: T[], time: number, strictStart: boolean): T | null {
  let running: T | null = null
  let ended: T | null = null
  for (const item of items) {
    const a = item.action
    if (strictStart ? a.start >= time : a.start > time) continue
    if (time < a.end && a.end > a.start) running = item
    else if (!ended || a.end >= ended.action.end) ended = item
  }
  return running ?? ended
}

function segmentsFor(model: SceneModel, obj: SceneObject, attr: string): Segments {
  const c = cacheFor(model)
  const key = `${obj.id}:${attr}`
  let segments = c.segments.get(key)
  if (!segments) {
    const type = attrSchema(obj.className, attr)?.type
    segments = { absolute: [], relative: [] }
    const sorted = obj.actions.filter((a) => (attr in a.changes || (a.verb === 'path' && pathDrives(a, attr))) && !a.overridden).sort(byStack)
    for (const action of sorted) {
      const segment: Segment = { action, to: action.changes[attr]!, from: action.from[attr], ease: easingFor(action.timing, action.end - action.start) }
      if (action.timing.relative && type === 'number') segments.relative.push(segment)
      else segments.absolute.push(segment)
    }
    c.segments.set(key, segments)
  }
  return segments
}

function isAttrValue(v: unknown): v is AttrValue {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
}

/** Turn a written attribute into a value at a time: literals pass through, functions run. */
/** Run code from the scene with the sampling context at this time, so what it reads of other objects is their animated value; its fallback when it throws or nests too deep. */
function sampled<T>(model: SceneModel, time: number, fn: () => T, fallback: T): T {
  if (samplingContext.depth > 8) return fallback
  const previous = { model: samplingContext.model, time: samplingContext.time }
  samplingContext.model = model
  samplingContext.time = time
  samplingContext.depth++
  try {
    return fn()
  } catch {
    return fallback
  } finally {
    samplingContext.depth--
    samplingContext.model = previous.model
    samplingContext.time = previous.time
  }
}

function resolveSource(model: SceneModel, source: AttrSource, time: number, fallback: AttrValue): AttrValue {
  if (typeof source !== 'function') return source
  const value = sampled<unknown>(model, time, source, fallback)
  return isAttrValue(value) ? value : fallback
}

function num(model: SceneModel, source: AttrSource | undefined, time: number): number {
  const v = resolveSource(model, source ?? 0, time, 0)
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function numValue(v: AttrValue): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function fallbackFor(obj: SceneObject, attr: string): AttrValue {
  return defaultFor(obj.className, attr, obj.attrs) ?? 0
}

/** The attribute before any action touches it. */
export function baseValue(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const fallback = fallbackFor(obj, attr)
  const source = obj.attrs[attr]
  return source === undefined ? fallback : resolveSource(model, source, time, fallback)
}

/**
 * The value the first `count` absolute segments, in stack order, give at a time (D210): of the
 * segments running, the top one; with none running, the one that ended last holds its end, the
 * top one among ties; with none begun, the base value. A segment starts from what the segments
 * below it show as it begins, so a higher one takes over for its span and the lower ones show
 * through again after it.
 */
function evalAbsolute(model: SceneModel, obj: SceneObject, attr: string, segments: Segment[], count: number, time: number, type: AttrType): AttrValue {
  let running = -1
  let ended = -1
  for (let i = 0; i < count; i++) {
    const a = segments[i]!.action
    if (a.start > time) continue
    if (time < a.end && a.end > a.start) running = i
    else if (ended < 0 || a.end >= segments[ended]!.action.end) ended = i
  }
  const index = running >= 0 ? running : ended
  if (index < 0) {
    // Nothing has begun: the next action given a start of its own holds that start, as it holds its end after it (D221).
    let pending: Segment | null = null
    for (let i = 0; i < count; i++) {
      const s = segments[i]!
      if (s.from !== undefined && (!pending || s.action.start < pending.action.start)) pending = s
    }
    return pending ? resolveSource(model, pending.from!, time, fallbackFor(obj, attr)) : baseValue(model, obj, attr, time)
  }
  const segment = segments[index]!
  const action = segment.action
  // A path puts the object on its shape by the eased progress (D192).
  if (action.verb === 'path') return pathValue(model, obj, action, attr, time)
  const to = resolveSource(model, segment.to, time, fallbackFor(obj, attr))
  // After its end, an action holds the value its easing reached (D220): the target for any usual easing, elsewhere for one that falls back, as a pulse does.
  const progress = running < 0 ? segment.ease(1) : segment.ease((time - action.start) / (action.end - action.start))
  if (running < 0 && progress === 1) return to
  // From where it was written to begin (D221), else from what the segments below show as it begins.
  const from = segment.from !== undefined ? resolveSource(model, segment.from, time, fallbackFor(obj, attr)) : evalAbsolute(model, obj, attr, segments, index, action.start, type)
  return interpolate(from, to, progress, type)
}

/** Which attributes a path drives: the position, and the rotation when it orients along the shape (D192). */
function pathDrives(action: Action, attr: string): boolean {
  return attr === 'x' || attr === 'y' || (attr === 'rotation' && action.changes['orient'] === true)
}

/**
 * The absolute path that owns an attribute at a time, or null (D205): it has begun, it drives the
 * attribute, and no action that began later changes the attribute outright. While a path owns a
 * value, nothing written elsewhere shows, so the GUI edits the path instead.
 */
export function pathHolds(obj: SceneObject, attr: string, time: number): Action | null {
  const items = obj.actions
    .filter((a) => !a.overridden && !a.timing.relative && (a.verb === 'path' ? pathDrives(a, attr) : attr in a.changes))
    .sort(byStack)
    .map((action) => ({ action }))
  const top = topActionAt(items, time, false)
  return top?.action.verb === 'path' ? top.action : null
}

function pointOf(raw: unknown): Point | null {
  if (Array.isArray(raw) && raw.length >= 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number' && Number.isFinite(raw[0]) && Number.isFinite(raw[1])) return { x: raw[0], y: raw[1] }
  if (raw && typeof raw === 'object' && typeof (raw as Point).x === 'number' && typeof (raw as Point).y === 'number') return { x: (raw as Point).x, y: (raw as Point).y }
  return null
}

function pointsOf(raw: unknown): Point[] {
  return Array.isArray(raw) ? raw.map(pointOf).filter((p): p is Point => !!p) : []
}

/**
 * A path's shape (D192): a list of points, traveled by distance, or a function of the progress,
 * 0 to 1, giving the point there. A function with no parameter is a link that gives the points.
 */
export type Shape = { kind: 'points'; points: Point[] } | { kind: 'function'; at: (p: number) => Point | null }

/** The shape a path action was given, as it stands at a time; null when it has none that can be used. */
export function pathShape(model: SceneModel, action: Action, time: number): Shape | null {
  const raw = action.changes['shape'] as unknown
  if (typeof raw === 'function') {
    const fn = raw as (p?: number) => unknown
    if (fn.length === 0) {
      const points = pointsOf(sampled<unknown>(model, time, () => fn(), null))
      return points.length > 0 ? { kind: 'points', points } : null
    }
    return { kind: 'function', at: (p) => pointOf(sampled<unknown>(model, time, () => fn(p), null)) }
  }
  const points = pointsOf(raw)
  return points.length > 0 ? { kind: 'points', points } : null
}

/** How far a path's shape is shifted from how it is written: by `offset` (D192). */
export function pathShift(action: Action): Point {
  return pointOf(action.changes['offset'] as unknown) ?? { x: 0, y: 0 }
}

/** How many pieces a function shape is drawn in, and how many a smooth span between two anchors is. */
const SHAPE_SAMPLES = 96
const SPAN_STEPS = 24

/**
 * A path's line (D194, D199): its anchors as written, the curve through them, straight or
 * smooth, each point of the curve tagged with the span of anchors it comes from, and the length
 * along the curve up to it, so the object travels by distance and the preview edits by anchor.
 * A function shape is sampled along its progress and has no anchors.
 */
export interface PathFrame {
  anchors: Point[]
  curve: Point[]
  /** For each point of the curve, the span it comes from: the first point counts as span 0, and a span's end anchor as that span. */
  spans: number[]
  /** The length along the curve up to each of its points. */
  cumulative: number[]
}

function framed(anchors: Point[], curve: Point[], spans: number[]): PathFrame {
  const cumulative = [0]
  for (let i = 1; i < curve.length; i++) cumulative.push(cumulative[i - 1]! + Math.hypot(curve[i]!.x - curve[i - 1]!.x, curve[i]!.y - curve[i - 1]!.y))
  return { anchors, curve, spans, cumulative }
}

/** A smooth curve through the anchors: a centripetal Catmull-Rom spline, which passes through every anchor and needs no handles (D199). */
function smoothCurve(anchors: Point[]): PathFrame {
  const n = anchors.length
  if (n < 3) return framed(anchors, anchors, anchors.map((_, i) => Math.max(0, i - 1)))
  const curve: Point[] = [anchors[0]!]
  const spans: number[] = [0]
  // Beyond each end the curve continues straight: a mirror of the next anchor stands in.
  const at = (i: number): Point => {
    if (i < 0) return { x: 2 * anchors[0]!.x - anchors[1]!.x, y: 2 * anchors[0]!.y - anchors[1]!.y }
    if (i >= n) return { x: 2 * anchors[n - 1]!.x - anchors[n - 2]!.x, y: 2 * anchors[n - 1]!.y - anchors[n - 2]!.y }
    return anchors[i]!
  }
  const knot = (a: Point, b: Point): number => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
  const mix = (a: Point, b: Point, w: number): Point => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w })
  for (let i = 0; i + 1 < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t0 = 0
    const t1 = t0 + knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let s = 1; s <= SPAN_STEPS; s++) {
      const t = t1 + ((t2 - t1) * s) / SPAN_STEPS
      const a1 = mix(p0, p1, (t - t0) / (t1 - t0))
      const a2 = mix(p1, p2, (t - t1) / (t2 - t1))
      const a3 = mix(p2, p3, (t - t2) / (t3 - t2))
      const b1 = mix(a1, a2, (t - t0) / (t2 - t0))
      const b2 = mix(a2, a3, (t - t1) / (t3 - t1))
      curve.push(mix(b1, b2, (t - t1) / (t2 - t1)))
      spans.push(i)
    }
  }
  return framed(anchors, curve, spans)
}

/** The curves built from each literal shape, which stays the same object for as long as the model does. */
const frameCache = new WeakMap<object, { smooth: boolean; frame: PathFrame }>()

/** The line of a path, as written and shifted, or null when it has no shape to use. */
export function pathFrame(model: SceneModel, action: Action, time: number): PathFrame | null {
  const shape = pathShape(model, action, time)
  if (!shape) return null
  let frame: PathFrame
  if (shape.kind === 'function') {
    const curve: Point[] = []
    for (let i = 0; i <= SHAPE_SAMPLES; i++) {
      const p = shape.at(i / SHAPE_SAMPLES)
      if (p) curve.push(p)
    }
    frame = framed([], curve, curve.map(() => 0))
  } else {
    const smooth = action.changes['smooth'] === true
    const raw = action.changes['shape'] as unknown
    const key = typeof raw === 'object' && raw !== null ? raw : null
    const cached = key ? frameCache.get(key) : undefined
    if (cached && cached.smooth === smooth) frame = cached.frame
    else {
      frame = smooth ? smoothCurve(shape.points) : framed(shape.points, shape.points, shape.points.map((_, i) => Math.max(0, i - 1)))
      if (key) frameCache.set(key, { smooth, frame })
    }
  }
  const shift = pathShift(action)
  if (shift.x === 0 && shift.y === 0) return frame
  const moved = (p: Point): Point => ({ x: p.x + shift.x, y: p.y + shift.y })
  return { anchors: frame.anchors.map(moved), curve: frame.curve.map(moved), spans: frame.spans, cumulative: frame.cumulative }
}

/** The point a fraction of the way along a frame's curve, by distance, the direction of travel there in degrees, and which piece of the curve it is on. */
function alongFrame(frame: PathFrame, fraction: number): { point: Point; angle: number; segment: number } {
  const { curve, cumulative } = frame
  if (curve.length === 1) return { point: curve[0]!, angle: 0, segment: 0 }
  const total = cumulative[cumulative.length - 1]!
  const target = Math.max(0, Math.min(1, fraction)) * total
  let lo = 0
  let hi = cumulative.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid + 1]! < target) lo = mid + 1
    else hi = mid
  }
  const a = curve[lo]!
  const b = curve[lo + 1]!
  const length = cumulative[lo + 1]! - cumulative[lo]!
  const t = length > 1e-9 ? (target - cumulative[lo]!) / length : 1
  return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, segment: lo }
}

/**
 * The anchor to move so that the object's place on the path at a progress changes (D197): the
 * nearer end of the span there when it lies within reach, else a new anchor to put in at that place.
 */
export function anchorAtProgress(frame: PathFrame, progress: number, reach: number): { index: number; insert: Point | null } {
  const { point, segment } = alongFrame(frame, progress)
  const span = frame.spans[Math.min(segment + 1, frame.spans.length - 1)] ?? 0
  let best: number | null = null
  let bestDistance = reach
  for (const i of [span, span + 1]) {
    const anchor = frame.anchors[i]
    if (!anchor) continue
    const d = Math.hypot(anchor.x - point.x, anchor.y - point.y)
    if (d <= bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best !== null ? { index: best, insert: null } : { index: span + 1, insert: point }
}

/** Where a path puts its object at a progress, and the direction of travel there in degrees (D192). */
export function pathPointAt(model: SceneModel, action: Action, progress: number, time: number): { point: Point; angle: number } | null {
  const shape = pathShape(model, action, time)
  if (!shape) return null
  if (shape.kind === 'points') {
    const frame = pathFrame(model, action, time)
    if (!frame) return null
    const { point, angle } = alongFrame(frame, progress)
    return { point, angle }
  }
  const point = shape.at(progress)
  if (!point) return null
  const step = 1e-3
  const a = shape.at(Math.max(0, progress - step))
  const b = shape.at(Math.min(1, progress + step))
  const shift = pathShift(action)
  return { point: { x: point.x + shift.x, y: point.y + shift.y }, angle: a && b ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : 0 }
}

/** The curve index of a path's anchor: the frame has one point per span between anchors, or a fixed number when smooth, so the anchors sit evenly along it. */
function anchorCurveIndex(frame: PathFrame, index: number): number {
  const n = frame.anchors.length
  return n < 2 ? 0 : Math.round((index * (frame.curve.length - 1)) / (n - 1))
}

/** When an object on a path reaches each of the path's anchors (D223): the time at which the easing has brought it the anchor's share of the way along the curve, by distance. */
function anchorTimes(action: Action, frame: PathFrame): number[] {
  const span = action.end - action.start
  const total = frame.cumulative[frame.cumulative.length - 1] ?? 0
  const ease = easingFor(action.timing, span)
  return frame.anchors.map((_, i) => {
    if (frame.anchors.length < 2 || total <= 0 || span <= 0) return action.start
    const fraction = frame.cumulative[anchorCurveIndex(frame, i)]! / total
    return action.start + unease(ease, fraction) * span
  })
}

/** When an object on a path reaches one of the path's anchors, by the anchor's index (D223); the path's start when it has no such anchor. */
export function anchorTime(model: SceneModel, action: Action, index: number): number {
  const frame = pathFrame(model, action, action.start)
  return frame ? (anchorTimes(action, frame)[index] ?? action.start) : action.start
}

/** What else puts an object where it is during a path, at a time (D196, D223, D225): its position with the path's own point taken off; under a relative path what the path adds to, under an absolute one the relative changes added on top. */
function underPath(model: SceneModel, obj: SceneObject, action: Action, time: number): Point {
  const own = positionAt(model, obj, time)
  const at = pathPointAt(model, action, progressAt(action, time), time)
  return at ? { x: own.x - at.point.x, y: own.y - at.point.y } : own
}

/** A point of an object's own space carried through its groups to where it is drawn, at a time (D124). */
function carried(model: SceneModel, obj: SceneObject, time: number, point: Point): Point {
  let pose: Pose = { x: point.x, y: point.y, rotation: 0, scale: 1 }
  for (const g of containers(model, obj)) pose = carry(model, g, time, pose)
  return { x: pose.x, y: pose.y }
}

/** A drawn point taken back through an object's groups into its own space, at a time: the inverse of `carried`. */
function uncarried(model: SceneModel, obj: SceneObject, time: number, point: Point): Point {
  let p = point
  for (const g of [...containers(model, obj)].reverse()) {
    const { motion, shift } = groupMotion(model, g, time)
    const x = p.x - shift.x - motion.dx
    const y = p.y - shift.y - motion.dy
    const s = motion.s === 0 ? 1 : motion.s
    p = { x: (motion.cos * x + motion.sin * y) / s, y: (-motion.sin * x + motion.cos * y) / s }
  }
  return p
}

/**
 * The line an object actually travels during a path (D223): where it is drawn, sampled over the
 * path's span with its anchors where the object is when it reaches each, so a relative path shows
 * from where the object is, a move under a path shows in the line, and a path on a member of a
 * group shows where the group puts it. Each point of the curve is tagged with the span of anchors
 * the object is on there, as the path's own line is. Null when the path has no shape. Kept per
 * model, since it does not depend on the time shown.
 */
export function travelFrame(model: SceneModel, obj: SceneObject, action: Action): PathFrame | null {
  const c = cacheFor(model)
  const known = c.travels.get(action.id)
  if (known !== undefined) return known
  const frame = buildTravel(model, obj, action)
  c.travels.set(action.id, frame)
  return frame
}

/** How many points a second of travel is drawn with, and the most a path is drawn with. */
const TRAVEL_RATE = 60
const TRAVEL_MAX = 900

function buildTravel(model: SceneModel, obj: SceneObject, action: Action): PathFrame | null {
  const shape = pathFrame(model, action, action.start)
  if (!shape) return null
  const span = Math.max(0, action.end - action.start)
  const times = anchorTimes(action, shape)
  // Each anchor where the object is as it reaches it: under a relative path, what else moves the object then, with the anchor's change on top (D196).
  const anchors = shape.anchors.map((a, i) => {
    const t = times[i]!
    const under = underPath(model, obj, action, t)
    return carried(model, obj, t, { x: under.x + a.x, y: under.y + a.y })
  })
  const drawnAt = (t: number): Point => {
    const pose = worldPose(model, obj, t)
    return { x: pose.x, y: pose.y }
  }
  if (span <= 0) {
    const only = anchors[0] ?? drawnAt(action.start)
    return framed(anchors, [only], [0])
  }
  // Sampled evenly in time, for whatever else moves the object, and at the moment each point of the shape's own line is reached, so the line keeps the shape's resolution however the easing hurries, and passes through the anchors.
  const steps = Math.min(TRAVEL_MAX, Math.max(1, Math.round(span * TRAVEL_RATE)))
  const sampleTimes = new Set<number>()
  for (let k = 0; k <= steps; k++) sampleTimes.add(action.start + (span * k) / steps)
  for (const t of times) sampleTimes.add(t)
  const total = shape.cumulative[shape.cumulative.length - 1] ?? 0
  if (total > 0) {
    const ease = easingFor(action.timing, span)
    for (const length of shape.cumulative) sampleTimes.add(action.start + unease(ease, length / total) * span)
  }
  const curve: Point[] = []
  const spans: number[] = []
  for (const t of [...sampleTimes].sort((a, b) => a - b)) {
    curve.push(drawnAt(t))
    const { segment } = alongFrame(shape, progressAt(action, t))
    spans.push(shape.spans[Math.min(segment + 1, shape.spans.length - 1)] ?? 0)
  }
  return framed(anchors, curve, spans)
}

/**
 * Where a point of a path's shape is written for a place in the scene (D223): the place taken
 * back through the object's groups at the time the object is there, what lay under a relative
 * path then taken off, and `offset` taken off. The inverse of how the travelled line is drawn.
 */
export function rawFromWorld(model: SceneModel, obj: SceneObject, action: Action, time: number, world: Point): Point {
  const local = uncarried(model, obj, time, world)
  const shift = pathShift(action)
  const under = underPath(model, obj, action, time)
  return { x: local.x - shift.x - under.x, y: local.y - shift.y - under.y }
}

/** The point a fraction of the way along a polyline, by distance, and the direction there in degrees. */
export function pointAlong(points: Point[], fraction: number): { point: Point; angle: number } {
  if (points.length === 1) return { point: points[0]!, angle: 0 }
  const lengths: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
    lengths.push(len)
    total += len
  }
  let target = Math.max(0, Math.min(1, fraction)) * total
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!
    const a = points[i]!
    const b = points[i + 1]!
    if (target <= len || i === lengths.length - 1) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, target / len)) : 1
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
    }
    target -= len
  }
  return { point: points[points.length - 1]!, angle: 0 }
}

function pathValue(model: SceneModel, obj: SceneObject, action: Action, attr: string, time: number): AttrValue {
  const at = pathPointAt(model, action, progressAt(action, time), time)
  if (!at) return baseValue(model, obj, attr, time)
  if (attr === 'x') return at.point.x
  if (attr === 'y') return at.point.y
  return at.angle
}

/** Eased progress of an action at a time: 0 before it starts, and once it has ended, what its easing reaches at 1, which is 1 for any usual easing (D220). */
export function progressAt(action: Action, time: number): number {
  if (time <= action.start) return 0
  const ease = easingFor(action.timing, action.end - action.start)
  if (time >= action.end || action.end <= action.start) return ease(1)
  return ease((time - action.start) / (action.end - action.start))
}

/** What the absolute actions alone give an attribute at a time, before any relative change is added: where a new absolute action must begin for the object to stay put (D210, D225). */
export function absoluteAt(model: SceneModel, obj: SceneObject, attr: string, time: number): number {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const { absolute } = segmentsFor(model, obj, attr)
  return numValue(evalAbsolute(model, obj, attr, absolute, absolute.length, time, schema.type))
}

/** The value of an attribute at a time, with every action and link applied: the latest absolute action, then every relative change on top (D53). */
export function valueAt(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const { absolute, relative } = segmentsFor(model, obj, attr)
  let value = evalAbsolute(model, obj, attr, absolute, absolute.length, time, schema.type)
  if (relative.length > 0 && typeof value === 'number') {
    let sum = value
    for (const segment of relative) {
      if (segment.action.start > time) {
        // A relative change given a start of its own adds that start until it begins (D221).
        const from = segment.from !== undefined ? resolveSource(model, segment.from, time, 0) : 0
        if (typeof from === 'number') sum += from
        continue
      }
      if (segment.action.verb === 'path') {
        // A relative path's shape is changes from where the object is, added on top of whatever else moves it (D196).
        const at = pathPointAt(model, segment.action, progressAt(segment.action, time), time)
        if (at) sum += attr === 'x' ? at.point.x : attr === 'y' ? at.point.y : at.angle
        continue
      }
      const to = resolveSource(model, segment.to, time, 0)
      const from = segment.from !== undefined ? resolveSource(model, segment.from, time, 0) : 0
      // A relative change runs from its own start, when written as a range, else from nothing, to its value (D221).
      if (typeof to === 'number' && typeof from === 'number') sum += from + (to - from) * progressAt(segment.action, time)
    }
    value = sum
  }
  return value
}

/** Drop what the sampler has worked out for a model, for when its actions' times change under it. */
export function forgetSampling(model: SceneModel): void {
  cache.delete(model)
}

/** A stretch of time during which an object is doing something (D212). */
export interface Stretch {
  start: number
  end: number
}

/**
 * When an object is in a state (D212), frame by frame from when it begins to a frame past its
 * last animation, or to when it is removed: moving, or moving a way, by its position changing
 * between one frame and the next; still, by its not changing; turning, a way, by its rotation;
 * growing and shrinking, by its drawn size; visible and hidden, by its opacity; fading in and
 * out, by its opacity changing. Each run of frames is one stretch.
 */
export function stateStretches(model: SceneModel, obj: SceneObject, name: StateName, direction: StateDirection | undefined, fps: number): Stretch[] {
  const dt = 1 / fps
  const from = obj.at
  const own = obj.actions.filter((a) => !a.overridden)
  const last = Math.max(from, ...own.map((a) => a.end)) + dt
  const to = obj.until !== null ? Math.min(obj.until, last) : last
  const eps = 1e-4
  const rotation = (t: number): number => numValue(valueAt(model, obj, 'rotation', t))
  const size = (t: number): number => {
    const scale = numValue(valueAt(model, obj, 'scale', t))
    if (attrSchema(obj.className, 'width')) return scale * (numValue(valueAt(model, obj, 'width', t)) + numValue(valueAt(model, obj, 'height', t)))
    if (attrSchema(obj.className, 'fontSize')) return scale * numValue(valueAt(model, obj, 'fontSize', t))
    return scale
  }
  const holds = (t: number): boolean => {
    if (!existsAt(model, obj, t)) return false
    switch (name) {
      case 'moving':
      case 'still': {
        const a = positionAt(model, obj, t)
        const b = positionAt(model, obj, t + dt)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const moving = direction === 'left' ? dx < -eps : direction === 'right' ? dx > eps : direction === 'up' ? dy > eps : direction === 'down' ? dy < -eps : Math.hypot(dx, dy) > eps
        return name === 'moving' ? moving : !moving
      }
      case 'turning': {
        const d = rotation(t + dt) - rotation(t)
        return direction === 'clockwise' ? d < -eps : direction === 'counterclockwise' ? d > eps : Math.abs(d) > eps
      }
      case 'growing':
        return size(t + dt) - size(t) > eps
      case 'shrinking':
        return size(t) - size(t + dt) > eps
      case 'visible':
        return opacityAt(model, obj, t) > 0.0005
      case 'hidden':
        return opacityAt(model, obj, t) <= 0.0005
      case 'fadingIn':
        return opacityAt(model, obj, t + dt) - opacityAt(model, obj, t) > eps
      case 'fadingOut':
        return opacityAt(model, obj, t) - opacityAt(model, obj, t + dt) > eps
    }
  }
  const stretches: Stretch[] = []
  let open: number | null = null
  const steps = Math.max(0, Math.round((to - from) / dt))
  for (let k = 0; k <= steps; k++) {
    const t = from + k * dt
    const on = t < to && holds(t)
    if (on && open === null) open = t
    if (!on && open !== null) {
      stretches.push({ start: open, end: t })
      open = null
    }
  }
  if (open !== null) stretches.push({ start: open, end: to })
  return stretches
}

/** Where an object's own values put it at a time, before any group carries it. */
export function positionAt(model: SceneModel, obj: SceneObject, time: number): Point {
  return { x: numValue(valueAt(model, obj, 'x', time)), y: numValue(valueAt(model, obj, 'y', time)) }
}

/** The drawn size of an object as its own values give it, before its scale. */
function ownSize(model: SceneModel, obj: SceneObject, time: number): { width: number; height: number } {
  if (obj.className === 'Text') {
    const text = String(valueAt(model, obj, 'text', time))
    const fontSize = numValue(valueAt(model, obj, 'fontSize', time))
    const font = String(valueAt(model, obj, 'font', time))
    return textMeasurer.current?.(text, fontSize, font) ?? { width: Math.max(1, fontSize * 0.55 * text.length), height: fontSize * 1.2 }
  }
  return { width: numValue(valueAt(model, obj, 'width', time)), height: numValue(valueAt(model, obj, 'height', time)) }
}

function apply(m: Motion, p: Point): Point {
  return { x: m.s * (m.cos * p.x - m.sin * p.y) + m.dx, y: m.s * (m.sin * p.x + m.cos * p.y) + m.dy }
}

/** The motion followed by a turn of `degrees` around a point of the space it acts on. */
function turnedAbout(m: Motion, c: Point, degrees: number): Motion {
  // m ∘ Rot(c, a): the point turns around c first, then follows m.
  const a = (degrees * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const shifted = { x: c.x - (cos * c.x - sin * c.y), y: c.y - (sin * c.x + cos * c.y) }
  const d = apply(m, shifted)
  return { s: m.s, angle: m.angle + degrees, cos: m.cos * cos - m.sin * sin, sin: m.sin * cos + m.cos * sin, dx: d.x, dy: d.y }
}

/** The motion followed by a scaling by `factor` around a point of the space it acts on. */
function scaledAbout(m: Motion, c: Point, factor: number): Motion {
  // m ∘ Scl(c, f).
  const shifted = { x: c.x * (1 - factor), y: c.y * (1 - factor) }
  const d = apply(m, shifted)
  return { s: m.s * factor, angle: m.angle, cos: m.cos, sin: m.sin, dx: d.x, dy: d.y }
}

/** The actions of a group that move, turn, or scale it, in start order. */
function groupActions(group: SceneObject): Action[] {
  return group.actions.filter((a) => !a.overridden && ('rotation' in a.changes || 'scale' in a.changes || 'x' in a.changes || 'y' in a.changes)).sort((a, b) => a.start - b.start || a.id - b.id)
}

/** The value a group's attribute has reached when one of its actions begins: its base, plus what every earlier action had done by then. */
function reachedAt(model: SceneModel, group: SceneObject, actions: Action[], k: number, attr: string): number {
  const c = cacheFor(model)
  const key = `${actions[k]!.id}:${attr}`
  let value = c.starts.get(key)
  if (value === undefined) {
    const start = actions[k]!.start
    value = numValue(baseValue(model, group, attr, start))
    if (attr === 'scale' && value === 0) value = 1
    for (let j = 0; j < k; j++) {
      const action = actions[j]!
      if (action.start > start || !(attr in action.changes)) continue
      value = attr === 'scale' ? value * factorOf(model, group, actions, j, start) : value + changeOf(model, group, actions, j, attr, start)
    }
    c.starts.set(key, value)
  }
  return value
}

/** What one action has added to an attribute by a time: its eased way from the value reached at its start to its target, or its relative change. */
function changeOf(model: SceneModel, group: SceneObject, actions: Action[], j: number, attr: string, time: number): number {
  const action = actions[j]!
  const p = progressAt(action, time)
  const target = num(model, action.changes[attr], time)
  return action.timing.relative ? target * p : (target - reachedAt(model, group, actions, j, attr)) * p
}

/** What one action has multiplied the scale by, by a time. */
function factorOf(model: SceneModel, group: SceneObject, actions: Action[], j: number, time: number): number {
  const action = actions[j]!
  const p = progressAt(action, time)
  const target = num(model, action.changes['scale'], time)
  const from = reachedAt(model, group, actions, j, 'scale')
  const now = action.timing.relative ? from + target * p : from + (target - from) * p
  return from === 0 ? 1 : now / from
}

/**
 * What one of a group's actions turns or scales around (D124): the point it names as
 * `pivotX, pivotY`, which the GUI writes when it makes the action so that nothing done later can
 * move it; else the center of the members' box when the action begins. Memoised per model.
 */
export function pivotOf(model: SceneModel, group: SceneObject, action: Action): Point {
  const c = cacheFor(model)
  let pivot = c.pivots.get(action.id)
  if (!pivot) {
    if (action.changes['pivotX'] !== undefined && action.changes['pivotY'] !== undefined) pivot = { x: num(model, action.changes['pivotX'], action.start), y: num(model, action.changes['pivotY'], action.start) }
    else {
      const box = memberBox(model, group, action.start)
      pivot = box ? { x: box.x, y: box.y } : { x: 0, y: 0 }
    }
    c.pivots.set(action.id, pivot)
  }
  return pivot
}

/**
 * What a group's own `rotation` and `scale` pivot on (D124): the point its declaration names as
 * `pivotX, pivotY`, which the GUI writes the first time it turns or scales the group so that a
 * member moved later never moves it; else the center of the members' box at time zero. Memoised
 * per model.
 */
export function basePivot(model: SceneModel, group: SceneObject): Point {
  const c = cacheFor(model)
  let pivot = c.basePivots.get(group.id)
  if (!pivot) {
    const px = group.attrs['pivotX']
    const py = group.attrs['pivotY']
    if (px !== undefined && py !== undefined) pivot = { x: num(model, px, 0), y: num(model, py, 0) }
    else {
      const box = memberBox(model, group, 0)
      pivot = box ? { x: box.x, y: box.y } : { x: 0, y: 0 }
    }
    c.basePivots.set(group.id, pivot)
  }
  return pivot
}

/**
 * A group's motion at a time (D124): its own turn and scale around its declared pivot, or its
 * box at time zero, then its animations in order, each turn and scale around the center of the
 * members' box when that action began, kept afterwards; its moves add up as a shift laid on top.
 * Earlier turns keep their pivots whatever happens later.
 */
export function groupMotion(model: SceneModel, group: SceneObject, time: number): { motion: Motion; shift: Point } {
  const c = cacheFor(model)
  const memo = c.motions.get(group.id)
  if (memo && memo.time === time) return { motion: memo.motion, shift: memo.shift }
  let motion = IDENTITY
  const baseRotation = numValue(baseValue(model, group, 'rotation', time))
  const baseScaleValue = numValue(baseValue(model, group, 'scale', time))
  const baseScale = baseScaleValue === 0 ? 1 : baseScaleValue
  if (baseRotation !== 0 || baseScale !== 1) {
    const c0 = basePivot(model, group)
    if (baseRotation !== 0) motion = turnedAbout(motion, c0, baseRotation)
    if (baseScale !== 1) motion = scaledAbout(motion, c0, baseScale)
  }
  const shift = { x: numValue(baseValue(model, group, 'x', time)), y: numValue(baseValue(model, group, 'y', time)) }
  const actions = groupActions(group)
  for (let k = 0; k < actions.length; k++) {
    const action = actions[k]!
    if (action.start > time) break
    const pivot = 'rotation' in action.changes || 'scale' in action.changes ? pivotOf(model, group, action) : null
    if (pivot && 'rotation' in action.changes) motion = turnedAbout(motion, pivot, changeOf(model, group, actions, k, 'rotation', time))
    if (pivot && 'scale' in action.changes) motion = scaledAbout(motion, pivot, factorOf(model, group, actions, k, time))
    if ('x' in action.changes) shift.x += changeOf(model, group, actions, k, 'x', time)
    if ('y' in action.changes) shift.y += changeOf(model, group, actions, k, 'y', time)
  }
  c.motions.set(group.id, { time, motion, shift })
  return { motion, shift }
}

/** A pose carried through a group's motion: turned and scaled as the group's actions have done, then shifted by its moves (D124). */
export function carry(model: SceneModel, group: SceneObject, time: number, pose: Pose): Pose {
  const { motion, shift } = groupMotion(model, group, time)
  const p = apply(motion, pose)
  return { x: p.x + shift.x, y: p.y + shift.y, rotation: pose.rotation + motion.angle, scale: pose.scale * motion.s }
}

/**
 * The box around a group's members as their own values place them, before the group's own
 * motion: upright in the group's own space, or null when no member is visible. Its center is what
 * the group's next turn or scale pivots around, and the group's motion turns the box with it.
 */
export function memberBox(model: SceneModel, group: SceneObject, time: number, seen = new Set<string>()): BoxFrame | null {
  seen.add(group.name)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const add = (f: BoxFrame) => {
    const a = (f.rotation * Math.PI) / 180
    const c = Math.cos(a)
    const d = Math.sin(a)
    for (const [lx, ly] of [
      [-f.width / 2, -f.height / 2],
      [f.width / 2, -f.height / 2],
      [-f.width / 2, f.height / 2],
      [f.width / 2, f.height / 2],
    ]) {
      const wx = f.x + lx! * c - ly! * d
      const wy = f.y + lx! * d + ly! * c
      minX = Math.min(minX, wx)
      maxX = Math.max(maxX, wx)
      minY = Math.min(minY, wy)
      maxY = Math.max(maxY, wy)
    }
  }
  for (const name of model.groups.get(group.name) ?? []) {
    const member = model.objects.find((o) => o.name === name)
    if (!member || seen.has(member.name)) continue
    let frame: BoxFrame
    if (member.className === GROUP) {
      const inner = memberBox(model, member, time, seen)
      if (!inner) continue
      const placed = carry(model, member, time, { x: inner.x, y: inner.y, rotation: 0, scale: 1 })
      frame = { x: placed.x, y: placed.y, rotation: placed.rotation, width: inner.width * placed.scale, height: inner.height * placed.scale }
    } else {
      if (!isVisibleAt(model, member, time)) continue
      const own = ownPose(model, member, time)
      const size = ownSize(model, member, time)
      frame = { x: own.x, y: own.y, rotation: own.rotation, width: size.width * own.scale, height: size.height * own.scale }
    }
    // The groups that carry the member before this one place it in this group's space.
    const chain = containers(model, member)
    const upTo = Math.max(0, chain.indexOf(group))
    let pose: Pose = { x: frame.x, y: frame.y, rotation: frame.rotation, scale: 1 }
    for (const g of chain.slice(0, upTo)) pose = carry(model, g, time, pose)
    add({ x: pose.x, y: pose.y, rotation: pose.rotation, width: frame.width * pose.scale, height: frame.height * pose.scale })
  }
  if (!Number.isFinite(minX)) return null
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, rotation: 0, width: maxX - minX, height: maxY - minY }
}

/** The groups whose motions carry an object, inner first: each group that lists it, in declaration order, each followed by its own carriers (D124). */
export function containers(model: SceneModel, obj: SceneObject): SceneObject[] {
  const c = cacheFor(model)
  let list = c.containers.get(obj.id)
  if (!list) {
    const found: SceneObject[] = []
    const seen = new Set<string>([obj.name])
    const walk = (o: SceneObject) => {
      for (const name of o.groups) {
        if (seen.has(name)) continue
        seen.add(name)
        const g = model.objects.find((x) => x.name === name)
        if (!g) continue
        found.push(g)
        walk(g)
      }
    }
    walk(obj)
    list = found
    c.containers.set(obj.id, list)
  }
  return list
}

/**
 * The pose an object's own values give it, before any group carries it. For a group it is its
 * drawn box: the members' box carried through the group's own motion.
 */
export function ownPose(model: SceneModel, obj: SceneObject, time: number): Pose {
  if (obj.className === GROUP) {
    const box = memberBox(model, obj, time)
    return carry(model, obj, time, { x: box?.x ?? 0, y: box?.y ?? 0, rotation: 0, scale: 1 })
  }
  const p = positionAt(model, obj, time)
  const rotation = valueAt(model, obj, 'rotation', time)
  const scale = valueAt(model, obj, 'scale', time)
  return { x: p.x, y: p.y, rotation: typeof rotation === 'number' ? rotation : 0, scale: typeof scale === 'number' ? scale : 1 }
}

/** Where an object is drawn: its own pose carried through every group it belongs to (D124). */
export function worldPose(model: SceneModel, obj: SceneObject, time: number): Pose {
  let pose = ownPose(model, obj, time)
  for (const g of containers(model, obj)) pose = carry(model, g, time, pose)
  return pose
}

/** A group's drawn box: the box around its members as the group's motion and the groups above it place it, so it turns with the group (D116). */
export function groupBox(model: SceneModel, group: SceneObject, time: number): BoxFrame | null {
  const box = memberBox(model, group, time)
  if (!box) return null
  let pose: Pose = { x: box.x, y: box.y, rotation: box.rotation, scale: 1 }
  for (const g of [group, ...containers(model, group)]) pose = carry(model, g, time, pose)
  return { x: pose.x, y: pose.y, rotation: pose.rotation, width: box.width * pose.scale, height: box.height * pose.scale }
}

/** The value of an attribute as it shows: the position, rotation, and scale through the object's groups, and a group's own box; anything else as is. */
export function shownValue(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  if ((attr === 'x' || attr === 'y' || attr === 'rotation' || attr === 'scale') && (obj.groups.length > 0 || obj.className === GROUP)) return worldPose(model, obj, time)[attr]
  return valueAt(model, obj, attr, time)
}

/** Whether a value written for an attribute at a time goes to an action's own start, the `from` of a range `[from, to]` (D221): the action is at its start, and was given one. */
export function writesFrom(action: Action, attr: string, time: number): boolean {
  return action.from[attr] !== undefined && time <= action.start
}

/** The action a value written for an attribute goes to at a time: the one that has a say then, as the sampler sees it (D102, D122, D210), or null for the declaration. */
export function definingAction(obj: SceneObject, attr: string, time: number): Action | null {
  const items = obj.actions
    .filter((a) => !a.overridden && attr in a.changes)
    .sort(byStack)
    .map((action) => ({ action }))
  const begun = topActionAt(items, time, false)?.action ?? null
  if (!begun) {
    // Nothing has begun: the next absolute action given a start of its own holds that start, which is what shows and what a write goes to (D221).
    let pending: Action | null = null
    for (const { action } of items) if (!action.timing.relative && action.from[attr] !== undefined && (!pending || action.start < pending.start)) pending = action
    return pending
  }
  const top = topActionAt(items, time, true)?.action ?? null
  // At its very start an absolute action shows what lies below, unless it was given a start of its own, which is then what shows and what a write goes to (D221).
  if (begun !== top && !begun.timing.relative && writesFrom(begun, attr, time)) return begun
  return top
}

/**
 * A copy of the model in which one written value of an object differs: the declaration's
 * attribute when `action` is null, else that action's change, or with `part` its own start
 * (D221). Nothing else is touched, so what the sampler shows for the copy is what the edit
 * would show.
 */
export function withWritten(model: SceneModel, obj: SceneObject, action: Action | null, attr: string, value: number, part: 'to' | 'from' = 'to'): [SceneModel, SceneObject] {
  const actions = action ? obj.actions.map((a) => (a.id === action.id ? (part === 'from' ? { ...a, from: { ...a.from, [attr]: value } } : { ...a, changes: { ...a.changes, [attr]: value } }) : a)) : obj.actions
  const attrs = action ? obj.attrs : { ...obj.attrs, [attr]: value }
  const patched: SceneObject = { ...obj, attrs, actions }
  return [{ ...model, objects: model.objects.map((o) => (o === obj ? patched : o)) }, patched]
}

/** The value an attribute's definer holds now, as written; any number serves as a starting point when it holds none yet. */
export function currentWritten(model: SceneModel, obj: SceneObject, action: Action | null, attr: string, time: number): number {
  if (action && writesFrom(action, attr, time)) return num(model, action.from[attr], time)
  if (action && attr in action.changes) return num(model, action.changes[attr], time)
  const v = action ? valueAt(model, obj, attr, time) : baseValue(model, obj, attr, time)
  return typeof v === 'number' ? v : 0
}

/**
 * The values to write so the object shows `shown` at a time, each going to its definer (D122).
 * Whatever stacks on top of a written value, relative changes and the motions of groups, shifts
 * or turns what is shown by amounts that do not depend on it, so the shown values are affine in
 * the written ones: probing the sampler with each written value moved by one unit pins the
 * answer exactly, with no inverse to maintain. x and y are solved together, since a group's turn
 * mixes them; an axis the caller did not ask for comes back only when the solution had to move
 * it. Turns and scalings are solved first, so a group's own turn, which moves its box's center
 * when its pivot sits elsewhere, is in place when the position is solved. The shown values are
 * the drawn ones, through the object's groups (D124).
 */
export function writtenValues(model: SceneModel, obj: SceneObject, time: number, shown: Record<string, number>, definers: Record<string, Action | null>): Record<string, number> {
  const out: Record<string, number> = {}
  const probe = (patch: Record<string, number>): [SceneModel, SceneObject] => {
    let m = model
    let o = obj
    for (const [attr, value] of Object.entries(patch)) {
      const definer = definers[attr] ?? null
      ;[m, o] = withWritten(m, o, definer, attr, value, definer && writesFrom(definer, attr, time) ? 'from' : 'to')
    }
    return [m, o]
  }
  for (const [attr, target] of Object.entries(shown)) {
    if (attr === 'x' || attr === 'y') continue
    const w = currentWritten(model, obj, definers[attr] ?? null, attr, time)
    const sample = (value: number): number => {
      const v = shownValue(...probe({ ...out, [attr]: value }), attr, time)
      return typeof v === 'number' ? v : 0
    }
    const v0 = sample(w)
    const slope = sample(w + 1) - v0
    out[attr] = w + (Math.abs(slope) > 1e-9 ? (target - v0) / slope : target - v0)
  }
  if ('x' in shown || 'y' in shown) {
    // An axis not asked for stays where it shows now.
    const now = worldPose(model, obj, time)
    const target = { x: shown['x'] ?? now.x, y: shown['y'] ?? now.y }
    const w = { x: currentWritten(model, obj, definers['x'] ?? null, 'x', time), y: currentWritten(model, obj, definers['y'] ?? null, 'y', time) }
    const at = (dx: number, dy: number): Point => worldPose(...probe({ ...out, x: w.x + dx, y: w.y + dy }), time)
    const p0 = at(0, 0)
    const px = at(1, 0)
    const py = at(0, 1)
    const a = px.x - p0.x
    const b = py.x - p0.x
    const c = px.y - p0.y
    const d = py.y - p0.y
    const rx = target.x - p0.x
    const ry = target.y - p0.y
    const det = a * d - b * c
    // Written values that cannot reach the shown position as a pair are shifted on their own.
    const u = Math.abs(det) > 1e-9 ? { x: (d * rx - b * ry) / det, y: (a * ry - c * rx) / det } : { x: Math.abs(a) > 1e-9 ? rx / a : rx, y: Math.abs(d) > 1e-9 ? ry / d : ry }
    if ('x' in shown || Math.abs(u.x) > 1e-6) out['x'] = w.x + u.x
    if ('y' in shown || Math.abs(u.y) > 1e-6) out['y'] = w.y + u.y
  }
  return out
}

/**
 * Whether an object is within its lifetime at a time (D138). A group, with no life of its own,
 * always is. One removed at the content end stays on through the hold, which shows the final
 * frame (D155).
 */
export function existsAt(model: SceneModel, obj: SceneObject, time: number): boolean {
  if (obj.className === GROUP) return true
  if (time < obj.at) return false
  return obj.until === null || time < obj.until || (model.contentEnd !== null && obj.until >= model.contentEnd)
}

/** The opacity an object shows with: its own, times that of every group carrying it (D150). */
export function opacityAt(model: SceneModel, obj: SceneObject, time: number): number {
  const own = valueAt(model, obj, 'opacity', time)
  let opacity = typeof own === 'number' ? Math.max(0, Math.min(1, own)) : 1
  for (const g of containers(model, obj)) {
    const v = valueAt(model, g, 'opacity', time)
    if (typeof v === 'number') opacity *= Math.max(0, Math.min(1, v))
  }
  return opacity
}

/** An object exists within its lifetime wherever it shows with an opacity above zero (D52, D138, D150). */
export function isVisibleAt(model: SceneModel, obj: SceneObject, time: number): boolean {
  if (!attrSchema(obj.className, 'opacity')) return true
  if (!existsAt(model, obj, time)) return false
  return opacityAt(model, obj, time) > 0.0005
}

function interpolate(from: AttrValue, to: AttrValue, p: number, type: AttrType): AttrValue {
  if (type === 'number' && typeof from === 'number' && typeof to === 'number') return from + (to - from) * p
  if (type === 'color' && typeof from === 'string' && typeof to === 'string') return lerpColor(from, to, p)
  return p < 1 ? from : to
}

/** Parse #rgb or #rrggbb into 0..255 channels. */
export function parseColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function lerpColor(a: string, b: string, p: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return p < 1 ? a : b
  const mix = (i: number) => Math.round(ca[i]! + (cb[i]! - ca[i]!) * p)
  return `#${[mix(0), mix(1), mix(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
