import type { BlockInfo, PropInfo, SceneModel } from './types'

/** A written value in another statement that refers to a name about to disappear. */
export interface Dependent {
  /** The object that owns the statement. */
  owner: string
  /** Index of the action in its object, or null for the object's own declaration. */
  index: number | null
  key: string
  prop: PropInfo
  block: BlockInfo
  label: string
}

function mentions(raw: string, names: string[]): boolean {
  return names.some((name) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(raw))
}

/**
 * Everything in other statements that refers to any of these names: time references such as
 * `at: slide.end` and links such as `x: () => box.x`. Statements being removed are skipped.
 */
export function findDependents(model: SceneModel, names: string[], removing: { objects: string[]; actions: { object: string; index: number }[] }): Dependent[] {
  const out: Dependent[] = []
  const removedActions = new Set(removing.actions.map((a) => `${a.object}:${a.index}`))
  for (const obj of model.objects) {
    if (removing.objects.includes(obj.name)) continue
    if (obj.decl) {
      for (const prop of obj.decl.props) {
        if (prop.kind === 'literal' || !mentions(prop.raw, names)) continue
        out.push({ owner: obj.name, index: null, key: prop.key, prop, block: obj.decl, label: `${obj.name}: ${prop.key}` })
      }
    }
    obj.actions.forEach((action, index) => {
      if (!action.stmt || removedActions.has(`${obj.name}:${index}`)) return
      for (const prop of action.stmt.props) {
        if (prop.kind === 'literal' || !mentions(prop.raw, names)) continue
        out.push({ owner: obj.name, index, key: prop.key, prop, block: action.stmt, label: `${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}: ${prop.key}` })
      }
    })
  }
  return out
}
