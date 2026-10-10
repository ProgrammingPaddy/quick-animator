import { classes, GROUP } from './registry'
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

/**
 * The classes as a tree (D99, D107): a class nests under the smallest class that holds all its
 * members, and an object sits under every class it belongs to that is not an ancestor of another
 * of its classes, so an object in two sibling classes appears under both, marked as a twin.
 * Objects in no class come after the tree, in declaration order.
 */
export interface ClassNode {
  group: ClassGroup
  depth: number
  children: ClassNode[]
  objects: SceneObject[]
}

export interface ClassTree {
  roots: ClassNode[]
  /** Objects that belong to no class. */
  objects: SceneObject[]
  /** For objects shown in more than one place, the classes they appear under. */
  twins: Map<string, string[]>
}

export function classTree(model: SceneModel): ClassTree {
  const groups = classGroups(model)
  const sets = new Map(groups.map((g) => [g.className, new Set(g.members.map((m) => m.name))]))
  const size = (g: ClassGroup) => sets.get(g.className)!.size
  const order = (g: ClassGroup) => groups.indexOf(g)
  const covers = (outer: ClassGroup, inner: ClassGroup) => [...sets.get(inner.className)!].every((n) => sets.get(outer.className)!.has(n))
  const nodes = new Map(groups.map((g) => [g.className, { group: g, depth: 0, children: [], objects: [] } as ClassNode]))
  const roots: ClassNode[] = []
  for (const g of groups) {
    let parent: ClassGroup | null = null
    for (const other of groups) {
      if (other === g || size(other) < size(g) || (size(other) === size(g) && order(other) > order(g)) || !covers(other, g)) continue
      if (!parent || size(other) < size(parent) || (size(other) === size(parent) && order(other) < order(parent))) parent = other
    }
    if (parent) nodes.get(parent.className)!.children.push(nodes.get(g.className)!)
    else roots.push(nodes.get(g.className)!)
  }
  const parentOf = new Map<string, string | null>()
  for (const node of nodes.values()) for (const child of node.children) parentOf.set(child.group.className, node.group.className)
  const isAncestor = (a: string, b: string): boolean => {
    for (let p = parentOf.get(b) ?? null; p; p = parentOf.get(p) ?? null) if (p === a) return true
    return false
  }
  const free: SceneObject[] = []
  const twins = new Map<string, string[]>()
  for (const obj of model.objects) {
    const mine = groups.filter((g) => sets.get(g.className)!.has(obj.name))
    const leaves = mine.filter((g) => !mine.some((other) => other !== g && isAncestor(g.className, other.className)))
    if (leaves.length === 0) free.push(obj)
    for (const g of leaves) nodes.get(g.className)!.objects.push(obj)
    if (leaves.length > 1) twins.set(obj.name, leaves.map((g) => g.className))
  }
  const setDepth = (node: ClassNode, depth: number) => {
    node.depth = depth
    for (const child of node.children) setDepth(child, depth + 1)
  }
  for (const root of roots) setDepth(root, 0)
  return { roots, objects: free, twins }
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
  return { id: -1 - index, name: `all('${group.className}')`, className: first.className, attrs: { opacity }, codeDriven: false, decl: null, actions, classes: [], groups: [] }
}

/** Among an object's actions, the one that overrides a class action, if any. */
export function overrideOf(obj: SceneObject, classAction: ClassAction): number {
  return obj.actions.findIndex((a) => a.overrides === classAction)
}

/** The dim words before a class action's verb: its class, then its name. The same everywhere (D100). */
export function classActionIdents(classAction: ClassAction): string[] {
  return classAction.name ? [classAction.className, classAction.name] : [classAction.className]
}

/** The dim words before an action's verb, the same wherever the action is shown (D100). */
export function actionIdents(action: Action): string[] {
  if (action.classAction) return classActionIdents(action.classAction)
  if (action.overrides) return classActionIdents(action.overrides)
  return action.name ? [action.name] : []
}

/** Every object a group carries, through member groups too, each once (D124). */
export function groupMembers(model: SceneModel, name: string, seen = new Set<string>()): string[] {
  seen.add(name)
  const out: string[] = []
  for (const member of model.groups.get(name) ?? []) {
    if (seen.has(member)) continue
    const obj = model.objects.find((o) => o.name === member)
    if (!obj) continue
    if (obj.className === GROUP) {
      for (const inner of groupMembers(model, member, seen)) if (!out.includes(inner)) out.push(inner)
    } else {
      seen.add(member)
      out.push(member)
    }
  }
  return out
}

/** The group that exactly these objects make up, if one exists: by the names it lists, or by everything it carries. The latest declared wins (D124). */
export function groupFor(model: SceneModel, names: string[]): string | null {
  const wanted = new Set(names)
  if (wanted.size === 0) return null
  const same = (list: string[]) => list.length === wanted.size && list.every((n) => wanted.has(n))
  let found: string | null = null
  for (const obj of model.objects) {
    if (obj.className !== GROUP || wanted.has(obj.name)) continue
    if (same(model.groups.get(obj.name) ?? []) || same(groupMembers(model, obj.name))) found = obj.name
  }
  return found
}

/** Every name a group carries, directly or through member groups: objects and groups alike. */
export function groupCarries(model: SceneModel, name: string, seen = new Set<string>()): string[] {
  seen.add(name)
  const out: string[] = []
  for (const member of model.groups.get(name) ?? []) {
    if (seen.has(member)) continue
    seen.add(member)
    out.push(member)
    const obj = model.objects.find((o) => o.name === member)
    if (obj?.className === GROUP) out.push(...groupCarries(model, member, seen))
  }
  return out
}

/**
 * What a list of names selects (D124): a name carried by a selected group drops out, since the
 * group already stands for it, and exactly a group's members become that group, so one set of
 * objects is one selection wherever it was picked.
 */
export function normalizeSelection(model: SceneModel, names: string[]): string[] {
  const unique = names.filter((n, i) => names.indexOf(n) === i)
  const covered = new Set<string>()
  for (const name of unique) {
    const obj = model.objects.find((o) => o.name === name)
    if (obj?.className === GROUP) for (const inner of groupCarries(model, name)) covered.add(inner)
  }
  const kept = unique.filter((n) => !covered.has(n))
  if (kept.length < 2) return kept
  const group = groupFor(model, kept)
  return group ? [group] : kept
}
