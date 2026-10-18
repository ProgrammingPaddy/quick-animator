import { beginGesture, endGesture } from '../code/editor'
import { formatNumber } from '../model/edits'
import { attrSchema, type Verb } from '../model/registry'
import { valueAt } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { appendActionText, freeName, frameSeconds, roundSeconds } from './operations'
import { presetIdent } from './userPresets'
import { useStore, type UserPreset } from '../state/store'

/** A way a preset can go: a side to slide in from, a direction to spin (D219). */
export interface Variant {
  id: string
  label: string
}

/**
 * A technique that writes one ordinary, named animation (D217, D219): its name and what it
 * does, the verb it writes, how long it takes, where it goes by default on an object, the
 * first frame of the object's existence or its last, and its variations.
 */
export interface AnimationPreset {
  id: string
  label: string
  title: string
  verb: Verb
  duration: number
  place: 'start' | 'end'
  variants?: readonly Variant[]
}

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  { id: 'fadeIn', label: 'Fade in', title: 'Fades in, 0.3 s', verb: 'fade', duration: 0.3, place: 'start' },
  { id: 'fadeOut', label: 'Fade out', title: 'Fades out over the last 0.3 s', verb: 'fade', duration: 0.3, place: 'end' },
  { id: 'popIn', label: 'Pop in', title: 'Appears in one frame', verb: 'fade', duration: 1 / 60, place: 'start' },
  { id: 'popOut', label: 'Pop out', title: 'Disappears in the last frame', verb: 'fade', duration: 1 / 60, place: 'end' },
  {
    id: 'slideIn',
    label: 'Slide in',
    title: 'Slides in from off the frame, 0.6 s',
    verb: 'move',
    duration: 0.6,
    place: 'start',
    variants: [
      { id: 'left', label: 'from left' },
      { id: 'right', label: 'from right' },
      { id: 'top', label: 'from top' },
      { id: 'bottom', label: 'from bottom' },
    ],
  },
  { id: 'bounceIn', label: 'Bounce in', title: 'Drops in from above and bounces, 0.8 s', verb: 'move', duration: 0.8, place: 'start' },
  { id: 'snapIn', label: 'Snap in', title: 'Snaps in from the left, 0.4 s', verb: 'move', duration: 0.4, place: 'start' },
  {
    id: 'spin',
    label: 'Spin',
    title: 'A full turn, 1 s',
    verb: 'rotate',
    duration: 1,
    place: 'start',
    variants: [
      { id: 'left', label: 'to the left' },
      { id: 'right', label: 'to the right' },
    ],
  },
  { id: 'pulse', label: 'Pulse', title: 'Grows a fifth and settles back, 0.6 s', verb: 'resize', duration: 0.6, place: 'start' },
  { id: 'orbit', label: 'Orbit', title: 'A circle around a center beside it, 3 s', verb: 'path', duration: 3, place: 'start' },
]

/** What a preset needs to write for an object: the names, when, and how big the frame and the object are. */
interface Context {
  object: string
  name: string
  at: number
  frame: { width: number; height: number }
  size: { width: number; height: number }
}

/** The statement a preset writes and the span it takes. */
interface Written {
  text: string
  start: number
  end: number
}

const f = formatNumber

function statement(name: string, object: string, verb: Verb, lines: string[]): string {
  return `${name} = ${object}.${verb}({\n${lines.map((l) => `  ${l},`).join('\n')}\n})`
}

/** A move relative to the object, from a distance away to none: the way to arrive without naming a place (D220, D222). */
function arriveFrom(c: Context, from: [number, number], duration: number, timing: string[]): Written {
  const lines: string[] = []
  if (from[0] !== 0) lines.push(`x: [${f(from[0])}, 0]`)
  if (from[1] !== 0) lines.push(`y: [${f(from[1])}, 0]`)
  return { text: statement(c.name, c.object, 'move', [...lines, 'relative: true', `at: ${f(c.at)}`, `duration: ${f(duration)}`, ...timing]), start: c.at, end: c.at + duration }
}

const WRITERS: Record<string, (c: Context, variant: string | undefined, fps: number) => Written> = {
  fadeIn: (c) => ({ text: statement(c.name, c.object, 'fade', ['opacity: [0, 1]', `at: ${f(c.at)}`, 'duration: 0.3']), start: c.at, end: c.at + 0.3 }),
  fadeOut: (c) => ({ text: statement(c.name, c.object, 'fade', ['opacity: 0', `at: ${f(c.at)}`, 'duration: 0.3']), start: c.at, end: c.at + 0.3 }),
  popIn: (c, _v, fps) => ({ text: statement(c.name, c.object, 'fade', ['opacity: [0, 1]', `at: ${f(c.at)}`, `duration: ${f(frameSeconds(fps))}`]), start: c.at, end: c.at + frameSeconds(fps) }),
  popOut: (c, _v, fps) => ({ text: statement(c.name, c.object, 'fade', ['opacity: 0', `at: ${f(c.at)}`, `duration: ${f(frameSeconds(fps))}`]), start: c.at, end: c.at + frameSeconds(fps) }),
  slideIn: (c, variant) => {
    const dx = Math.round(c.frame.width / 2 + c.size.width)
    const dy = Math.round(c.frame.height / 2 + c.size.height)
    const from: [number, number] = variant === 'right' ? [dx, 0] : variant === 'top' ? [0, dy] : variant === 'bottom' ? [0, -dy] : [-dx, 0]
    return arriveFrom(c, from, 0.6, ['easeIn: 0'])
  },
  bounceIn: (c) => arriveFrom(c, [0, Math.round(c.frame.height / 2 + c.size.height)], 0.8, ["ease: 'bounce'"]),
  snapIn: (c) => arriveFrom(c, [-200, 0], 0.4, ["ease: 'snap'"]),
  spin: (c, variant) => ({ text: statement(c.name, c.object, 'rotate', [`rotation: ${variant === 'right' ? -360 : 360}`, 'relative: true', `at: ${f(c.at)}`, 'duration: 1']), start: c.at, end: c.at + 1 }),
  pulse: (c) => ({ text: statement(c.name, c.object, 'resize', ['scale: 0.2', 'relative: true', `at: ${f(c.at)}`, 'duration: 0.6', 'ease: (p) => Math.sin(p * Math.PI)']), start: c.at, end: c.at + 0.6 }),
  // The center and the radius are parameters with defaults: plain numbers at the top, no declarations in the user's code (D228).
  orbit: (c) => ({
    text: `${c.name} = ${c.object}.path({\n  shape: (p, center = [-200, 0], radius = 200) => [center[0] + radius * Math.cos(p * 2 * Math.PI), center[1] + radius * Math.sin(p * 2 * Math.PI)],\n  relative: true,\n  at: ${f(c.at)},\n  duration: 3,\n  ease: 'linear',\n  orient: true,\n})`,
    start: c.at,
    end: c.at + 3,
  }),
}

/** One of the user's own presets by id, or undefined (D227). */
export function userPresetOf(id: string): UserPreset | undefined {
  return useStore.getState().userPresets.find((p) => p.id === id)
}

/** A user's animation preset as the pane and the drags see it: named after its label, placed at an object's start (D227). */
export function userAnimationPreset(p: UserPreset): AnimationPreset | null {
  if (p.kind !== 'animation' || !p.verb) return null
  return { id: p.id, label: p.label, title: `${p.verb}${p.propsText?.includes('relative: true') ? ', relative' : ''}, ${p.duration ?? 1} s`, verb: p.verb as Verb, duration: p.duration ?? 1, place: 'start' }
}

/** A built-in animation preset, or one of the user's, by id. */
export function presetById(id: string): AnimationPreset | null {
  const builtIn = ANIMATION_PRESETS.find((p) => p.id === id)
  if (builtIn) return builtIn
  const user = userPresetOf(id)
  return user ? userAnimationPreset(user) : null
}

/** The writer for a user's animation: its block as saved, placed at the time (D227). */
function userWriter(p: UserPreset): (c: Context) => Written {
  return (c) => ({ text: `${c.name} = ${c.object}.${p.verb}({\n${p.propsText}${p.propsText ? '\n' : ''}  at: ${f(c.at)},\n})`, start: c.at, end: c.at + (p.duration ?? 1) })
}

function writerFor(id: string): ((c: Context, variant: string | undefined, fps: number) => Written) | null {
  const builtIn = WRITERS[id]
  if (builtIn) return builtIn
  const user = userPresetOf(id)
  return user && user.kind === 'animation' && user.verb ? userWriter(user) : null
}

/** The drawn size of an object at a time, scale included, for how far off the frame it must start. */
function sizeOf(model: SceneModel, obj: SceneObject, time: number): { width: number; height: number } {
  const num = (attr: string): number => {
    const v = valueAt(model, obj, attr, time)
    return typeof v === 'number' ? v : 0
  }
  const scale = num('scale') || 1
  if (attrSchema(obj.className, 'width')) return { width: num('width') * scale, height: num('height') * scale }
  if (attrSchema(obj.className, 'radius')) return { width: 2 * num('radius') * scale, height: 2 * num('radius') * scale }
  if (attrSchema(obj.className, 'fontSize')) return { width: num('fontSize') * 4 * scale, height: num('fontSize') * 1.2 * scale }
  return { width: 0, height: 0 }
}

/** When an object ends, for a preset that goes at its end: its `until`, else its last animation's end, else a second after it begins. */
function endOf(obj: SceneObject): number {
  if (obj.until !== null) return obj.until
  const own = obj.actions.filter((a) => !a.overridden)
  return own.length > 0 ? Math.max(...own.map((a) => a.end)) : obj.at + 1
}

/** Where a preset goes on an object when nothing says otherwise (D219): its first frame, or ending at its last. */
export function defaultTime(preset: AnimationPreset, obj: SceneObject): number {
  return preset.place === 'end' ? Math.max(obj.at, endOf(obj) - preset.duration) : obj.at
}

/**
 * Where a preset dropped on an object in the preview goes (D222): at the playhead when that lies
 * inside the object's life, past its first frame and short of its last, a start preset beginning
 * there and an end preset ending there; otherwise at the preset's default place.
 */
export function dropTime(preset: AnimationPreset, obj: SceneObject, playhead: number): number {
  const inside = playhead > obj.at && playhead < endOf(obj)
  if (!inside) return defaultTime(preset, obj)
  return preset.place === 'end' ? Math.max(obj.at, playhead - preset.duration) : playhead
}

/**
 * Apply an animation preset to objects (D219), each at a time or, with null, at the preset's
 * default place on it, as one undo step. Each writes one named animation at the end of the
 * script, and nothing else: an arrival says where it begins in its own block (D221).
 */
export function applyAnimationPreset(id: string, variant: string | undefined, targets: { object: string; time: number | null }[]): void {
  const preset = presetById(id)
  const writer = writerFor(id)
  if (!preset || !writer || targets.length === 0) return
  const s = useStore.getState()
  if (!s.model) return
  // A user's preset is named after its label; a built-in one after its id.
  const base = WRITERS[id] ? preset.id : presetIdent(preset.label)
  beginGesture()
  try {
    for (const target of targets) {
      const model = useStore.getState().model
      const obj = model?.objects.find((o) => o.name === target.object)
      if (!model || !obj?.decl) continue
      const at = roundSeconds(target.time ?? defaultTime(preset, obj))
      const written = writer({ object: obj.name, name: freeName(base), at, frame: { width: s.settings.width, height: s.settings.height }, size: sizeOf(model, obj, at) }, variant, s.settings.fps)
      appendActionText(obj.name, written.text, written.start, written.end)
    }
  } finally {
    endGesture()
  }
}

/** A small scene that shows a preset on a sample rectangle, for the preview card (D219): the source, and how long one showing takes. */
export function presetDemo(id: string, variant: string | undefined): { source: string; length: number } | null {
  const preset = presetById(id)
  const writer = writerFor(id)
  if (!preset || !writer) return null
  const at = preset.place === 'end' ? 0.6 : 0.2
  const written = writer({ object: 'demo', name: WRITERS[id] ? preset.id : presetIdent(preset.label), at, frame: { width: 1920, height: 1080 }, size: { width: 400, height: 240 } }, variant, 60)
  const attrs = ['x: 0', 'y: 0', 'width: 400', 'height: 240', "fill: '#4f8cff'", `until: ${f(written.end + 0.4)}`]
  return { source: `demo = Rect({\n${attrs.map((a) => `  ${a},`).join('\n')}\n})\n\n${written.text}\n`, length: written.end + 0.4 }
}
