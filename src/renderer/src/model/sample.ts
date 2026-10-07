import { attrSchema, type AttrType, type AttrValue } from './registry'
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

const segmentCache = new WeakMap<SceneModel, Map<string, Segment[]>>()

/** The actions that change this attribute, in start order. */
function segmentsFor(model: SceneModel, obj: SceneObject, attr: string): Segment[] {
  let perModel = segmentCache.get(model)
  if (!perModel) {
    perModel = new Map()
    segmentCache.set(model, perModel)
  }
  const key = `${obj.id}:${attr}`
  let segments = perModel.get(key)
  if (!segments) {
    segments = obj.actions
      .filter((a) => attr in a.changes)
      .sort((a, b) => a.start - b.start)
      .map((a) => ({ action: a, to: a.changes[attr]!, ease: easingFor(a.timing, a.end - a.start) }))
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
  return attrSchema(obj.className, attr)?.default ?? 0
}

/** The attribute before any action touches it. */
export function baseValue(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const fallback = fallbackFor(obj, attr)
  const source = obj.attrs[attr]
  return source === undefined ? fallback : resolveSource(model, source, time, fallback)
}

function evalSegments(model: SceneModel, obj: SceneObject, attr: string, segments: Segment[], count: number, time: number, type: AttrType): AttrValue {
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
  const from = evalSegments(model, obj, attr, segments, index, action.start, type)
  return interpolate(from, to, segment.ease((time - action.start) / (action.end - action.start)), type)
}

/** The value of an attribute at a time, with every action and link applied. */
export function valueAt(model: SceneModel, obj: SceneObject, attr: string, time: number): AttrValue {
  const schema = attrSchema(obj.className, attr)
  if (!schema) return 0
  const segments = segmentsFor(model, obj, attr)
  return evalSegments(model, obj, attr, segments, segments.length, time, schema.type)
}

/** The action that defines this attribute at this time, or null when the base value does. */
export function definingAction(model: SceneModel, obj: SceneObject, attr: string, time: number): Action | null {
  let found: Action | null = null
  for (const segment of segmentsFor(model, obj, attr)) {
    if (segment.action.start <= time) found = segment.action
    else break
  }
  return found
}

export function isVisibleAt(obj: SceneObject, time: number): boolean {
  return time >= obj.appears && (obj.disappears === null || time < obj.disappears)
}

/** Opacity multiplier from the lifetime fades, 0 to 1. */
export function lifetimeOpacity(obj: SceneObject, time: number): number {
  let factor = 1
  if (obj.fadeIn > 0) factor *= clamp01((time - obj.appears) / obj.fadeIn)
  if (obj.disappears !== null && obj.fadeOut > 0) factor *= clamp01((obj.disappears - time) / obj.fadeOut)
  return factor
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
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
