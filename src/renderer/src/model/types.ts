import type { AttrValue, Verb } from './registry'

export interface Range {
  from: number
  to: number
}

/** An attribute as written: a literal, or a function evaluated at sample time (a link). */
export type AttrFn = () => AttrValue
export type AttrSource = AttrValue | AttrFn

/**
 * A moment defined relative to actions, such as `fly.end` or `fly.progress(0.5)`. A class
 * action names one action per member; its start is the earliest and its end the latest.
 */
export interface TimeRef {
  readonly __timeRef: true
  kind: 'start' | 'end' | 'progress' | 'objectStart' | 'objectEnd' | 'forward' | 'state'
  actions: Action[]
  fraction?: number
  /** For `objectStart`, `objectEnd`, and `state`: the object (D138, D212). */
  object?: SceneObject
  /** For `forward`: a name declared further down and which of its times, looked up once the script has run (D148). */
  forward?: { name: string; part: 'start' | 'end' | 'progress' }
  /** For `state`: what the object is doing, which stretch of it, counted from 1 or the last, and which moment of that stretch (D212). */
  state?: { name: StateName; direction?: StateDirection; index: number | 'last'; part: 'start' | 'end' | 'progress' }
}

/** What an object can be doing, worked out from its animations frame by frame (D212). */
export type StateName = 'moving' | 'still' | 'turning' | 'growing' | 'shrinking' | 'visible' | 'hidden' | 'fadingIn' | 'fadingOut'
export const STATE_NAMES: readonly StateName[] = ['moving', 'still', 'turning', 'growing', 'shrinking', 'visible', 'hidden', 'fadingIn', 'fadingOut']
/** The ways `moving` and `turning` can go. */
export type StateDirection = 'left' | 'right' | 'up' | 'down' | 'clockwise' | 'counterclockwise'
export const STATE_DIRECTIONS: Readonly<Partial<Record<StateName, readonly StateDirection[]>>> = { moving: ['left', 'right', 'up', 'down'], turning: ['clockwise', 'counterclockwise'] }

/** One `key: value` line inside a block, with where it lives in the source. */
export interface PropInfo {
  key: string
  /** The whole `key: value` property. */
  range: Range
  valueRange: Range
  raw: string
  kind: 'literal' | 'function' | 'range' | 'other'
  /** For a range, `[from, to]`: where each of the two numbers lives (D221). */
  parts?: [Range, Range]
}

/** A `{ ... }` block of attributes in the source and the statement that holds it. */
export interface BlockInfo {
  /** The whole statement. */
  range: Range
  /** Position just after the opening brace. */
  propsOpen: number
  /** Position of the closing brace. */
  propsClose: number
  props: PropInfo[]
  /** End of the last property, including its trailing comma when there is one. */
  lastPropEnd: number
  trailingComma: boolean
  indent: string
  /** The `const ` or `let ` in front of a declaration, when present. */
  keywordRange?: Range
}

export interface DeclInfo extends BlockInfo {
  name: string
  className: string
}

/** `object.verb({ ... })`, or `all('class').verb({ ... })` when `className` is set. */
export interface ActionInfo extends BlockInfo {
  objectName: string
  className?: string
  verb: string
  name?: string
  /** The verb as written when that was an old name for `verb`, such as `scale` for a resize (D211). */
  alias?: string
}

export interface Timing {
  at?: number | TimeRef
  delay?: number
  duration?: number
  until?: number | TimeRef
  easeIn?: number
  easeOut?: number
  /** A named curve, or a function of the progress written in the code (D175). */
  ease?: string | ((progress: number) => number)
  /** Values are changes from where the object is when the action starts (D51). */
  relative?: boolean
}

export interface SceneObject {
  /** Creation index. */
  id: number
  /** The variable name, or a generated one for code-driven objects. */
  name: string
  className: string
  attrs: Record<string, AttrSource>
  /** Not tied to a top-level declaration, so the GUI cannot edit it. */
  codeDriven: boolean
  decl: DeclInfo | null
  /** In creation order. */
  actions: Action[]
  /** The CSS-like classes this object belongs to (D80). */
  classes: string[]
  /** The groups that list this object, in declaration order: their frames carry it, inner first (D124). */
  groups: string[]
  /** When the object begins, in seconds: before it, it does not exist (D138). */
  at: number
  /** When it is removed, or null when it lasts to the end of the content. */
  until: number | null
}

/** One statement on `all('class')`, which made one action per member (D80). */
export interface ClassAction {
  id: number
  className: string
  verb: Verb
  name: string | null
  stmt: ActionInfo | null
  members: Action[]
}

export interface Action {
  id: number
  object: SceneObject
  verb: Verb
  name: string | null
  changes: Record<string, AttrSource>
  /** Where the action begins from, for each attribute written as a range `[from, to]`, instead of where the object is (D221). */
  from: Record<string, AttrSource>
  timing: Timing
  /** Resolved, in seconds. */
  start: number
  end: number
  stmt: ActionInfo | null
  codeDriven: boolean
  /** Set when the action came from a class statement rather than the object's own. */
  classAction: ClassAction | null
  /** The class action this action replaces for its object, written as `overrides: name` (D80). */
  overrides: ClassAction | null
  /** True on a class member action that the object replaced with its own; it no longer applies. */
  overridden: boolean
}

export interface SceneError {
  message: string
  /** 1-based line in the scene file, when known. */
  line?: number
}

export interface SceneModel {
  source: string
  objects: SceneObject[]
  actions: Action[]
  classActions: ClassAction[]
  /** Class name to member object names, in first-seen order. */
  classes: Map<string, string[]>
  /** Group name to the names it lists, resolved: objects and groups, classes expanded (D124). */
  groups: Map<string, string[]>
  /** End of the last action, or null when nothing animates. The hold is added elsewhere. */
  lastActionEnd: number | null
  /** The latest `until` any object names, or null when none does (D138). */
  lastUntil: number | null
  /** Where the content ends: the later of the last action's end and the latest `until`, or null while nothing is timed (D54, D143). */
  contentEnd: number | null
  /** End of the last object declaration statement, where new objects are inserted. */
  lastDeclEnd: number | null
  warnings: SceneError[]
}
