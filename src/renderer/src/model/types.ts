import type { AttrValue, Verb } from './registry'

export interface Range {
  from: number
  to: number
}

/** An attribute as written: a literal, or a function evaluated at sample time (a link). */
export type AttrFn = () => AttrValue
export type AttrSource = AttrValue | AttrFn

/** A moment defined relative to an action or an object's lifetime, such as `fly.end`. */
export interface TimeRef {
  readonly __timeRef: true
  kind: 'start' | 'end' | 'progress' | 'appears' | 'disappears'
  action?: Action
  object?: SceneObject
  fraction?: number
}

/** One `key: value` line inside a block, with where its value lives in the source. */
export interface PropInfo {
  key: string
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

export interface ActionInfo extends BlockInfo {
  objectName: string
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
  fadeIn?: number
  fadeOut?: number
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
  appears: number
  /** Null means until the end. */
  disappears: number | null
  fadeIn: number
  fadeOut: number
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
  /** End of the last action or lifetime, or null when nothing animates. */
  contentEnd: number | null
  /** End of the last object declaration statement, where new objects are inserted. */
  lastDeclEnd: number | null
  warnings: SceneError[]
}
