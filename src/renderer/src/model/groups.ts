import { classes } from './registry'
import type { Action, ClassAction, SceneModel, SceneObject } from './types'

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

/** Every class in use, explicit ones first, then types that an `all()` statement names. */
export function classGroups(model: SceneModel): ClassGroup[] {
  return [...model.classes.entries()].map(([className, names]) => ({
    className,
    members: names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o),
    actions: model.classActions.filter((a) => a.className === className),
  }))
}

/** Objects grouped by class name, in registry order, with empty types left out. */
export function typeGroups(objects: SceneObject[]): { className: string; objects: SceneObject[] }[] {
  return TYPE_ORDER.map((className) => ({ className, objects: sortByType(objects.filter((o) => o.className === className)) })).filter((g) => g.objects.length > 0)
}

/** The member actions a class action still drives: those no object replaced with its own. */
export function activeMembers(action: ClassAction): Action[] {
  const active = action.members.filter((m) => !m.overridden)
  return active.length > 0 ? active : action.members
}

/** When a class action runs: from its earliest active member's start to the latest end. */
export function classSpan(action: ClassAction): { start: number; end: number } | null {
  const members = activeMembers(action)
  if (members.length === 0) return null
  return { start: Math.min(...members.map((m) => m.start)), end: Math.max(...members.map((m) => m.end)) }
}

/** Where a class action lives on one of its members: the object and the index there. */
export function memberRef(action: ClassAction): { object: string; index: number } | null {
  const member = activeMembers(action)[0]
  if (!member) return null
  return { object: member.object.name, index: member.object.actions.indexOf(member) }
}

/** The class actions of a group as the actions of one stand-in object, for its opacity lane (D93). */
export function classStandIn(group: ClassGroup, index: number): SceneObject | null {
  const first = group.members[0]
  if (!first) return null
  const actions: Action[] = []
  for (const classAction of group.actions) {
    const member = activeMembers(classAction)[0]
    if (member) actions.push(member)
  }
  // Members that agree on a base opacity share it; otherwise the lane starts from solid.
  const bases = new Set(group.members.map((m) => (typeof m.attrs['opacity'] === 'number' ? (m.attrs['opacity'] as number) : 1)))
  const opacity = bases.size === 1 ? [...bases][0]! : 1
  return { id: -1 - index, name: `all('${group.className}')`, className: first.className, attrs: { opacity }, codeDriven: false, decl: null, actions, classes: [] }
}

/** Among an object's actions, the one that overrides a class action, if any. */
export function overrideOf(obj: SceneObject, classAction: ClassAction): number {
  return obj.actions.findIndex((a) => a.overrides === classAction)
}
