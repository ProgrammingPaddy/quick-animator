import { attrSchema, defaultFor, GROUP, SHAPE, type AttrType, type AttrValue } from './registry'
import { DEFAULT_EASE_FRACTION, easingFor, namedEasings, unease, type Easing } from './easing'
import { boundsOf, flattenPathData, hasPathData, parsePathData, pathAnchors, placeBetween, polygonPathData, serializePathData, smoothPathData, translatePathData, type Anchor, type Seg, type Subpath } from './pathData'
import { blendMorph, morphPairs, type MorphPair } from './morph'
import { layoutOf, unitBegins, type TextLayout, type TextStyle, type UnitKind, type UnitState } from './text'
import type { Action, AttrSource, SceneModel, SceneObject, StateDirection, StateName } from './types'

/**
 * While a sample is in progress, attribute reads on object handles (inside link functions)
 * return the value at this time instead of the base value.
 */
export const samplingContext: { model: SceneModel | null; time: number; depth: number } = { model: null, time: 0, depth: 0 }


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
  /** The pairs of outlines a morph blends, matched and aligned once, by action id (D257). */
  morphs: Map<number, { from: Seg[]; to: Seg[]; pairs: MorphPair[] }>
  /** Where each action begins from, the state at its first frame, by `${action}:${attr}` (D258). */
  froms: Map<string, AttrValue>
}

const cache = new WeakMap<SceneModel, Cache>()

function cacheFor(model: SceneModel): Cache {
  let c = cache.get(model)
  if (!c) {
    c = { segments: new Map(), containers: new Map(), pivots: new Map(), basePivots: new Map(), starts: new Map(), motions: new Map(), travels: new Map(), morphs: new Map(), froms: new Map() }
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
 * running, through their last frame (D263), the top one; with none running, the one that ended
 * last, the top one among those; null when none has begun. With `strictStart`, an action at its
 * very start is left out, for edits that set the start state (D102 note).
 */
function topActionAt<T extends { action: Action }>(items: T[], time: number, strictStart: boolean): T | null {
  let running: T | null = null
  let ended: T | null = null
  for (const item of items) {
    const a = item.action
    if (strictStart ? a.start >= time - TIME_TOLERANCE : !begun(a.start, time)) continue
    if (!over(a.end, time) && a.end > a.start) running = item
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
    // An action by character, word, or line changes the units, never the object's own attribute (D268).
    const sorted = obj.actions.filter((a) => (attr in a.changes || (a.verb === 'path' && pathDrives(a, attr))) && !a.overridden && !a.timing.by).sort(byStack)
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
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || Array.isArray(v)
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
const NO_ACTIONS: readonly Action[] = []

/** Times agree within this (D275): a time written to four decimals can sit a hair past the frame it means, which must not lose the frame. */
export const TIME_TOLERANCE = 1e-4

/** Whether something that starts at `start` has begun at `time`, the written rounding allowed for (D275). */
export function begun(start: number, time: number): boolean {
  return time >= start - TIME_TOLERANCE
}

/** Whether `time` is past an end, the written rounding allowed for (D275): at the end itself it is not. */
export function over(end: number, time: number): boolean {
  return time > end + TIME_TOLERANCE
}

/**
 * The value of an attribute at a time from its absolute actions, those in `except` left out:
 * the one running, the top of the stack among those, has its say; else the last to end holds
 * what it reached; before any, the declaration. An action never dictates its start (D258): it
 * begins from the state the object is in when its first frame is active, what every other
 * animation leaves at that moment, in time order, whichever way they are written; the one
 * written exception is a start given as a range (D221).
 */
function evalAbsolute(model: SceneModel, obj: SceneObject, attr: string, segments: Segment[], time: number, type: AttrType, except: readonly Action[] = NO_ACTIONS): AttrValue {
  let running = -1
  let ended = -1
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!.action
    if (!begun(a.start, time) || except.includes(a)) continue
    // An action runs through its last frame too (D263): a piece that ends at the playhead still has the say there over what runs on below it.
    if (!over(a.end, time) && a.end > a.start) running = i
    else if (ended < 0 || a.end >= segments[ended]!.action.end) ended = i
  }
  const index = running >= 0 ? running : ended
  if (index < 0) {
    // Nothing has begun: the next action given a start of its own holds that start, as it holds its end after it (D221).
    let pending: Segment | null = null
    for (const s of segments) {
      if (except.includes(s.action)) continue
      if (s.from !== undefined && (!pending || s.action.start < pending.action.start)) pending = s
    }
    return pending ? resolveSource(model, pending.from!, time, fallbackFor(obj, attr)) : baseValue(model, obj, attr, time)
  }
  const segment = segments[index]!
  const action = segment.action
  // A path puts the object on its shape by the eased progress (D192).
  if (action.verb === 'path') return pathValue(model, obj, action, attr, time)
  // After its end, an action holds the value its easing reached (D220): the target for any usual easing, elsewhere for one that falls back, as a pulse does.
  const progress = running < 0 ? segment.ease(1) : segment.ease(Math.max(0, Math.min(1, (time - action.start) / (action.end - action.start))))
  // A change written as a function of the progress gives the value itself, the ease its envelope (D269, D277).
  if (isProgressFunction(segment.to)) {
    const natural = startOf(model, obj, attr, segments, segment, type, except)
    return progressFunctionValue(model, segment.to, action, time, natural, type)
  }
  const to = resolveSource(model, segment.to, time, fallbackFor(obj, attr))
  if (running < 0 && progress === 1) return to
  return interpolate(startOf(model, obj, attr, segments, segment, type, except), to, progress, type)
}

/** A change written as a function with a parameter, `(p) => ...`, is a function of the progress (D269); one with none is a link. */
function isProgressFunction(source: AttrSource | undefined): source is AttrSource & ((...args: unknown[]) => unknown) {
  return typeof source === 'function' && source.length >= 1
}

/** The plain progress of an action at a time, 0 to 1, and the seconds since it began, the end held after it. */
function plainProgress(action: Action, time: number): { p: number; t: number } {
  const span = action.end - action.start
  if (!begun(action.start, time) || span <= 0) return { p: 0, t: 0 }
  const t = Math.min(span, Math.max(0, time - action.start))
  return { p: t / span, t }
}

/**
 * How strongly a function of the progress applies at a plain progress (D277): the ease is its
 * envelope. Linear, or ramps of nothing, apply it in full throughout; ramps bring it in over
 * `easeIn` and out over `easeOut`, the speed the ramps give, so the thing ends as it began; a
 * named curve or a function of your own weighs it by what the curve gives.
 */
function envelopeAt(action: Action, p: number): number {
  const ease = action.timing.ease
  const span = action.end - action.start
  if (typeof ease === 'function') return Math.max(0, Math.min(1, easingFor(action.timing, span)(p)))
  if (typeof ease === 'string') {
    if (ease === 'linear' || !namedEasings[ease]) return 1
    return Math.max(0, Math.min(1, namedEasings[ease]!(p)))
  }
  if (span <= 0) return 1
  let a = Math.max(0, action.timing.easeIn ?? span * DEFAULT_EASE_FRACTION) / span
  let b = Math.max(0, action.timing.easeOut ?? span * DEFAULT_EASE_FRACTION) / span
  const sum = a + b
  if (sum > 1) {
    a /= sum
    b /= sum
  }
  if (a > 0 && p < a) return p / a
  if (b > 0 && p > 1 - b) return (1 - p) / b
  return 1
}

/** What a function of the progress gives, blended with the natural value by the envelope (D277): the function is called with the plain progress and the seconds since the action began, `(p, t)`, or with what `args` makes of those. */
function progressFunctionValue(model: SceneModel, fn: (...args: unknown[]) => unknown, action: Action, time: number, natural: AttrValue, type: AttrType, args: (p: number, t: number) => unknown[] = (p, t) => [p, t]): AttrValue {
  const { p, t } = plainProgress(action, time)
  const given = sampled<unknown>(model, time, () => fn(...args(p, t)), natural)
  const value = isAttrValue(given) ? given : natural
  const weight = envelopeAt(action, p)
  if (weight >= 1) return value
  if (weight <= 0) return natural
  return interpolate(natural, value, weight, type === 'string' || type === 'boolean' ? 'string' : type)
}

/** Where an action begins from (D258): its written start when it has one (D221), else the state the object is in when its first frame is active, worked out once per action. Actions that begin at the same moment all begin from what came before them. */
function startOf(model: SceneModel, obj: SceneObject, attr: string, segments: Segment[], segment: Segment, type: AttrType, except: readonly Action[]): AttrValue {
  if (segment.from !== undefined) return resolveSource(model, segment.from, segment.action.start, fallbackFor(obj, attr))
  const c = cacheFor(model)
  const key = `${segment.action.id}:${attr}`
  const cached = c.froms.get(key)
  if (cached !== undefined) return cached
  const value = evalAbsolute(model, obj, attr, segments, segment.action.start, type, [...except, segment.action])
  c.froms.set(key, value)
  return value
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
    .filter((a) => !a.overridden && !a.timing.relative && !a.timing.by && (a.verb === 'path' ? pathDrives(a, attr) : attr in a.changes))
    .sort(byStack)
    .map((action) => ({ action }))
  const top = topActionAt(items, time, false)
  return top?.action.verb === 'path' ? top.action : null
}

/** A point as written, or tied to the scene with `at(x, y)` (D266). */
export interface TiedPoint extends Point {
  tied?: boolean
}

function pointOf(raw: unknown): TiedPoint | null {
  if (Array.isArray(raw) && raw.length >= 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number' && Number.isFinite(raw[0]) && Number.isFinite(raw[1])) return (raw as unknown as { tied?: boolean }).tied === true ? { x: raw[0], y: raw[1], tied: true } : { x: raw[0], y: raw[1] }
  if (raw && typeof raw === 'object' && typeof (raw as Point).x === 'number' && typeof (raw as Point).y === 'number') return { x: (raw as Point).x, y: (raw as Point).y }
  return null
}

function pointsOf(raw: unknown): TiedPoint[] {
  return Array.isArray(raw) ? raw.map(pointOf).filter((p): p is TiedPoint => !!p) : []
}

/** Points with those tied to the scene brought into a Shape's own space (D266): each sits in the scene where it says, so its own place is that place taken back through the shape's pose, about the center of the shape's own points; what is not tied stays as written. */
function untied(model: SceneModel, obj: SceneObject, time: number, points: TiedPoint[], about: boolean): TiedPoint[] {
  if (!points.some((p) => p.tied)) return points
  const c = about ? pointsCenter(points) : { x: 0, y: 0 }
  return points.map((p) => {
    if (!p.tied) return p
    const own = shapeOwnFromWorld(model, obj, time, p)
    return { x: own.x + c.x, y: own.y + c.y, tied: true }
  })
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
  // Curves, SVG path data, travel as the line they draw (D246).
  if (hasPathData(raw)) {
    const points = flattenPathData(parsedPathData(raw)).flatMap((sp) => sp.points)
    return points.length > 0 ? { kind: 'points', points } : null
  }
  const points = pointsOf(raw)
  return points.length > 0 ? { kind: 'points', points } : null
}

/** A path's shape when it is written as curves, SVG path data (D246): its segments, read once per string, or null. */
export function pathCurves(action: Action): Seg[] | null {
  const raw = action.changes['shape'] as unknown
  return hasPathData(raw) ? parsedPathData(raw) : null
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
  /** For a curves path, where each point of the curve came from in its path data, so a point can be put in there (D246). */
  at?: { seg: number; t: number }[]
  /** For a curves path, the index in the curve of each anchor. */
  anchorAt?: number[]
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

/** The lines built from each curves shape, by its text. */
const curvesFrameCache = new Map<string, PathFrame>()

/** The line of a curves path (D246): its anchors, the path drawn as one polyline, each point tagged with the span of anchors it comes from and where in the path data it came from. */
function curvesFrame(d: string): PathFrame {
  const cached = curvesFrameCache.get(d)
  if (cached) return cached
  const segs = parsedPathData(d)
  const anchors = pathAnchors(segs)
  // The anchor each segment ends at; the closing segment of a loop ends at a stand-in after the last anchor, so its span is the last.
  const endAnchor = new Map<number, number>()
  anchors.forEach((a, i) => {
    endAnchor.set(a.seg, i)
    if (a.twin !== undefined) endAnchor.set(a.twin, anchors.length)
  })
  const curve: Point[] = []
  const spans: number[] = []
  const at: { seg: number; t: number }[] = []
  const anchorAt = anchors.map(() => 0)
  for (const piece of flattenPathData(segs)) {
    piece.points.forEach((p, j) => {
      const where = piece.at[j]!
      curve.push(p)
      at.push(where)
      const end = endAnchor.get(where.seg)
      spans.push(where.t === 0 ? Math.max(0, (end ?? 0) - 0) : Math.max(0, (end ?? 1) - 1))
      if (end !== undefined && end < anchors.length && (where.t === 1 || where.t === 0)) anchorAt[end] = curve.length - 1
    })
  }
  const frame: PathFrame = { ...framed(anchors.map((a) => ({ x: a.x, y: a.y })), curve, spans), at, anchorAt }
  if (curvesFrameCache.size > 256) curvesFrameCache.clear()
  curvesFrameCache.set(d, frame)
  return frame
}

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
    if (hasPathData(raw)) frame = curvesFrame(raw)
    else if (cached && cached.smooth === smooth) frame = cached.frame
    else {
      frame = smooth ? smoothCurve(shape.points) : framed(shape.points, shape.points, shape.points.map((_, i) => Math.max(0, i - 1)))
      if (key) frameCache.set(key, { smooth, frame })
    }
  }
  const shift = pathShift(action)
  if (shift.x === 0 && shift.y === 0) return frame
  const moved = (p: Point): Point => ({ x: p.x + shift.x, y: p.y + shift.y })
  return { anchors: frame.anchors.map(moved), curve: frame.curve.map(moved), spans: frame.spans, cumulative: frame.cumulative, at: frame.at, anchorAt: frame.anchorAt }
}

/** The point a fraction of the way along a frame's curve, by distance, the direction of travel there in degrees, and which piece of the curve it is on. */
function alongFrame(frame: PathFrame, fraction: number): { point: Point; angle: number; segment: number; t: number } {
  const { curve, cumulative } = frame
  if (curve.length === 1) return { point: curve[0]!, angle: 0, segment: 0, t: 0 }
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
  return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, segment: lo, t }
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
  if (frame.anchorAt) return frame.anchorAt[index] ?? 0
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

/** Where the controls of a curves path's anchors are drawn (D246): each beside its anchor on the travelled line, with the offset, what lies under the path, and the groups applied as for the anchor; empty for any other path. */
export function pathControlsWorld(model: SceneModel, obj: SceneObject, action: Action): { in: Point | null; out: Point | null }[] {
  const curves = pathCurves(action)
  const shape = pathFrame(model, action, action.start)
  if (!curves || !shape) return []
  const times = anchorTimes(action, shape)
  const shift = pathShift(action)
  return pathAnchors(curves).map((a, i) => {
    const t = times[i] ?? action.start
    const under = underPath(model, obj, action, t)
    const off = pathAnchorOffset(model, obj, t)
    const place = (p: Point | null): Point | null => {
      if (!p) return null
      const w = carried(model, obj, t, { x: under.x + p.x + shift.x, y: under.y + p.y + shift.y })
      return { x: w.x + off.x, y: w.y + off.y }
    }
    return { in: place(a.in), out: place(a.out) }
  })
}

/**
 * Where a group's path is drawn from (D247): a group's x and y are a shift of its members, so
 * its line runs from the center of their box, which is this far from where the shift alone
 * would put it. Nothing for any other object.
 */
function pathAnchorOffset(model: SceneModel, obj: SceneObject, time: number): Point {
  if (obj.className !== GROUP) return { x: 0, y: 0 }
  const box = groupBox(model, obj, time)
  if (!box) return { x: 0, y: 0 }
  const at = carried(model, obj, time, positionAt(model, obj, time))
  return { x: box.x - at.x, y: box.y - at.y }
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
    const p = carried(model, obj, t, { x: under.x + a.x, y: under.y + a.y })
    const off = pathAnchorOffset(model, obj, t)
    return { x: p.x + off.x, y: p.y + off.y }
  })
  const drawnAt = (t: number): Point => {
    const at = carried(model, obj, t, positionAt(model, obj, t))
    const off = pathAnchorOffset(model, obj, t)
    return { x: at.x + off.x, y: at.y + off.y }
  }
  if (span <= 0) {
    const only = anchors[0] ?? drawnAt(action.start)
    return { ...framed(anchors, [only], [0]), at: shape.at ? [shape.at[0] ?? { seg: 0, t: 0 }] : undefined }
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
  const at: { seg: number; t: number }[] = []
  for (const time of [...sampleTimes].sort((a, b) => a - b)) {
    curve.push(drawnAt(time))
    const { segment, t } = alongFrame(shape, progressAt(action, time))
    spans.push(shape.spans[Math.min(segment + 1, shape.spans.length - 1)] ?? 0)
    // Where in the path data each travelled point lies, for a curves path (D246).
    if (shape.at) at.push(placeBetween(shape.at[segment], shape.at[segment + 1], t) ?? shape.at[segment] ?? { seg: 0, t: 0 })
  }
  return { ...framed(anchors, curve, spans), at: shape.at ? at : undefined }
}

/**
 * Where a point of a path's shape is written for a place in the scene (D223): the place taken
 * back through the object's groups at the time the object is there, what lay under a relative
 * path then taken off, and `offset` taken off. The inverse of how the travelled line is drawn.
 */
export function rawFromWorld(model: SceneModel, obj: SceneObject, action: Action, time: number, world: Point): Point {
  const off = pathAnchorOffset(model, obj, time)
  const local = uncarried(model, obj, time, { x: world.x - off.x, y: world.y - off.y })
  const shift = pathShift(action)
  const under = underPath(model, obj, action, time)
  return { x: local.x - shift.x - under.x, y: local.y - shift.y - under.y }
}

/** A Shape's points as written, at a time (D232). Only their places against each other count: see `shapeOwnPoints`. */
export function shapePoints(model: SceneModel, obj: SceneObject, time: number): TiedPoint[] {
  return untied(model, obj, time, pointsOf(valueAt(model, obj, 'points', time)), true)
}

/** The center of the box around points, or the origin for none (D235); a point tied to the scene is not the shape's own and does not count (D266). */
export function pointsCenter(points: TiedPoint[]): Point {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const p of points) {
    if (p.tied) continue
    left = Math.min(left, p.x)
    right = Math.max(right, p.x)
    bottom = Math.min(bottom, p.y)
    top = Math.max(top, p.y)
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0 }
  return { x: (left + right) / 2, y: (bottom + top) / 2 }
}

/** Points with the center of their box at the origin: a Shape's own geometry, which its x and y place and its rotation and scale pivot on (D235). */
export function centered(points: TiedPoint[]): TiedPoint[] {
  const c = pointsCenter(points)
  return c.x === 0 && c.y === 0 ? points : points.map((p) => (p.tied ? { x: p.x - c.x, y: p.y - c.y, tied: true } : { x: p.x - c.x, y: p.y - c.y }))
}

/** A Shape's points in its own space, the center of their box at its x and y (D235): only where the points are against each other counts. */
export function shapeOwnPoints(model: SceneModel, obj: SceneObject, time: number): TiedPoint[] {
  return centered(shapePoints(model, obj, time))
}

/** Path data read once per string, with what is drawn from it, so a frame costs nothing while the string is the same (D238). */
const pathDataCache = new Map<string, { segs: Seg[]; own: Seg[]; pieces: Subpath[]; center: Point }>()

function pathDataOf(d: string): { segs: Seg[]; own: Seg[]; pieces: Subpath[]; center: Point } {
  let entry = pathDataCache.get(d)
  if (!entry) {
    if (pathDataCache.size > 256) pathDataCache.clear()
    const segs = parsePathData(d)
    const center = boundsOf(flattenPathData(segs).flatMap((sp) => sp.points))
    // Only where the path lies against itself counts (D235): it is drawn with the center of its box at the origin.
    const own = translatePathData(segs, -center.x, -center.y)
    entry = { segs, own, pieces: flattenPathData(own), center: { x: center.x, y: center.y } }
    pathDataCache.set(d, entry)
  }
  return entry
}

/** Path data read once per string: the segments as written. */
export function parsedPathData(d: string): Seg[] {
  return pathDataOf(d).segs
}

/** A Shape's `curves` when it holds a path: SVG path data, the full form, drawn instead of the points (D238, D244). */
export function shapeCurves(model: SceneModel, obj: SceneObject, time: number): string | null {
  const d = valueAt(model, obj, 'curves', time)
  return hasPathData(d) ? d : null
}

/** A Shape's path in its own space, the center of its box at the origin (D235, D238), or null when it draws its points. */
export function shapeOwnSegs(model: SceneModel, obj: SceneObject, time: number): Seg[] | null {
  const d = shapeCurves(model, obj, time)
  return d === null ? null : pathDataOf(d).own
}

/** The anchors of a Shape's path in its own space, each with its controls, or none for a points shape (D240). */
export function shapeOwnAnchors(model: SceneModel, obj: SceneObject, time: number): Anchor[] {
  const own = shapeOwnSegs(model, obj, time)
  return own ? pathAnchors(own) : []
}

/** One piece of the line a Shape is drawn with: a polyline, a closed one ending at its start again; filled or not; and, from a path, where each point came from, so a point can be put in on it (D238). */
export interface ShapePiece {
  curve: Point[]
  closed: boolean
  filled: boolean
  at?: { seg: number; t: number }[]
}

/** The pieces a Shape is drawn with, in its own space (D238): its path's subpaths, each filled as SVG fills them, or its points as one piece, filled when closed (D232); with morphs, the outline they have taken it to by this time (D257). */
export function shapePieces(model: SceneModel, obj: SceneObject, time: number): ShapePiece[] {
  const morphs = morphActions(obj)
  if (morphs.length === 0) return shapeOwnPieces(model, obj, time)
  const segs = morphedSegs(model, obj, time, morphs, NONE)
  return segs ? piecesOfSegs(segs) : []
}

/** The pieces of a Shape's own outline, its curves or its points, with no morph applied. */
export function shapeOwnPieces(model: SceneModel, obj: SceneObject, time: number): ShapePiece[] {
  const d = shapeCurves(model, obj, time)
  if (d !== null) return pathDataOf(d).pieces.map((sp) => ({ curve: sp.points, closed: sp.closed, filled: sp.points.length >= 3, at: sp.at }))
  const frame = shapeFrame(model, obj, time)
  return frame.curve.length > 0 ? [{ curve: frame.curve, closed: frame.closed, filled: frame.closed && frame.curve.length >= 4 }] : []
}

/** A Shape's morphs, in stack order (D257). */
function morphActions(obj: SceneObject): Action[] {
  return obj.actions.filter((a) => a.verb === 'morph' && !a.overridden).sort(byStack)
}

const targetPointsSegs = new WeakMap<object, Seg[]>()

/** The target of a morph as path data, where it is written about the shape's x and y (D257): curves as they are, points as a closed polygon; null when the target draws nothing. */
export function morphTargetSegs(model: SceneModel, action: Action, time: number): Seg[] | null {
  const raw = action.changes['to']
  const value = raw === undefined ? undefined : resolveSource(model, raw, time, '')
  if (hasPathData(value)) return parsedPathData(value)
  if (typeof value !== 'object' || value === null) return null
  const points = pointsOf(value)
  // A target's point tied to the scene sits where it says, taken back through the shape's pose; such a target is read afresh, since the pose moves (D266).
  if (points.some((p) => p.tied)) return points.length < 2 ? null : polygonPathData(untied(model, action.object, time, points, false), true)
  let segs = targetPointsSegs.get(value)
  if (!segs) {
    if (points.length < 2) return null
    segs = polygonPathData(points, true)
    targetPointsSegs.set(value, segs)
  }
  return segs
}

const pointsSegsCache = new WeakMap<object, { closed: boolean; smooth: boolean; segs: Seg[] }>()

/** A Shape's own outline as path data in its own space (D257): its curves as drawn, or its points as lines or as their smooth curve; null for none. */
export function shapeOutlineSegs(model: SceneModel, obj: SceneObject, time: number): Seg[] | null {
  const own = shapeOwnSegs(model, obj, time)
  if (own) return own
  const raw = valueAt(model, obj, 'points', time)
  const key = typeof raw === 'object' && raw !== null ? raw : null
  const closed = valueAt(model, obj, 'closed', time) !== false
  const smooth = valueAt(model, obj, 'smooth', time) === true
  const cached = key ? pointsSegsCache.get(key) : undefined
  if (cached && cached.closed === closed && cached.smooth === smooth) return cached.segs
  const points = shapeOwnPoints(model, obj, time)
  if (points.length < 2) return null
  const segs = smooth && points.length >= 3 ? smoothPathData(points, closed) : polygonPathData(points, closed)
  // A point tied to the scene moves with the pose, so such a list is read afresh each time (D266).
  if (key && !points.some((p) => p.tied)) pointsSegsCache.set(key, { closed, smooth, segs })
  return segs
}

const NONE: ReadonlySet<Action> = new Set()

/** Which morph, among those not left out, has a say at a time: the one running, through its last frame (D263), the top of the stack among those, else the last to end; -1 before any. With `strictStart`, one at its very start is left out, for edits that set the start state (D102 note). */
function morphAt(morphs: Action[], time: number, except: ReadonlySet<Action>, strictStart = false): { index: number; running: boolean } {
  let running = -1
  let ended = -1
  for (let i = 0; i < morphs.length; i++) {
    const a = morphs[i]!
    if (except.has(a)) continue
    if (strictStart ? a.start >= time - TIME_TOLERANCE : !begun(a.start, time)) continue
    if (!over(a.end, time) && a.end > a.start) running = i
    else if (ended < 0 || a.end >= morphs[ended]!.end) ended = i
  }
  return running >= 0 ? { index: running, running: true } : { index: ended, running: false }
}

/** The morph that has a say over a Shape's outline at a time (D257), whose target the Shape tool then edits; null before any, and at the very start of the first, where the shape's own outline is what shows. */
export function morphInForce(obj: SceneObject, time: number): Action | null {
  const morphs = morphActions(obj)
  const { index } = morphAt(morphs, time, NONE, true)
  return index >= 0 ? morphs[index]! : null
}

/** The morph that has the say at a time while strictly inside its span, if that is what has the say (D263): an edit then writes a morph from its start to the playhead rather than its target. */
export function morphRunning(obj: SceneObject, time: number): Action | null {
  const morph = morphInForce(obj, time)
  return morph && morph.start < time && time < morph.end ? morph : null
}

/**
 * The outline of a morphing Shape at a time, the morphs in `except` left out (D257): the one
 * running has its say, else the last to end holds its target; before any, the shape's own; a
 * target that draws nothing leaves its morph out. A morph begins from the outline the other
 * morphs leave at its start, whenever they are written, so a chain reads in time order and
 * nothing is remembered from when a morph was put down. The blend keeps every anchor and
 * control, so the morph lands on the target exactly.
 */
function morphedSegs(model: SceneModel, obj: SceneObject, time: number, morphs: Action[], except: ReadonlySet<Action>): Seg[] | null {
  const { index, running } = morphAt(morphs, time, except)
  if (index < 0) return shapeOutlineSegs(model, obj, time)
  const action = morphs[index]!
  const without = new Set(except).add(action)
  const target = morphTargetSegs(model, action, time)
  if (!target) return morphedSegs(model, obj, time, morphs, without)
  const ease = easingFor(action.timing, action.end - action.start)
  const progress = running ? ease((time - action.start) / (action.end - action.start)) : ease(1)
  if (progress === 1) return target
  const from = morphedSegs(model, obj, action.start, morphs, without)
  if (!from) return target
  if (progress === 0) return from
  const c = cacheFor(model)
  let entry = c.morphs.get(action.id)
  if (!entry || entry.from !== from || entry.to !== target) {
    entry = { from, to: target, pairs: morphPairs(from, target) }
    c.morphs.set(action.id, entry)
  }
  return blendMorph(entry.pairs, progress)
}

/** A Shape's outline as path data at a time, in its own space (D257): its own, or what its morphs have made of it by then, which the Shape tool shows; null for a shape that draws nothing. */
export function shapeSegsAt(model: SceneModel, obj: SceneObject, time: number): Seg[] | null {
  const morphs = morphActions(obj)
  return morphs.length > 0 ? morphedSegs(model, obj, time, morphs, NONE) : shapeOutlineSegs(model, obj, time)
}

const piecesCache = new WeakMap<Seg[], ShapePiece[]>()

/** The pieces path data draws, each point with where it came from; kept per path, so an outline or a target costs nothing twice. */
function piecesOfSegs(segs: Seg[]): ShapePiece[] {
  let pieces = piecesCache.get(segs)
  if (!pieces) {
    pieces = flattenPathData(segs).map((sp) => ({ curve: sp.points, closed: sp.closed, filled: sp.points.length >= 3, at: sp.at }))
    piecesCache.set(segs, pieces)
  }
  return pieces
}

/** Every point of the line a Shape is drawn with, in its own space, for its box and its hull. */
export function shapeCurve(model: SceneModel, obj: SceneObject, time: number): Point[] {
  return shapePieces(model, obj, time).flatMap((p) => p.curve)
}

/** Every point of the line a Shape is drawn with, where it is drawn (D232). */
export function shapeWorldCurve(model: SceneModel, obj: SceneObject, time: number): Point[] {
  return shapeCurve(model, obj, time).map((p) => ownToWorld(model, obj, time, p))
}

/** A closed smooth curve through points: the centripetal Catmull-Rom spline round and back to the first point (D232). */
function closedSmoothCurve(anchors: Point[]): PathFrame {
  const n = anchors.length
  if (n < 3) return framed(anchors, n > 0 ? [...anchors, anchors[0]!] : anchors, anchors.map((_, i) => i))
  const curve: Point[] = [anchors[0]!]
  const spans: number[] = [0]
  const at = (i: number): Point => anchors[((i % n) + n) % n]!
  const knot = (a: Point, b: Point): number => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
  const mix = (a: Point, b: Point, w: number): Point => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w })
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let s = 1; s <= SPAN_STEPS; s++) {
      const t = t1 + ((t2 - t1) * s) / SPAN_STEPS
      const a1 = mix(p0, p1, t / t1)
      const a2 = mix(p1, p2, (t - t1) / (t2 - t1))
      const a3 = mix(p2, p3, (t - t2) / (t3 - t2))
      const b1 = mix(a1, a2, t / t2)
      const b2 = mix(a2, a3, (t - t1) / (t3 - t1))
      curve.push(mix(b1, b2, (t - t1) / (t2 - t1)))
      spans.push(i)
    }
  }
  return framed(anchors, curve, spans)
}

/** The lines built from each list of points, which stays the same object for as long as the model does. */
const shapeFrameCache = new WeakMap<object, { closed: boolean; smooth: boolean; frame: PathFrame }>()

/**
 * The line a Shape is drawn with, in its own space (D232): its points, straight or smooth, open
 * or closed, each point of the line tagged with the span of points it comes from, as a path's
 * line is, so the preview edits by point.
 */
export function shapeFrame(model: SceneModel, obj: SceneObject, time: number): PathFrame & { closed: boolean } {
  const raw = valueAt(model, obj, 'points', time)
  // The points as written, placed with the center of their box at the origin (D235).
  const anchors = centered(pointsOf(raw))
  const closed = valueAt(model, obj, 'closed', time) !== false
  const smooth = valueAt(model, obj, 'smooth', time) === true
  const key = typeof raw === 'object' && raw !== null ? raw : null
  const cached = key ? shapeFrameCache.get(key) : undefined
  if (cached && cached.closed === closed && cached.smooth === smooth) return { ...cached.frame, closed }
  let frame: PathFrame
  if (smooth && anchors.length >= 3) frame = closed ? closedSmoothCurve(anchors) : smoothCurve(anchors)
  else {
    const curve = closed && anchors.length >= 3 ? [...anchors, anchors[0]!] : anchors
    frame = framed(anchors, curve, curve.map((_, i) => Math.max(0, i - 1)))
  }
  if (key) shapeFrameCache.set(key, { closed, smooth, frame })
  return { ...frame, closed }
}

/** A point of an object's own space where it is drawn: turned and scaled about the object's x and y as its own values say, then carried through its groups (D232). */
function ownToWorld(model: SceneModel, obj: SceneObject, time: number, p: Point): Point {
  const pose = ownPose(model, obj, time)
  const a = (pose.rotation * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return carried(model, obj, time, { x: pose.x + pose.scale * (c * p.x - s * p.y), y: pose.y + pose.scale * (s * p.x + c * p.y) })
}

/** Where a Shape's points are drawn (D233). */
export function shapeWorldPoints(model: SceneModel, obj: SceneObject, time: number): Point[] {
  return shapeOwnPoints(model, obj, time).map((p) => ownToWorld(model, obj, time, p))
}

/** Where a point of a Shape's own space is drawn (D235). */
export function shapeWorldOf(model: SceneModel, obj: SceneObject, time: number, own: Point): Point {
  return ownToWorld(model, obj, time, own)
}

/** The line a Shape is drawn with, where it is drawn, with its points and spans (D233). */
export function shapeWorldFrame(model: SceneModel, obj: SceneObject, time: number): PathFrame & { closed: boolean } {
  const f = shapeFrame(model, obj, time)
  return { anchors: f.anchors.map((p) => ownToWorld(model, obj, time, p)), curve: f.curve.map((p) => ownToWorld(model, obj, time, p)), spans: f.spans, cumulative: f.cumulative, closed: f.closed }
}

/** A drawn place taken back into a Shape's own space: the inverse of where its points are drawn (D233). */
export function shapeOwnFromWorld(model: SceneModel, obj: SceneObject, time: number, world: Point): Point {
  const local = uncarried(model, obj, time, world)
  const pose = ownPose(model, obj, time)
  const a = (pose.rotation * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = local.x - pose.x
  const dy = local.y - pose.y
  const k = pose.scale === 0 ? 1 : pose.scale
  return { x: (c * dx + s * dy) / k, y: (-s * dx + c * dy) / k }
}

/**
 * The box around what an object draws, in its own space (D232): a Shape's line with its stroke,
 * its center offset from the object's x and y; any other kind centered on them, by its size.
 */
export function ownBounds(model: SceneModel, obj: SceneObject, time: number): { x: number; y: number; width: number; height: number } {
  if (obj.className === SHAPE) {
    const curve = shapeCurve(model, obj, time)
    if (curve.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
    const b = boundsOf(curve)
    const stroke = Math.max(0, numValue(valueAt(model, obj, 'strokeWidth', time)))
    return { x: b.x, y: b.y, width: b.width + stroke, height: b.height + stroke }
  }
  return { x: 0, y: 0, ...ownSize(model, obj, time) }
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

/**
 * What one action alone makes of an attribute at a time (D264): where its own course is then, an
 * absolute one between where it begins and what it writes, a relative one its change so far; what
 * the sampler shows when the action has the say, whatever else is stacked over it.
 */
export function actionCourse(model: SceneModel, obj: SceneObject, action: Action, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  if (action.verb === 'path') return pathValue(model, obj, action, attr, time)
  const { absolute, relative } = segmentsFor(model, obj, attr)
  const segment = [...absolute, ...relative].find((s) => s.action === action)
  if (!segment) return fallbackFor(obj, attr)
  const progress = progressAt(action, time)
  const to = resolveSource(model, segment.to, time, fallbackFor(obj, attr))
  if (relative.includes(segment)) {
    const from = segment.from !== undefined ? resolveSource(model, segment.from, time, 0) : 0
    return typeof to === 'number' && typeof from === 'number' ? from + (to - from) * progress : 0
  }
  return interpolate(startOf(model, obj, attr, absolute, segment, schema.type, NO_ACTIONS), to, progress, schema.type)
}

/** Where a path is cut at a progress (D264): the place along its line, by distance, as the piece of the line it falls in and how far along that, and for a curves path where that is in its path data. With `curves`, the line those draw is cut instead of the path's own. */
export function pathCutAt(model: SceneModel, action: Action, progress: number, time: number, curves?: Seg[]): { point: Point; segment: number; t: number; at: { seg: number; t: number } | null } | null {
  const frame = curves ? curvesFrame(serializePathData(curves)) : pathFrame(model, action, time)
  if (!frame || frame.curve.length < 2) return null
  const { point, segment, t } = alongFrame(frame, progress)
  const at = frame.at ? placeBetween(frame.at[segment], frame.at[segment + 1], t) : null
  return { point, segment, t, at }
}

/** Eased progress of an action at a time: 0 before it starts, and once it has ended, what its easing reaches at 1, which is 1 for any usual easing (D220). */
export function progressAt(action: Action, time: number): number {
  if (!begun(action.start, time)) return 0
  const ease = easingFor(action.timing, action.end - action.start)
  if (time >= action.end - TIME_TOLERANCE || action.end <= action.start) return ease(1)
  return ease((time - action.start) / (action.end - action.start))
}

/** What the absolute actions alone give an attribute at a time, before any relative change is added: where a new absolute action must begin for the object to stay put (D210, D225). */
export function absoluteAt(model: SceneModel, obj: SceneObject, attr: string, time: number): number {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const { absolute } = segmentsFor(model, obj, attr)
  return numValue(evalAbsolute(model, obj, attr, absolute, time, schema.type))
}

/** The value of an attribute at a time, with every action and link applied: the latest absolute action, then every relative change on top (D53). */
export function valueAt(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const { absolute, relative } = segmentsFor(model, obj, attr)
  let value = evalAbsolute(model, obj, attr, absolute, time, schema.type)
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
      // A relative change written as a function of the progress adds what it gives, by its envelope (D269, D277).
      if (isProgressFunction(segment.to)) {
        const given = progressFunctionValue(model, segment.to, segment.action, time, 0, 'number')
        if (typeof given === 'number') sum += given
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

/** The drawn size of an object as its own values give it, before its scale: a Text's block with the padding it is drawn with (D267). */
function ownSize(model: SceneModel, obj: SceneObject, time: number): { width: number; height: number } {
  if (obj.className === 'Text') {
    const layout = layoutOf(textStyleAt(model, obj, time))
    const pad = textPadding(layout.style)
    return { width: layout.width + 2 * pad, height: layout.height + 2 * pad }
  }
  return { width: numValue(valueAt(model, obj, 'width', time)), height: numValue(valueAt(model, obj, 'height', time)) }
}

/** The room a Text is drawn with around its block, in world pixels, so nothing is clipped. */
export function textPadding(style: TextStyle): number {
  return style.fontSize * 0.1
}

/** How a Text is set at a time (D267): its words and every attribute of its look. */
export function textStyleAt(model: SceneModel, obj: SceneObject, time: number): TextStyle {
  const str = (attr: string): string => String(valueAt(model, obj, attr, time))
  const align = str('align')
  return {
    text: str('text'),
    fontSize: Math.max(1, numValue(valueAt(model, obj, 'fontSize', time))),
    font: str('font'),
    weight: numValue(valueAt(model, obj, 'weight', time)) || 400,
    italic: valueAt(model, obj, 'italic', time) === true,
    align: align === 'left' || align === 'right' ? align : 'center',
    lineHeight: numValue(valueAt(model, obj, 'lineHeight', time)) || 1.2,
    letterSpacing: numValue(valueAt(model, obj, 'letterSpacing', time)),
  }
}

/** The actions of a Text that run on its units, by kind (D268). */
function unitActions(obj: SceneObject): Action[] {
  return obj.actions.filter((a) => !a.overridden && a.timing.by !== undefined).sort(byStack)
}

const UNIT_ATTRS = ['x', 'y', 'rotation', 'scale', 'opacity', 'fill', 'text'] as const
type UnitAttr = (typeof UNIT_ATTRS)[number]

/** One action's run on one unit: when the unit's turn begins and ends, and the action's ease over its turn. */
interface UnitRun {
  action: Action
  kind: UnitKind
  unit: number
  begins: number
  ends: number
  duration: number
  ease: Easing
}

/** The type an attribute of a unit interpolates as. */
function unitAttrType(attr: UnitAttr): AttrType {
  return attr === 'fill' ? 'color' : attr === 'text' ? 'string' : 'number'
}

/**
 * What a Text's units have been made into at a time, one state per character (D268, D269):
 * null while no action by character, word, or line touches any, so the text is drawn whole.
 * For each character and each of `x`, `y`, `rotation`, `scale`, `opacity`, `fill`, and `text`,
 * the actions on it, those by character on the character and those by word or line on its word
 * or line, stack as an object's actions do: each unit runs its turn `stagger` after the one
 * before, the latest begun has the say, and it begins from its own natural state, no offset,
 * full size, solid, the text's fill, its own text, or from what the earlier ones left; before
 * any begins, the first's range start holds, as a range's start holds on an object (D221).
 * A change written as a function of the progress is called with the unit's progress, its index,
 * and its own text, and what it returns is the value; a `path` by unit is the shape as changes
 * from the unit's place, `orient` turning it.
 */
export function textUnitStates(model: SceneModel, obj: SceneObject, time: number, layout: TextLayout): UnitState[] | null {
  const actions = unitActions(obj)
  if (actions.length === 0) return null
  const timed = actions.map((action) => {
    const kind = action.timing.by!
    const count = layout.units[kind].length
    const begins = unitBegins(action.timing.stagger, count).map((b) => action.start + b)
    const last = count > 0 ? begins[count - 1]! - action.start : 0
    const duration = Math.max(0, action.end - action.start - last)
    return { action, kind, begins, duration, ease: easingFor(action.timing, duration) }
  })
  const states: UnitState[] = layout.units.char.map(() => ({ dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1, fill: null, text: null }))
  const fill = String(valueAt(model, obj, 'fill', time))
  let any = false
  layout.units.char.forEach((char, i) => {
    const runs: UnitRun[] = []
    for (const t of timed) {
      const unit = t.kind === 'char' ? i : t.kind === 'word' ? char.word : char.line
      const begins = t.begins[unit]
      if (begins === undefined) continue
      runs.push({ action: t.action, kind: t.kind, unit, begins, ends: begins + t.duration, duration: t.duration, ease: t.ease })
    }
    runs.sort((a, b) => a.begins - b.begins || a.action.id - b.action.id)
    for (const attr of UNIT_ATTRS) {
      const list = runs.filter((r) => attr in r.action.changes || (r.action.verb === 'path' && (attr === 'x' || attr === 'y' || (attr === 'rotation' && r.action.changes['orient'] === true))))
      if (list.length === 0) continue
      const natural: AttrValue = attr === 'fill' ? fill : attr === 'text' ? char.text : attr === 'scale' || attr === 'opacity' ? 1 : 0
      const value = unitValue(model, layout, attr, list, time, natural, NO_ACTIONS)
      if (value === null) continue
      any = true
      const s = states[i]!
      if (attr === 'x') s.dx = numValue(value)
      else if (attr === 'y') s.dy = numValue(value)
      else if (attr === 'rotation') s.rotation = numValue(value)
      else if (attr === 'scale') s.scale = numValue(value)
      else if (attr === 'opacity') s.opacity = numValue(value)
      else if (attr === 'fill') s.fill = typeof value === 'string' ? value : null
      else s.text = typeof value === 'string' ? value : null
    }
  })
  return any ? states : null
}

/** The value of one attribute of one unit at a time, from the runs on it, those in `except` left out (D269): null for its natural state. */
function unitValue(model: SceneModel, layout: TextLayout, attr: UnitAttr, list: UnitRun[], time: number, natural: AttrValue, except: readonly Action[]): AttrValue | null {
  let running = -1
  let ended = -1
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!
    if (!begun(r.begins, time) || except.includes(r.action)) continue
    if (!over(r.ends, time) && r.ends > r.begins) running = i
    else if (ended < 0 || r.ends >= list[ended]!.ends) ended = i
  }
  const index = running >= 0 ? running : ended
  if (index < 0) {
    // Nothing has begun: the first turn given a start of its own holds it (D221).
    const pending = list.find((r) => !except.includes(r.action) && r.action.from[attr] !== undefined)
    return pending ? resolveSource(model, pending.action.from[attr]!, time, natural) : null
  }
  const r = list[index]!
  const progress = running < 0 || r.duration <= 0 ? r.ease(1) : r.ease(Math.max(0, Math.min(1, (time - r.begins) / r.duration)))
  const own = layout.units[r.kind][r.unit]
  if (r.action.verb === 'path') {
    // The path's shape as changes from the unit's place: where it is at the progress, less where it starts.
    const at = pathPointAt(model, r.action, progress, time)
    const origin = pathPointAt(model, r.action, 0, time)
    if (!at || !origin) return null
    return attr === 'x' ? at.point.x - origin.point.x : attr === 'y' ? at.point.y - origin.point.y : at.angle
  }
  const raw = r.action.changes[attr]
  const from = r.action.from[attr] !== undefined ? resolveSource(model, r.action.from[attr]!, time, natural) : (unitValue(model, layout, attr, list, r.begins, natural, [...except, r.action]) ?? natural)
  if (isProgressFunction(raw)) {
    // The unit's turn as an action of its own: the function gets the plain progress of the turn, the unit's index, its own text, the seconds since its turn began, and how many units there are (D277).
    const turn: Action = { ...r.action, start: r.begins, end: r.ends }
    return progressFunctionValue(model, raw, turn, time, from, unitAttrType(attr), (p, t) => [p, r.unit, own?.text ?? '', t, layout.units[r.kind].length])
  }
  const to = resolveSource(model, raw as AttrSource, time, natural)
  return interpolate(from, to, progress, unitAttrType(attr))
}

/**
 * How much of an object shows at a time (D269): its opacity, and for a Text whose units are
 * animated, times the share of its characters that show, so the timeline's opacity lane tells
 * what is seen.
 */
export function visibleShareAt(model: SceneModel, obj: SceneObject, time: number): number {
  const opacity = opacityAt(model, obj, time)
  if (obj.className !== 'Text' || opacity <= 0 || unitActions(obj).length === 0) return opacity
  const layout = layoutOf(textStyleAt(model, obj, time))
  const states = textUnitStates(model, obj, time, layout)
  if (!states || states.length === 0) return opacity
  const mean = states.reduce((sum, s) => sum + Math.max(0, Math.min(1, s.opacity)), 0) / states.length
  return opacity * mean
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
  // The shift is the group's x and y as any object's are found, moves, ranges, and paths alike (D124, D247).
  const shift = positionAt(model, group, time)
  const actions = groupActions(group)
  for (let k = 0; k < actions.length; k++) {
    const action = actions[k]!
    if (action.start > time) break
    const pivot = 'rotation' in action.changes || 'scale' in action.changes ? pivotOf(model, group, action) : null
    if (pivot && 'rotation' in action.changes) motion = turnedAbout(motion, pivot, changeOf(model, group, actions, k, 'rotation', time))
    if (pivot && 'scale' in action.changes) motion = scaledAbout(motion, pivot, factorOf(model, group, actions, k, time))
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
      // What the member draws may sit off its x and y: a Shape's points do (D232).
      const b = ownBounds(model, member, time)
      const ra = (own.rotation * Math.PI) / 180
      frame = { x: own.x + own.scale * (Math.cos(ra) * b.x - Math.sin(ra) * b.y), y: own.y + own.scale * (Math.sin(ra) * b.x + Math.cos(ra) * b.y), rotation: own.rotation, width: b.width * own.scale, height: b.height * own.scale }
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
    .filter((a) => !a.overridden && attr in a.changes && !a.timing.by)
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
  // The frame an object begins on is its, however its time was rounded when written; the frame it is removed on is not (D275).
  if (!begun(obj.at, time)) return false
  return obj.until === null || time < obj.until - TIME_TOLERANCE || (model.contentEnd !== null && obj.until >= model.contentEnd)
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
  if (type === 'points' && Array.isArray(from) && Array.isArray(to)) return morphPoints(from, to, p)
  return p < 1 ? from : to
}

/** Points along a closed line of points, `n` of them evenly by distance, from the first point round. */
function resampled(points: Point[], n: number): Point[] {
  const loop = [...points, points[0]!]
  const cumulative = [0]
  for (let i = 1; i < loop.length; i++) cumulative.push(cumulative[i - 1]! + Math.hypot(loop[i]!.x - loop[i - 1]!.x, loop[i]!.y - loop[i - 1]!.y))
  const total = cumulative[cumulative.length - 1]!
  if (total <= 0) return Array.from({ length: n }, () => points[0]!)
  const out: Point[] = []
  let k = 0
  for (let i = 0; i < n; i++) {
    const target = (total * i) / n
    while (k < cumulative.length - 2 && cumulative[k + 1]! < target) k++
    const a = loop[k]!
    const b = loop[k + 1]!
    const length = cumulative[k + 1]! - cumulative[k]!
    const t = length > 1e-9 ? (target - cumulative[k]!) / length : 0
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

/** Two lists of points blended (D232): each resampled along its length to one count, then each point taken straight across. */
function morphPoints(from: number[][], to: number[][], p: number): number[][] {
  if (p <= 0) return from
  if (p >= 1) return to
  const a = pointsOf(from)
  const b = pointsOf(to)
  if (a.length === 0 || b.length === 0) return p < 1 ? from : to
  const n = Math.max(a.length, b.length, 24)
  const ra = resampled(a, n)
  const rb = resampled(b, n)
  return ra.map((q, i) => [q.x + (rb[i]!.x - q.x) * p, q.y + (rb[i]!.y - q.y) * p])
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
