import { classes } from './registry'
import type { ClassAction, SceneModel, SceneObject } from './types'

const TYPE_ORDER = Object.keys(classes)

/** Objects in the registry's order of their class, then in declaration order (D84). */
export function sortByType(objects: SceneObject[]): SceneObject[] {
  return [...objects].sort((a, b) => TYPE_ORDER.indexOf(a.className) - TYPE_ORDER.indexOf(b.className) || a.id - b.id)
}

/** A CSS-like class with its members and the actions written on `all('name')` (D80). */
export interface ClassGroup {
  className: string
  members: SceneObject[]
  actions: ClassAction[]
}

/** The store key under which a class group folds in the panes. */
export function classKey(className: string): string {
  return `class:${className}`
}

export function classGroups(model: SceneModel): ClassGroup[] {
  return [...model.classes.entries()].map(([className, names]) => ({
    className,
    members: sortByType(names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o)),
    actions: model.classActions.filter((a) => a.className === className),
  }))
}

/** Objects that belong to no class, sorted by type. */
export function unclassed(model: SceneModel): SceneObject[] {
  return sortByType(model.objects.filter((o) => o.classes.length === 0))
}

/** Objects grouped by class name, in registry order, with empty types left out. */
export function typeGroups(objects: SceneObject[]): { className: string; objects: SceneObject[] }[] {
  return TYPE_ORDER.map((className) => ({ className, objects: sortByType(objects.filter((o) => o.className === className)) })).filter((g) => g.objects.length > 0)
}

/** When a class action runs: from its earliest member's start to its latest member's end. */
export function classSpan(action: ClassAction): { start: number; end: number } | null {
  if (action.members.length === 0) return null
  return { start: Math.min(...action.members.map((m) => m.start)), end: Math.max(...action.members.map((m) => m.end)) }
}

/** Where a class action lives on one of its members: the object and the index there. */
export function memberRef(action: ClassAction): { object: string; index: number } | null {
  const member = action.members[0]
  if (!member) return null
  return { object: member.object.name, index: member.object.actions.indexOf(member) }
}
