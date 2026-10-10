import { attrSchema, defaultFor, GROUP, type AttrType, type AttrValue } from './registry'
import { easingFor, type Easing } from './easing'
import type { Action, AttrSource, SceneModel, SceneObject } from './types'

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
}

const cache = new WeakMap<SceneModel, Cache>()

function cacheFor(model: SceneModel): Cache {
  let c = cache.get(model)
  if (!c) {
    c = { segments: new Map(), containers: new Map(), pivots: new Map(), basePivots: new Map(), starts: new Map(), motions: new Map() }
    cache.set(model, c)
  }
  return c
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
    const sorted = obj.actions.filter((a) => attr in a.changes && !a.overridden).sort(byStart)
    for (const action of sorted) {
      const segment: Segment = { action, to: action.changes[attr]!, ease: easingFor(action.timing, action.end - action.start) }
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

/** The value of an attribute at a time, with every action and link applied: the latest absolute action, then every relative change on top (D53). */
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
  return group.actions.filter((a) => !a.overridden && ('rotation' in a.changes || 'scale' in a.changes || 'x' in a.changes || 'y' in a.changes)).sort(byStart)
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

/** The action a value written for an attribute goes to at a time: the latest started one that names it, or null for the declaration (D102, D122). */
export function definingAction(obj: SceneObject, attr: string, time: number): Action | null {
  let found: Action | null = null
  for (const action of obj.actions) {
    if (action.overridden || !(attr in action.changes) || action.start > time) continue
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
export function currentWritten(model: SceneModel, obj: SceneObject, action: Action | null, attr: string, time: number): number {
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
    for (const [attr, value] of Object.entries(patch)) [m, o] = withWritten(m, o, definers[attr] ?? null, attr, value)
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

/** An object exists wherever its opacity is above zero (decision D52). A group has no opacity of its own and always exists. */
export function isVisibleAt(model: SceneModel, obj: SceneObject, time: number): boolean {
  if (!attrSchema(obj.className, 'opacity')) return true
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
