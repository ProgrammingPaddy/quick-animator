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

const segmentCache = new WeakMap<SceneModel, Map<string, Segments>>()

function segmentsFor(model: SceneModel, obj: SceneObject, attr: string): Segments {
  let perModel = segmentCache.get(model)
  if (!perModel) {
    perModel = new Map()
    segmentCache.set(model, perModel)
  }
  const key = `${obj.id}:${attr}`
  let segments = perModel.get(key)
  if (!segments) {
    const type = attrSchema(obj.className, attr)?.type
    segments = { absolute: [], relative: [] }
    const sorted = obj.actions.filter((a) => attr in a.changes && !a.overridden).sort((a, b) => a.start - b.start || a.id - b.id)
    for (const action of sorted) {
      const segment: Segment = { action, to: action.changes[attr]!, ease: easingFor(action.timing, action.end - action.start) }
      if (action.timing.relative && type === 'number') segments.relative.push(segment)
      else segments.absolute.push(segment)
    }
    perModel.set(key, segments)
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

/** The value of an attribute at a time, with every action and link applied. */
export function valueAt(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const { absolute, relative } = segmentsFor(model, obj, attr)
  let value = evalAbsolute(model, obj, attr, absolute, absolute.length, time, schema.type)
  if (relative.length > 0 && typeof value === 'number') {
    let sum = value
    for (const segment of relative) {
      if (segment.action.start > time) break
      const delta = resolveSource(model, segment.to, time, 0)
      if (typeof delta === 'number') sum += delta * progressAt(segment.action, time)
    }
    value = sum
  }
  return value
}

/** The action that most recently started changing this attribute at this time, or null. */
export function definingAction(model: SceneModel, obj: SceneObject, attr: string, time: number): Action | null {
  const { absolute, relative } = segmentsFor(model, obj, attr)
  let found: Action | null = null
  for (const list of [absolute, relative]) {
    for (const segment of list) {
      const action = segment.action
      if (action.start > time) break
      if (!found || action.start > found.start || (action.start === found.start && action.id > found.id)) found = action
    }
  }
  return found
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
