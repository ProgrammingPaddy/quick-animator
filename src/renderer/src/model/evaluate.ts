import { CLASS_NAMES, TIMING_KEY_NAMES, VERB_ATTRS, VERB_NAMES, VERB_PARAMS, classes, type Verb } from './registry'
import { parseScene } from './parse'
import { samplingContext, valueAt } from './sample'
import type { Action, ActionInfo, AttrSource, ClassAction, SceneError, SceneModel, SceneObject, TimeRef, Timing } from './types'

/** Links a handle (what user code holds) to the model entry behind it. */
const HANDLE = Symbol('handle')

export interface EvaluateResult {
  model: SceneModel | null
  error: SceneError | null
}

function isTimeRef(value: unknown): value is TimeRef {
  return typeof value === 'object' && value !== null && (value as TimeRef).__timeRef === true
}

function timeRef(partial: Omit<TimeRef, '__timeRef'>): TimeRef {
  return { __timeRef: true, ...partial }
}

function behindHandle(value: unknown): SceneObject | Action | ClassAction | null {
  if (typeof value !== 'object' || value === null) return null
  const behind = (value as Record<symbol, unknown>)[HANDLE]
  return typeof behind === 'object' && behind !== null ? (behind as SceneObject | Action | ClassAction) : null
}

/** For "x is not defined" and "x is not a function", the line of the first use of x. */
function lineOfName(source: string, message: string): number | undefined {
  const match = /^([A-Za-z_$][\w$]*) is not (?:defined|a function)/.exec(message)
  if (!match) return undefined
  const name = match[1]!
  const use = new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'm').exec(source)
  if (!use) return undefined
  const pos = use.index + use[1]!.length
  return source.slice(0, pos).split('\n').length
}

function classNamesOf(attrs: Record<string, AttrSource>): string[] {
  const value = attrs['class']
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

/** An object belongs to its own classes and to its type: `all('Rect')` is every rectangle (D80). */
export function isMember(obj: SceneObject, name: string): boolean {
  return obj.className === name || obj.classes.includes(name)
}

/**
 * Run a scene file and build the model (architecture: "The round trip" and "Evaluation").
 * The file runs as plain JavaScript inside a scope that already holds every class, so nothing is
 * imported, and a bare `name = Circle({ ... })` names the object (decision D48).
 */
export function evaluateScene(source: string): EvaluateResult {
  const parsed = parseScene(source, CLASS_NAMES, VERB_NAMES)
  if (parsed.error) return { model: null, error: { message: parsed.error.message, line: parsed.error.line } }

  // Blank out `const` and friends in front of recognised statements so every name is assigned
  // through the scope. Positions stay the same, so the parse map stays valid.
  let runnable = source
  for (const info of [...parsed.decls, ...parsed.actions]) {
    const kw = info.keywordRange
    if (kw) runnable = runnable.slice(0, kw.from) + ' '.repeat(kw.to - kw.from) + runnable.slice(kw.to)
  }

  const objects: SceneObject[] = []
  const actions: Action[] = []
  const classActions: ClassAction[] = []
  const warnings: SceneError[] = []
  const model: SceneModel = { source, objects, actions, classActions, classes: new Map(), lastActionEnd: null, lastDeclEnd: parsed.lastDeclEnd, warnings }

  const actionHandle = (own: Action[], behind: Action | ClassAction): Record<string | symbol, unknown> => ({
    [HANDLE]: behind,
    start: timeRef({ kind: 'start', actions: own }),
    end: timeRef({ kind: 'end', actions: own }),
    progress: (fraction: number) => timeRef({ kind: 'progress', actions: own, fraction }),
  })

  const readBlock = (owner: string, verb: Verb, className: string, args: unknown[]): { timing: Timing; changes: Record<string, AttrSource>; overrides: unknown } => {
    const props = args.length > 0 ? args[args.length - 1] : {}
    if (typeof props !== 'object' || props === null) throw new Error(`${owner}.${verb}() expects a block of attributes`)
    const timing: Timing = {}
    const changes: Record<string, AttrSource> = {}
    let overrides: unknown
    const allowed = VERB_ATTRS[verb]
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (key === 'overrides') {
        overrides = value
        continue
      }
      if (TIMING_KEY_NAMES.has(key)) {
        if (key === 'relative') timing.relative = Boolean(value)
        else (timing as Record<string, unknown>)[key] = value
        continue
      }
      if (VERB_PARAMS[verb].includes(key)) {
        changes[key] = value as AttrSource
        continue
      }
      if (!classes[className]?.attrs.some((a) => a.name === key)) {
        warnings.push({ message: `${className} has no attribute "${key}"` })
        continue
      }
      if (allowed && !allowed.includes(key)) {
        warnings.push({ message: `${verb} does not change "${key}"; use to()` })
        continue
      }
      changes[key] = value as AttrSource
    }
    return { timing, changes, overrides }
  }

  const makeAction = (obj: SceneObject, verb: Verb, block: { timing: Timing; changes: Record<string, AttrSource> }, classAction: ClassAction | null): Action => {
    const action: Action = { id: actions.length, object: obj, verb, name: null, changes: block.changes, timing: block.timing, start: 0, end: 0, stmt: null, codeDriven: false, classAction, overrides: null, overridden: false }
    actions.push(action)
    obj.actions.push(action)
    return action
  }

  const addAction = (obj: SceneObject, verb: Verb, args: unknown[]): Record<string | symbol, unknown> => {
    const block = readBlock(obj.name, verb, obj.className, args)
    const action = makeAction(obj, verb, block, null)
    if (block.overrides !== undefined) {
      // `overrides: rise` switches the class action off for this object; this action stands in for it.
      const target = behindHandle(block.overrides)
      const classAction = target && 'members' in target ? target : null
      const member = classAction?.members.find((m) => m.object === obj)
      if (!classAction) warnings.push({ message: `${obj.name}.${verb}: overrides must name a class action, such as rise = all('bars').move(...)` })
      else if (!member) warnings.push({ message: `${obj.name} is not a member of all('${classAction.className}'); nothing to override` })
      else {
        member.overridden = true
        action.overrides = classAction
      }
    }
    return actionHandle([action], action)
  }

  /** `all('name').verb({ ... })`: one action per member declared so far. */
  const addClassAction = (className: string, verb: Verb, args: unknown[]): Record<string | symbol, unknown> => {
    const classAction: ClassAction = { id: classActions.length, className, verb, name: null, stmt: null, members: [] }
    classActions.push(classAction)
    for (const obj of objects) {
      if (!isMember(obj, className)) continue
      // Each member reads the block against its own class, so a Text member ignores `radius`.
      const block = readBlock(`all('${className}')`, verb, obj.className, args)
      classAction.members.push(makeAction(obj, verb, block, classAction))
    }
    if (classAction.members.length === 0) warnings.push({ message: `all('${className}') has no members yet; declare objects with class: '${className}' above it` })
    return actionHandle(classAction.members, classAction)
  }

  const objectHandle = (obj: SceneObject): unknown => {
    const schema = classes[obj.className]!
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (key === HANDLE) return obj
        if (typeof key !== 'string') return undefined
        if (VERB_NAMES.has(key)) return (...args: unknown[]) => addAction(obj, key as Verb, args)
        if (key === 'name') return obj.name
        const attr = schema.attrs.find((a) => a.name === key)
        if (attr) {
          if (samplingContext.model) return valueAt(samplingContext.model, obj, key, samplingContext.time)
          const base = obj.attrs[key]
          return typeof base === 'function' || base === undefined ? attr.default : base
        }
        return undefined
      },
      set() {
        throw new Error('Set attributes in the cast, or change them with an action')
      },
    })
  }

  const api: Record<string, unknown> = {}
  for (const className of Object.keys(classes)) {
    api[className] = (props: unknown = {}) => {
      if (typeof props !== 'object' || props === null) throw new Error(`${className}({ ... }) expects a block of attributes`)
      const schema = classes[className]!
      const attrs: Record<string, AttrSource> = {}
      for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
        if (!schema.attrs.some((a) => a.name === key)) {
          warnings.push({ message: `${className} has no attribute "${key}"` })
          continue
        }
        attrs[key] = value as AttrSource
      }
      const obj: SceneObject = {
        id: objects.length,
        name: `${className.toLowerCase()}${objects.length + 1}`,
        className,
        attrs,
        codeDriven: true,
        decl: null,
        actions: [],
        classes: classNamesOf(attrs),
      }
      objects.push(obj)
      return objectHandle(obj)
    }
  }
  api['all'] = (className: unknown) => {
    if (typeof className !== 'string' || !className) throw new Error("all() expects a class name, as in all('logos')")
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (typeof key === 'string' && VERB_NAMES.has(key)) return (...args: unknown[]) => addClassAction(className, key as Verb, args)
        return undefined
      },
    })
  }

  const names: Record<string, unknown> = {}
  const scope = new Proxy(
    {},
    {
      has: () => true,
      get(_target, key) {
        if (typeof key !== 'string') return undefined
        if (key in api) return api[key]
        if (key in names) return names[key]
        if (key in globalThis) return (globalThis as unknown as Record<string, unknown>)[key]
        throw new ReferenceError(`${key} is not defined`)
      },
      set(_target, key, value) {
        if (typeof key !== 'string') return true
        names[key] = value
        const behind = behindHandle(value)
        if (behind) behind.name = key
        return true
      },
    },
  )

  try {
    const run = new Function('__scope', `with (__scope) {\n${runnable}\n}`) as (scope: unknown) => void
    run(scope)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { model: null, error: { message, line: lineOfName(source, message) } }
  }

  // Tie objects and actions back to the statements that made them.
  const declByName = new Map(parsed.decls.map((d) => [d.name, d]))
  for (const obj of objects) {
    const decl = declByName.get(obj.name)
    if (decl && decl.className === obj.className) {
      obj.decl = decl
      obj.codeDriven = false
    }
    for (const name of obj.classes) {
      const members = model.classes.get(name) ?? []
      members.push(obj.name)
      model.classes.set(name, members)
    }
  }
  // A class that only an `all()` statement names, such as a type, groups every object it covers.
  for (const classAction of classActions) {
    if (model.classes.has(classAction.className)) continue
    model.classes.set(
      classAction.className,
      objects.filter((o) => isMember(o, classAction.className)).map((o) => o.name),
    )
  }
  const infosByObject = new Map<string, ActionInfo[]>()
  const infosByClass = new Map<string, ActionInfo[]>()
  for (const info of parsed.actions) {
    const key = info.className !== undefined ? infosByClass : infosByObject
    const id = info.className ?? info.objectName
    const list = key.get(id) ?? []
    list.push(info)
    key.set(id, list)
  }
  for (const obj of objects) {
    const infos = infosByObject.get(obj.name) ?? []
    let next = 0
    for (const action of obj.actions) {
      if (action.classAction) continue
      const info = infos[next]
      if (info && info.verb === action.verb) {
        action.stmt = info
        if (info.name && !action.name) action.name = info.name
        next++
      } else {
        action.codeDriven = true
      }
    }
  }
  const classNext = new Map<string, number>()
  for (const classAction of classActions) {
    const infos = infosByClass.get(classAction.className) ?? []
    const next = classNext.get(classAction.className) ?? 0
    const info = infos[next]
    if (info && info.verb === classAction.verb) {
      classAction.stmt = info
      if (info.name && !classAction.name) classAction.name = info.name
      classNext.set(classAction.className, next + 1)
      for (const member of classAction.members) {
        member.stmt = info
        member.name = classAction.name
      }
    } else {
      for (const member of classAction.members) member.codeDriven = true
    }
  }

  // Resolve when everything happens.
  const resolved = new Map<number, [number, number]>()
  const resolving = new Set<number>()

  const timeOf = (ref: unknown, fallback: number, what: string): number => {
    if (ref === undefined) return fallback
    if (typeof ref === 'number') return Number.isFinite(ref) ? ref : fallback
    if (!isTimeRef(ref)) throw new Error(`${what} must be seconds or a time reference such as other.end`)
    // A class action's time covers the members that still follow it.
    const active = ref.actions.filter((a) => !a.overridden)
    if (active.length === 0) return fallback
    const spans = active.map((a) => resolveAction(a))
    const start = Math.min(...spans.map((s) => s[0]))
    const end = Math.max(...spans.map((s) => s[1]))
    if (ref.kind === 'start') return start
    if (ref.kind === 'end') return end
    return start + (end - start) * (ref.fraction ?? 0)
  }

  function resolveAction(action: Action): [number, number] {
    const memo = resolved.get(action.id)
    if (memo) return memo
    const label = `${action.object.name}.${action.verb}`
    if (resolving.has(action.id)) throw new Error(`${label} depends on its own timing`)
    resolving.add(action.id)
    const index = action.object.actions.indexOf(action)
    let previous: Action | undefined
    for (let i = index - 1; i >= 0 && !previous; i--) if (!action.object.actions[i]!.overridden) previous = action.object.actions[i]
    const fallbackStart = previous ? resolveAction(previous)[1] : 0
    const start = timeOf(action.timing.at, fallbackStart, `${label} at`) + (action.timing.delay ?? 0)
    const duration =
      action.timing.until !== undefined
        ? Math.max(0, timeOf(action.timing.until, start, `${label} until`) - start)
        : Math.max(0, action.timing.duration ?? 1)
    const result: [number, number] = [start, start + duration]
    resolved.set(action.id, result)
    resolving.delete(action.id)
    action.start = result[0]
    action.end = result[1]
    return result
  }

  try {
    for (const action of actions) resolveAction(action)
  } catch (err) {
    return { model: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }

  let end: number | null = null
  for (const action of actions) if (!action.overridden) end = Math.max(end ?? 0, action.end)
  model.lastActionEnd = end

  return { model, error: null }
}
