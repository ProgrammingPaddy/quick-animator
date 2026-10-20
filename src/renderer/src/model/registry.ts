/**
 * The class registry: every object type, its attributes with defaults and docs, the verbs, and
 * the timing keys (decision D36). Autocompletion, validation, the Selected pane, and the rules
 * document all read from here, so they can never disagree.
 */

export type AttrType = 'number' | 'color' | 'string' | 'boolean' | 'points' | 'pathdata'
/** A plain value: a number, a word, yes or no, or a list of points, `[[x, y], ...]`, for a Shape (D232); path data is a string (D238). */
export type AttrValue = number | string | boolean | number[][]

export interface AttrSchema {
  name: string
  type: AttrType
  default: AttrValue
  doc: string
  /** Whether actions may change it over time. */
  animatable: boolean
  /** When set, the default comes from the object's other attributes, such as a circle's width from its radius (D106). */
  derive?: (attrs: Record<string, AttrValue>) => AttrValue
  /** A note kept in the code, such as where an import came from: the panes list it nowhere, and nothing links to it (D241). */
  hidden?: boolean
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
  { name: 'class', type: 'string', default: '', doc: "Class names separated by spaces, like CSS classes. An action on all('name') applies to every member (D80).", animatable: false },
  { name: 'at', type: 'number', default: 0, doc: 'When the object begins, in seconds or a time reference such as other.end. Before it, the object does not exist (D138).', animatable: false },
  { name: 'until', type: 'number', default: 0, doc: 'When the object is removed, in seconds or a time reference. Unset, it lasts to the end of the content.', animatable: false },
  { name: 'imported', type: 'string', default: '', doc: 'The file this came in from, when it was imported; the object pane tags it (D241).', animatable: false, hidden: true },
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
    doc: 'A circle, or an oval when its width and height differ.',
    attrs: [
      ...common,
      { name: 'radius', type: 'number', default: 60, doc: 'Radius in pixels: the width and the height are twice it unless they are set.', animatable: true },
      { name: 'width', type: 'number', default: 120, doc: 'Width in pixels. Unset: twice the radius.', animatable: true, derive: (a) => 2 * (typeof a['radius'] === 'number' ? a['radius'] : 60) },
      { name: 'height', type: 'number', default: 120, doc: 'Height in pixels. Unset: twice the radius.', animatable: true, derive: (a) => 2 * (typeof a['radius'] === 'number' ? a['radius'] : 60) },
    ],
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
  Shape: {
    name: 'Shape',
    doc: 'A polygon or a line through points of its own, or any SVG path (D232, D238).',
    attrs: [
      ...common,
      { name: 'points', type: 'points', default: [], doc: 'The corners, [[x, y], ...], around x and y. Shape.rect(w, h), Shape.polygon(sides, r), and Shape.star(points, outer, inner) give lists.', animatable: true },
      { name: 'curves', type: 'pathdata', default: '', doc: "SVG path data, 'M 0 0 C 50 -80 150 -80 200 0 Z': curves, and several pieces, which the Shape tool draws. Set, it is drawn instead of the points. Shape.circle(r) gives a circle.", animatable: true },
      { name: 'closed', type: 'boolean', default: true, doc: 'Joins the last point to the first and fills it. False draws an open line.', animatable: false },
      { name: 'smooth', type: 'boolean', default: false, doc: 'A curve through the points instead of straight lines between them.', animatable: false },
      { name: 'stroke', type: 'color', default: '#ffffff', doc: 'Outline color, as #rrggbb.', animatable: true },
      { name: 'strokeWidth', type: 'number', default: 0, doc: 'Outline width in pixels. 0 draws none.', animatable: true },
    ],
  },
  Group: {
    name: 'Group',
    doc: "Several objects that move, turn, and scale as one. Members keep their own values; the group's own values and its animations act on top (D124).",
    attrs: [
      { name: 'members', type: 'string', default: '', doc: 'Member names separated by spaces: objects, classes (every member of the class), or other groups.', animatable: false },
      { name: 'opacity', type: 'number', default: 1, doc: "Multiplies every member's opacity, so the group fades as one (D150).", animatable: true },
      { name: 'x', type: 'number', default: 0, doc: "How far the group's moves have shifted its members, in pixels to the right.", animatable: true },
      { name: 'y', type: 'number', default: 0, doc: "How far the group's moves have shifted its members, in pixels up.", animatable: true },
      { name: 'rotation', type: 'number', default: 0, doc: "Degrees the group has turned its members: this value around its pivot, then each turn around the center of their box when that turn began.", animatable: true },
      { name: 'scale', type: 'number', default: 1, doc: "What the group has multiplied its members by: this value around its pivot, then each scaling around the center of their box when that scaling began.", animatable: true },
      { name: 'pivotX', type: 'number', default: 0, doc: "What the group's own rotation and scale pivot on, in the members' space. The GUI writes the center of their box when it first turns or scales the group; unset, that center at time zero.", animatable: false },
      { name: 'pivotY', type: 'number', default: 0, doc: 'The pivot, up.', animatable: false },
      { name: 'imported', type: 'string', default: '', doc: 'The file this came in from, when it was imported; the object pane tags it (D241).', animatable: false, hidden: true },
    ],
  },
}

/** The class whose body is other objects (D124). */
export const GROUP = 'Group'
/** The class drawn from points of its own (D232). */
export const SHAPE = 'Shape'

export const CLASS_NAMES: ReadonlySet<string> = new Set(Object.keys(classes))

export const VERBS = ['to', 'move', 'rotate', 'resize', 'fade', 'path', 'morph'] as const
export type Verb = (typeof VERBS)[number]

/** Old names for verbs, still read, each as the verb it now is: `scale` folded into `resize` (D211). A file using one loads, with a note at the line. */
export const VERB_ALIASES: Readonly<Record<string, Verb>> = { scale: 'resize' }

/** The verb a written name means, or null when it is none. */
export function canonicalVerb(name: string): Verb | null {
  if ((VERBS as readonly string[]).includes(name)) return name as Verb
  return VERB_ALIASES[name] ?? null
}

export const VERB_NAMES: ReadonlySet<string> = new Set([...VERBS, ...Object.keys(VERB_ALIASES)])

/** Attributes each verb may change. Null means any animatable attribute. */
export const VERB_ATTRS: Record<Verb, readonly string[] | null> = {
  to: null,
  move: ['x', 'y', 'z'],
  path: ['x', 'y', 'rotation'],
  rotate: ['rotation'],
  resize: ['width', 'height', 'radius', 'fontSize', 'scale'],
  fade: ['opacity'],
  // A morph changes a Shape's outline, named here by its curves so the menus offer it to Shapes alone; the target itself is `to` (D257).
  morph: ['curves'],
}


/**
 * Parameters a verb takes that are not attributes of the object. A group's turn or scale names
 * the point it pivots on, `pivotX, pivotY`, in the space its members' own values live in; unset,
 * it is the center of the members' box when the action begins (D124).
 */
export const VERB_PARAMS: Record<Verb, readonly string[]> = {
  to: ['pivotX', 'pivotY'],
  move: [],
  path: ['shape', 'orient', 'offset', 'smooth'],
  rotate: ['pivotX', 'pivotY'],
  resize: ['pivotX', 'pivotY'],
  fade: [],
  morph: ['to'],
}
export const PIVOT_PARAMS = ['pivotX', 'pivotY'] as const

/** One color per kind of change, used wherever an action is shown. */
export const VERB_COLORS: Record<Verb, string> = {
  move: '#3b82f6',
  path: '#86efac',
  rotate: '#a855f7',
  resize: '#f59e0b',
  fade: '#64748b',
  to: '#10b981',
  morph: '#ec4899',
}

/** The color for an object itself, as opposed to one of its actions. */
export const OBJECT_COLOR = '#3b82f6'

/** Keys allowed in every action block that are not attributes: timing, `relative`, and `overrides` (D80). */
export const TIMING_KEYS = ['at', 'delay', 'duration', 'until', 'easeIn', 'easeOut', 'ease', 'relative', 'overrides'] as const
export type TimingKey = (typeof TIMING_KEYS)[number]
export const TIMING_KEY_NAMES: ReadonlySet<string> = new Set(TIMING_KEYS)

export const EASE_NAMES = ['linear', 'bounce', 'back', 'elastic', 'snap'] as const

export function schemaOf(className: string): ClassSchema | undefined {
  return classes[className]
}

export function attrSchema(className: string, attr: string): AttrSchema | undefined {
  return classes[className]?.attrs.find((a) => a.name === attr)
}

/** An attribute's default for one object: derived from its other literal attributes when the schema says so. */
export function defaultFor(className: string, attr: string, attrs: Record<string, unknown>): AttrValue | undefined {
  const schema = attrSchema(className, attr)
  if (!schema) return undefined
  if (!schema.derive) return schema.default
  const literals: Record<string, AttrValue> = {}
  for (const [key, value] of Object.entries(attrs)) if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || Array.isArray(value)) literals[key] = value as AttrValue
  return schema.derive(literals)
}

/** The text color that reads on a color: dark on a light one, white otherwise (D201). */
export function labelOn(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16)
  const luminance = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return luminance > 0.6 ? '#111827' : '#ffffff'
}
