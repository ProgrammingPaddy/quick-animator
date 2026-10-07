/**
 * The class registry: every object type, its attributes with defaults and docs, the verbs, and
 * the timing keys (decision D36). Autocompletion, validation, the Selected pane, and the rules
 * document all read from here, so they can never disagree.
 */

export type AttrType = 'number' | 'color' | 'string' | 'boolean'
export type AttrValue = number | string | boolean

export interface AttrSchema {
  name: string
  type: AttrType
  default: AttrValue
  doc: string
  /** Whether actions may change it over time. */
  animatable: boolean
}

export interface ClassSchema {
  name: string
  doc: string
  attrs: AttrSchema[]
}

const common: AttrSchema[] = [
  { name: 'x', type: 'number', default: 0, doc: 'Center, in pixels to the right of the frame center.', animatable: true },
  { name: 'y', type: 'number', default: 0, doc: 'Center, in pixels above the frame center.', animatable: true },
  { name: 'z', type: 'number', default: 0, doc: 'Depth, toward the camera.', animatable: true },
  { name: 'rotation', type: 'number', default: 0, doc: 'Degrees, counterclockwise.', animatable: true },
  { name: 'scale', type: 'number', default: 1, doc: 'Size multiplier.', animatable: true },
  { name: 'opacity', type: 'number', default: 1, doc: '0 is invisible and costs nothing, 1 is solid. This is the one visibility control (D52).', animatable: true },
  { name: 'fill', type: 'color', default: '#ffffff', doc: 'Fill color, as #rrggbb.', animatable: true },
]

export const classes: Record<string, ClassSchema> = {
  Rect: {
    name: 'Rect',
    doc: 'A rectangle.',
    attrs: [
      ...common,
      { name: 'width', type: 'number', default: 200, doc: 'Width in pixels.', animatable: true },
      { name: 'height', type: 'number', default: 120, doc: 'Height in pixels.', animatable: true },
    ],
  },
  Circle: {
    name: 'Circle',
    doc: 'A circle.',
    attrs: [...common, { name: 'radius', type: 'number', default: 60, doc: 'Radius in pixels.', animatable: true }],
  },
  Text: {
    name: 'Text',
    doc: 'A line of text.',
    attrs: [
      ...common,
      { name: 'text', type: 'string', default: 'Text', doc: 'The text.', animatable: true },
      { name: 'fontSize', type: 'number', default: 48, doc: 'Font size in pixels.', animatable: true },
      { name: 'font', type: 'string', default: 'Segoe UI', doc: 'Font family.', animatable: false },
    ],
  },
}

export const CLASS_NAMES: ReadonlySet<string> = new Set(Object.keys(classes))

export const VERBS = ['to', 'move', 'rotate', 'scale', 'resize', 'fade'] as const
export type Verb = (typeof VERBS)[number]
export const VERB_NAMES: ReadonlySet<string> = new Set(VERBS)

/** Attributes each verb may change. Null means any animatable attribute. */
export const VERB_ATTRS: Record<Verb, readonly string[] | null> = {
  to: null,
  move: ['x', 'y', 'z'],
  rotate: ['rotation'],
  scale: ['scale'],
  resize: ['width', 'height', 'radius', 'fontSize'],
  fade: ['opacity'],
}

/** One color per kind of change, used wherever an action is shown. */
export const VERB_COLORS: Record<Verb, string> = {
  move: '#3b82f6',
  rotate: '#a855f7',
  scale: '#f59e0b',
  resize: '#f59e0b',
  fade: '#64748b',
  to: '#10b981',
}

/** The color for an object itself, as opposed to one of its actions. */
export const OBJECT_COLOR = '#3b82f6'

export const TIMING_KEYS = ['at', 'delay', 'duration', 'until', 'easeIn', 'easeOut', 'ease', 'relative'] as const
export type TimingKey = (typeof TIMING_KEYS)[number]
export const TIMING_KEY_NAMES: ReadonlySet<string> = new Set(TIMING_KEYS)

export const EASE_NAMES = ['linear', 'bounce', 'back', 'elastic', 'snap'] as const

export function schemaOf(className: string): ClassSchema | undefined {
  return classes[className]
}

export function attrSchema(className: string, attr: string): AttrSchema | undefined {
  return classes[className]?.attrs.find((a) => a.name === attr)
}
