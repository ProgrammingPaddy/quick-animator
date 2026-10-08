import { attrSchema, defaultFor, type AttrType, type AttrValue } from './registry'
import { easingFor, type Easing } from './easing'
import type { Action, AttrSource, SceneModel, SceneObject } from './types'

/**
 * While a sample is in progress, attribute reads on object handles (inside link functions)
 * return the value at this time instead of the base value.
 */
export const samplingContext: { model: SceneModel | null; time: number; depth: number } = { model: null, time: 0, depth: 0 }

interface Segment {
  action: Action
  to: AttrSource
  ease: Easing
}

/**
 * The actions that change one attribute, in start order. Absolute ones take over from their
 * start; relative ones add their change on top of everything else (decision D53).
 */
interface Segments {
  absolute: Segment[]
  relative: Segment[]
}

export interface Point {
  x: number
  y: number
}

interface Cache {
  segments: Map<string, Segments>
  /** The actions that move an object, in order. */
  movers: Map<number, Action[]>
  /** The position after the first k movers at the k-th mover's start, by `${object}:${k}`. */
  starts: Map<string, Point>
}

const cache = new WeakMap<SceneModel, Cache>()

function cacheFor(model: SceneModel): Cache {
  let c = cache.get(model)
  if (!c) {
    c = { segments: new Map(), movers: new Map(), starts: new Map() }
    cache.set(model, c)
  }
  return c
}

/** True when an action changes an attribute: it names it, or it is an orbit, which moves x and y along an arc and turns the rotation (D118). */
function touches(action: Action, attr: string): boolean {
  if (attr in action.changes) return true
  return action.verb === 'orbit' && (attr === 'x' || attr === 'y' || attr === 'rotation')
}

function byStart(a: Action, b: Action): number {
  return a.start - b.start || a.id - b.id
}

function segmentsFor(model: SceneModel, obj: SceneObject, attr: string): Segments {
  const c = cacheFor(model)
  const key = `${obj.id}:${attr}`
  let segments = c.segments.get(key)
  if (!segments) {
    const type = attrSchema(obj.className, attr)?.type
    segments = { absolute: [], relative: [] }
    const sorted = obj.actions.filter((a) => touches(a, attr) && !a.overridden).sort(byStart)
    for (const action of sorted) {
      const orbit = action.verb === 'orbit'
      // An orbit's turn adds to the rotation like a relative change (D118).
      const segment: Segment = { action, to: orbit ? (action.changes['angle'] ?? 0) : action.changes[attr]!, ease: easingFor(action.timing, action.end - action.start) }
      if (orbit || (action.timing.relative && type === 'number')) segments.relative.push(segment)
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
function resolveSource(model: SceneModel, source: AttrSource, time: number, fallback: AttrValue): AttrValue {
  if (typeof source !== 'function') return source
  if (samplingContext.depth > 8) return fallback
  const previous = { model: samplingContext.model, time: samplingContext.time }
  samplingContext.model = model
  samplingContext.time = time
  samplingContext.depth++
  try {
    const value = source()
    return isAttrValue(value) ? value : fallback
  } catch {
    return fallback
  } finally {
    samplingContext.depth--
    samplingContext.model = previous.model
    samplingContext.time = previous.time
  }
}

function num(model: SceneModel, source: AttrSource | undefined, time: number): number {
  const v = resolveSource(model, source ?? 0, time, 0)
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

function evalAbsolute(model: SceneModel, obj: SceneObject, attr: string, segments: Segment[], count: number, time: number, type: AttrType): AttrValue {
  // The latest segment that has started wins; earlier ones only supply its starting value.
  let index = -1
  for (let i = 0; i < count; i++) {
    if (segments[i]!.action.start <= time) index = i
    else break
  }
  if (index < 0) return baseValue(model, obj, attr, time)
  const segment = segments[index]!
  const action = segment.action
  const to = resolveSource(model, segment.to, time, fallbackFor(obj, attr))
  if (time >= action.end || action.end <= action.start) return to
  const from = evalAbsolute(model, obj, attr, segments, index, action.start, type)
  return interpolate(from, to, segment.ease((time - action.start) / (action.end - action.start)), type)
}

/** Eased progress of an action at a time: 0 before it starts, 1 once it has ended. */
export function progressAt(action: Action, time: number): number {
  if (time <= action.start) return 0
  if (time >= action.end || action.end <= action.start) return 1
  return easingFor(action.timing, action.end - action.start)((time - action.start) / (action.end - action.start))
}

/**
 * The position is one thing, x and y together (D118). Absolute moves and orbits build it in
 * action order: an absolute move takes over from where the position was when it started, and an
 * orbit turns the position built so far around its center, which sits `dx, dy` from the position
 * at the orbit's start. Relative moves add their change on top of all of that, in any order, as
 * relative changes do for every attribute (D53). So turns about one point add up to one turn, a
 * move before an orbit carries its center along, and a turn and a relative move at the same time
 * make one combined motion, the center moving while the object turns around it, whichever came first.
 */
function movers(model: SceneModel, obj: SceneObject): Action[] {
  const c = cacheFor(model)
  let list = c.movers.get(obj.id)
  if (!list) {
    list = obj.actions.filter((a) => !a.overridden && (touches(a, 'x') || touches(a, 'y'))).sort(byStart)
    c.movers.set(obj.id, list)
  }
  return list
}

function basePosition(model: SceneModel, obj: SceneObject, time: number): Point {
  const x = baseValue(model, obj, 'x', time)
  const y = baseValue(model, obj, 'y', time)
  return { x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0 }
}

/** The position built by the absolute moves and orbits among the first `count` movers, at a time. */
function placed(model: SceneModel, obj: SceneObject, list: Action[], count: number, time: number): Point {
  let pos = basePosition(model, obj, time)
  for (let i = 0; i < count; i++) {
    const action = list[i]!
    if (action.start > time) break
    if (action.verb !== 'orbit' && action.timing.relative) continue
    const p = progressAt(action, time)
    if (action.verb === 'orbit') pos = turn(pos, orbitCenter(model, obj, list, i), num(model, action.changes['angle'], time) * p)
    else {
      const from = placedAtStart(model, obj, list, i)
      if ('x' in action.changes) pos = { x: from.x + (num(model, action.changes['x'], time) - from.x) * p, y: pos.y }
      if ('y' in action.changes) pos = { x: pos.x, y: from.y + (num(model, action.changes['y'], time) - from.y) * p }
    }
  }
  return pos
}

/** What the i-th mover starts from: the position the movers before it had built at its start. Memoised per model. */
function placedAtStart(model: SceneModel, obj: SceneObject, list: Action[], i: number): Point {
  const c = cacheFor(model)
  const key = `${obj.id}:${i}`
  let point = c.starts.get(key)
  if (!point) {
    point = placed(model, obj, list, i, list[i]!.start)
    c.starts.set(key, point)
  }
  return point
}

function orbitCenter(model: SceneModel, obj: SceneObject, list: Action[], i: number): Point {
  const action = list[i]!
  const from = placedAtStart(model, obj, list, i)
  return { x: from.x + num(model, action.changes['dx'], action.start), y: from.y + num(model, action.changes['dy'], action.start) }
}

function turn(pos: Point, center: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180
  const rx = pos.x - center.x
  const ry = pos.y - center.y
  return { x: center.x + rx * Math.cos(a) - ry * Math.sin(a), y: center.y + rx * Math.sin(a) + ry * Math.cos(a) }
}

/** What relative moves add on top of everything, in any order (D53). */
function shift(model: SceneModel, obj: SceneObject, list: Action[], time: number): Point {
  let x = 0
  let y = 0
  for (const action of list) {
    if (action.start > time) break
    if (action.verb === 'orbit' || !action.timing.relative) continue
    const p = progressAt(action, time)
    if ('x' in action.changes) x += num(model, action.changes['x'], time) * p
    if ('y' in action.changes) y += num(model, action.changes['y'], time) * p
  }
  return { x, y }
}

/** Where the object is at a time, x and y together. */
export function positionAt(model: SceneModel, obj: SceneObject, time: number): Point {
  const list = movers(model, obj)
  const q = placed(model, obj, list, list.length, time)
  const s = shift(model, obj, list, time)
  return { x: q.x + s.x, y: q.y + s.y }
}

/** How far an orbit has turned at a time, in degrees; zero for anything else. */
export function turnOf(model: SceneModel, action: Action, time: number): number {
  return action.verb === 'orbit' ? num(model, action.changes['angle'], time) * progressAt(action, time) : 0
}

/** The value of an attribute at a time, with every action and link applied. */
export function valueAt(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  if (attr === 'x' || attr === 'y') return positionAt(model, obj, time)[attr]
  const { absolute, relative } = segmentsFor(model, obj, attr)
  let value = evalAbsolute(model, obj, attr, absolute, absolute.length, time, schema.type)
  if (relative.length > 0 && typeof value === 'number') {
    let sum = value
    for (const segment of relative) {
      if (segment.action.start > time) break
      if (segment.action.verb === 'orbit' && attr !== 'rotation') continue
      const delta = resolveSource(model, segment.to, time, 0)
      if (typeof delta === 'number') sum += delta * progressAt(segment.action, time)
    }
    value = sum
  }
  return value
}

/**
 * The action a value written for an attribute goes to at a time: the latest started one that
 * names it, or null for the declaration. An orbit names its center and angle, not the position
 * and rotation it turns, so it never catches a drag; its turn stacks on top (D118, D122).
 */
export function definingAction(obj: SceneObject, attr: string, time: number): Action | null {
  let found: Action | null = null
  for (const action of obj.actions) {
    if (action.overridden || !(attr in action.changes) || action.start > time) continue
    if (!found || byStart(found, action) < 0) found = action
  }
  return found
}

/** The latest started action changing an attribute at a time, an orbit's turn included: what to show as the reason a value is what it is. */
export function changingAction(obj: SceneObject, attr: string, time: number): Action | null {
  let found: Action | null = null
  for (const action of obj.actions) {
    if (action.overridden || !touches(action, attr) || action.start > time) continue
    if (!found || byStart(found, action) < 0) found = action
  }
  return found
}

/**
 * A copy of the model in which one written value of an object differs: the declaration's
 * attribute when `action` is null, else that action's change. Nothing else is touched, so what
 * the sampler shows for the copy is what the edit would show.
 */
export function withWritten(model: SceneModel, obj: SceneObject, action: Action | null, attr: string, value: number): [SceneModel, SceneObject] {
  const actions = action ? obj.actions.map((a) => (a.id === action.id ? { ...a, changes: { ...a.changes, [attr]: value } } : a)) : obj.actions
  const attrs = action ? obj.attrs : { ...obj.attrs, [attr]: value }
  const patched: SceneObject = { ...obj, attrs, actions }
  return [{ ...model, objects: model.objects.map((o) => (o === obj ? patched : o)) }, patched]
}

/** The value an attribute's definer holds now, as written; any number serves as a starting point when it holds none yet. */
function currentWritten(model: SceneModel, obj: SceneObject, action: Action | null, attr: string, time: number): number {
  if (action && attr in action.changes) return num(model, action.changes[attr], time)
  const v = action ? valueAt(model, obj, attr, time) : baseValue(model, obj, attr, time)
  return typeof v === 'number' ? v : 0
}

/**
 * The values to write so the object shows `shown` at a time, each going to its definer (D122).
 * Whatever stacks on top of a written value, relative changes and orbits, shifts or turns what
 * is shown by amounts that do not depend on it, so the shown values are affine in the written
 * ones: probing the sampler with each written value moved by one unit pins the answer exactly,
 * whatever is stacked, with no inverse to maintain. x and y are solved together, since a turn
 * mixes them; an axis the caller did not ask for comes back only when the solution had to move it.
 */
export function writtenValues(model: SceneModel, obj: SceneObject, time: number, shown: Record<string, number>, definers: Record<string, Action | null>): Record<string, number> {
  const out: Record<string, number> = {}
  const probe = (patch: Record<string, number>): [SceneModel, SceneObject] => {
    let m = model
    let o = obj
    for (const [attr, value] of Object.entries(patch)) [m, o] = withWritten(m, o, definers[attr] ?? null, attr, value)
    return [m, o]
  }
  if ('x' in shown || 'y' in shown) {
    const now = positionAt(model, obj, time)
    const target = { x: shown['x'] ?? now.x, y: shown['y'] ?? now.y }
    const w = { x: currentWritten(model, obj, definers['x'] ?? null, 'x', time), y: currentWritten(model, obj, definers['y'] ?? null, 'y', time) }
    const at = (dx: number, dy: number): Point => positionAt(...probe({ x: w.x + dx, y: w.y + dy }), time)
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
  for (const [attr, target] of Object.entries(shown)) {
    if (attr === 'x' || attr === 'y') continue
    const w = currentWritten(model, obj, definers[attr] ?? null, attr, time)
    const sample = (value: number): number => {
      const v = valueAt(...probe({ [attr]: value }), attr, time)
      return typeof v === 'number' ? v : 0
    }
    const v0 = sample(w)
    const slope = sample(w + 1) - v0
    out[attr] = w + (Math.abs(slope) > 1e-9 ? (target - v0) / slope : target - v0)
  }
  return out
}

/** An object exists wherever its opacity is above zero (decision D52). */
export function isVisibleAt(model: SceneModel, obj: SceneObject, time: number): boolean {
  const opacity = valueAt(model, obj, 'opacity', time)
  return typeof opacity === 'number' && opacity > 0.0005
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
