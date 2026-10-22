import { beginGesture, endGesture } from '../code/editor'
import { formatNumber } from '../model/edits'
import { attrSchema, SHAPE, type Verb } from '../model/registry'
import { ownBounds, valueAt } from '../model/sample'
import { DEFAULT_STAGGER, unitCount } from '../model/text'
import type { SceneModel, SceneObject } from '../model/types'
import { appendActionText, convertToShape, freeName, frameSeconds, roundSeconds } from './operations'
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
  /** The family the pane lists it under when that is not its verb's: Text, for the ones by character, word, or line (D268). */
  family?: string
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
  // Morphs (D265): the outline becomes a figure as big as the object; a Rect or a Circle becomes a Shape first.
  { id: 'morphCircle', label: 'Circle', title: 'The outline becomes a circle, 1 s', verb: 'morph', duration: 1, place: 'start' },
  { id: 'morphSquare', label: 'Square', title: 'The outline becomes a square, 1 s', verb: 'morph', duration: 1, place: 'start' },
  {
    id: 'morphPolygon',
    label: 'Polygon',
    title: 'The outline becomes a polygon, 1 s',
    verb: 'morph',
    duration: 1,
    place: 'start',
    variants: [
      { id: '6', label: 'hexagon' },
      { id: '3', label: 'triangle' },
      { id: '5', label: 'pentagon' },
      { id: '8', label: 'octagon' },
    ],
  },
  {
    id: 'morphStar',
    label: 'Star',
    title: 'The outline becomes a star, 1 s',
    verb: 'morph',
    duration: 1,
    place: 'start',
    variants: [
      { id: '5', label: '5 points' },
      { id: '4', label: '4 points' },
      { id: '6', label: '6 points' },
      { id: '8', label: '8 points' },
    ],
  },
  { id: 'morphBlob', label: 'Blob', title: 'The outline becomes a soft blob, 1 s', verb: 'morph', duration: 1, place: 'start' },
  // Text, by character, word, or line (D268); the length is the first unit's, the whole takes the stagger more for each unit after it.
  { id: 'typeOn', label: 'Type on', title: 'The characters appear one by one, 0.05 s apart', verb: 'fade', duration: 0.03, place: 'start', family: 'Text' },
  { id: 'riseByWord', label: 'Rise by word', title: 'Each word fades in as it rises into place, 0.08 s apart', verb: 'to', duration: 0.4, place: 'start', family: 'Text' },
  { id: 'lettersDrop', label: 'Letters drop', title: 'The characters drop in from above and bounce, 0.03 s apart', verb: 'to', duration: 0.5, place: 'start', family: 'Text' },
  { id: 'linesIn', label: 'Lines in', title: 'Each line slides in from the left as it fades in, 0.15 s apart', verb: 'to', duration: 0.5, place: 'start', family: 'Text' },
  { id: 'fadeOutByWord', label: 'Fade out by word', title: 'The words fade out one after another over the last moments', verb: 'fade', duration: 0.3, place: 'end', family: 'Text' },
  { id: 'codeTyping', label: 'Code typing', title: 'The characters are typed in, the gaps between them uneven', verb: 'fade', duration: 0.02, place: 'start', family: 'Text' },
  { id: 'enchanted', label: 'Enchanted', title: 'Every letter cycles through the rainbow and wiggles, in and out over 4 s', verb: 'to', duration: 4, place: 'start', family: 'Text' },
  { id: 'slotMachine', label: 'Slot machine', title: 'Every character spins from the start and lands on its own, the first soon, the last after 2 s more', verb: 'to', duration: 3, place: 'start', family: 'Text' },
  // Miscellaneous (D272): for any object.
  {
    id: 'colorChange',
    label: 'Color change',
    title: 'The fill becomes the color, 0.5 s',
    verb: 'to',
    duration: 0.5,
    place: 'start',
    family: 'to',
    variants: [
      { id: 'red', label: 'red' },
      { id: 'orange', label: 'orange' },
      { id: 'yellow', label: 'yellow' },
      { id: 'green', label: 'green' },
      { id: 'blue', label: 'blue' },
      { id: 'purple', label: 'purple' },
      { id: 'white', label: 'white' },
      { id: 'rainbow', label: 'rainbow, turning' },
    ],
  },
  // Each under its verb's family (D278).
  { id: 'shake', label: 'Shake', title: 'Shakes side to side and settles, 0.6 s', verb: 'move', duration: 0.6, place: 'start' },
  { id: 'blink', label: 'Blink', title: 'Off and on three times, 0.6 s', verb: 'fade', duration: 0.6, place: 'start' },
  { id: 'grow', label: 'Grow', title: 'Grows to half as big again, 0.5 s', verb: 'resize', duration: 0.5, place: 'start' },
  { id: 'shrink', label: 'Shrink', title: 'Shrinks to half, 0.5 s', verb: 'resize', duration: 0.5, place: 'start' },
]

const COLORS: Record<string, string> = { red: '#ff5a5a', orange: '#ff9f43', yellow: '#ffd166', green: '#2ecc71', blue: '#4f8cff', purple: '#a855f7', white: '#ffffff' }

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
  // The morphs (D265): a target as a word, as big as the object is, so the outline keeps its size.
  morphCircle: (c) => morphTo(c, `Shape.circle(${f(reach(c))})`),
  morphSquare: (c) => morphTo(c, `Shape.rect(${f(2 * reach(c))}, ${f(2 * reach(c))})`),
  morphPolygon: (c, variant) => morphTo(c, `Shape.polygon(${variant ?? '6'}, ${f(reach(c))})`),
  morphStar: (c, variant) => morphTo(c, `Shape.star(${variant ?? '5'}, ${f(reach(c))}, ${f(Math.round(reach(c) / 2))})`),
  morphBlob: (c) => morphTo(c, `Shape.blob(${f(reach(c))})`),
  // Text by unit (D268): a fade or a to on each character, word, or line in turn.
  typeOn: (c) => byUnit(c, 'fade', ['opacity: [0, 1]'], 'char', 0.05, 0.03, []),
  riseByWord: (c) => byUnit(c, 'to', ['opacity: [0, 1]', 'y: [-20, 0]'], 'word', 0.08, 0.4, []),
  lettersDrop: (c) => byUnit(c, 'to', ['opacity: [0, 1]', 'y: [120, 0]'], 'char', 0.03, 0.5, ["ease: 'bounce'"]),
  linesIn: (c) => byUnit(c, 'to', ['opacity: [0, 1]', 'x: [-120, 0]'], 'line', 0.15, 0.5, ['easeIn: 0']),
  fadeOutByWord: (c) => byUnit(c, 'fade', ['opacity: 0'], 'word', 0.06, 0.3, []),
  // Typed in with uneven gaps: the stagger a function of the character's index (D269, D272).
  codeTyping: (c) => byUnit(c, 'fade', ['opacity: [0, 1]'], 'char', '(i) => 0.04 + ((i * 7) % 5) / 100', 0.02, []),
  // Each letter its own hue cycling at a rate of its own, and a wiggle, from the seconds and the index; the ramps bring it in and out, so the text ends as it began (D277, D278).
  enchanted: (c) => byUnit(c, 'to', ['fill: (p, i, c, t, speed = 0.5) => Color.hue(t * speed + i / 8)', 'y: (p, i, c, t) => Math.sin(t * 6 + i) * 4'], 'char', 0, 4, []),
  // Every character spins from the start and lands on its own, the first soon, the last after `settle` seconds more (D278).
  slotMachine: (c) => byUnit(c, 'to', ['text: (p, i, c, t, n, settle = 2) => (t < 0.4 + (i / n) * settle ? Text.scramble(i, t) : c)'], 'char', 0, 3, ["ease: 'linear'"]),
  // Miscellaneous (D272): a color, or the rainbow turning at a rate of its own (D278).
  colorChange: (c, variant) =>
    variant === 'rainbow'
      ? { text: statement(c.name, c.object, 'to', ['fill: (p, t, speed = 0.5) => Color.hue(t * speed)', `at: ${f(c.at)}`, 'duration: 4', "ease: 'linear'"]), start: c.at, end: c.at + 4 }
      : { text: statement(c.name, c.object, 'to', [`fill: '${COLORS[variant ?? 'red'] ?? COLORS['red']}'`, `at: ${f(c.at)}`, 'duration: 0.5']), start: c.at, end: c.at + 0.5 },
  shake: (c) => ({ text: statement(c.name, c.object, 'move', ['x: (p) => Math.sin(p * 24) * 12 * (1 - p)', 'relative: true', `at: ${f(c.at)}`, 'duration: 0.6', "ease: 'linear'"]), start: c.at, end: c.at + 0.6 }),
  blink: (c) => ({ text: statement(c.name, c.object, 'fade', ['opacity: (p) => (Math.floor(p * 6) % 2 === 0 ? 0 : 1)', `at: ${f(c.at)}`, 'duration: 0.6', "ease: 'linear'"]), start: c.at, end: c.at + 0.6 }),
  // A relative scale adds to the factor, as the pulse does: a half more, or a half less.
  grow: (c) => ({ text: statement(c.name, c.object, 'resize', ['scale: 0.5', 'relative: true', `at: ${f(c.at)}`, 'duration: 0.5']), start: c.at, end: c.at + 0.5 }),
  shrink: (c) => ({ text: statement(c.name, c.object, 'resize', ['scale: -0.5', 'relative: true', `at: ${f(c.at)}`, 'duration: 0.5']), start: c.at, end: c.at + 0.5 }),
}

/** An action by character, word, or line (D268); the whole lasts the unit's duration and the stagger more for each unit after the first, which the end reports once the text is known. The stagger is seconds, or code: a function of the unit's index. */
function byUnit(c: Context, verb: Verb, lines: string[], by: string, stagger: number | string, duration: number, timing: string[]): Written {
  return { text: statement(c.name, c.object, verb, [...lines, `by: '${by}'`, `stagger: ${typeof stagger === 'number' ? f(stagger) : stagger}`, `at: ${f(c.at)}`, `duration: ${f(duration)}`, ...timing]), start: c.at, end: c.at + duration }
}

/** A morph to a target, a second long. */
function morphTo(c: Context, target: string): Written {
  return { text: statement(c.name, c.object, 'morph', [`to: ${target}`, `at: ${f(c.at)}`, 'duration: 1']), start: c.at, end: c.at + 1 }
}

/** Half the larger side of the object, so a morph's target is as big as the object is; 60 for one with no size. */
function reach(c: Context): number {
  return Math.round(Math.max(c.size.width, c.size.height) / 2) || 60
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
  if (obj.className === SHAPE) {
    const b = ownBounds(model, obj, time)
    return { width: b.width * scale, height: b.height * scale }
  }
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
      let model = useStore.getState().model
      let obj = model?.objects.find((o) => o.name === target.object)
      if (!model || !obj?.decl) continue
      // By character, word, or line is a Text's (D268).
      if (preset.family === 'Text' && obj.className !== 'Text') continue
      // A morph is a Shape's (D257): a Rect or a Circle becomes one first, as Convert to shape does, and anything else does not morph (D265).
      if (preset.verb === 'morph' && obj.className !== SHAPE) {
        if (obj.className !== 'Rect' && obj.className !== 'Circle') continue
        convertToShape(obj.name)
        model = useStore.getState().model
        obj = model?.objects.find((o) => o.name === target.object)
        if (!model || !obj?.decl) continue
      }
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
  // A text preset shows on two lines of text, and its whole run is the units' (D268); a morph on a Shape of the same size, since only a Shape morphs (D265).
  const text = preset.family === 'Text'
  const shape = preset.verb === 'morph'
  const demoText = 'Quick\\nAnimator'
  const units = text ? Object.fromEntries((['char', 'word', 'line'] as const).map((k) => [k, unitCount(demoText.replace('\\n', '\n'), k)])) : null
  const at = preset.place === 'end' ? (text ? 1.2 : 0.6) : 0.2
  const written = writer({ object: 'demo', name: WRITERS[id] ? preset.id : presetIdent(preset.label), at, frame: { width: 1920, height: 1080 }, size: { width: 400, height: 240 } }, variant, 60)
  const by = /by: '(\w+)'/.exec(written.text)?.[1] as 'char' | 'word' | 'line' | undefined
  const stagger = Number(/stagger: ([\d.]+)/.exec(written.text)?.[1] ?? DEFAULT_STAGGER)
  const end = units && by ? written.end + stagger * Math.max(0, units[by]! - 1) : written.end
  const kind = text ? 'Text' : shape ? 'Shape' : 'Rect'
  const attrs = ['x: 0', 'y: 0', ...(text ? [`text: '${demoText}'`, 'fontSize: 150', 'weight: 700'] : shape ? ['points: Shape.rect(400, 240)'] : ['width: 400', 'height: 240']), "fill: '#4f8cff'", `until: ${f(end + 0.4)}`]
  return { source: `demo = ${kind}({\n${attrs.map((a) => `  ${a},`).join('\n')}\n})\n\n${written.text}\n`, length: end + 0.4 }
}
