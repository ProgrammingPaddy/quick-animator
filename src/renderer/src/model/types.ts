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
  kind: 'start' | 'end' | 'progress'
  actions: Action[]
  fraction?: number
}

/** One `key: value` line inside a block, with where it lives in the source. */
export interface PropInfo {
  key: string
  /** The whole `key: value` property. */
  range: Range
  valueRange: Range
  raw: string
  kind: 'literal' | 'function' | 'other'
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
}

export interface Timing {
  at?: number | TimeRef
  delay?: number
  duration?: number
  until?: number | TimeRef
  easeIn?: number
  easeOut?: number
  ease?: string
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
  timing: Timing
  /** Resolved, in seconds. */
  start: number
  end: number
  stmt: ActionInfo | null
  codeDriven: boolean
  /** Set when the action came from a class statement rather than the object's own. */
  classAction: ClassAction | null
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
  /** End of the last action, or null when nothing animates. The hold is added elsewhere. */
  lastActionEnd: number | null
  /** End of the last object declaration statement, where new objects are inserted. */
  lastDeclEnd: number | null
  warnings: SceneError[]
}
