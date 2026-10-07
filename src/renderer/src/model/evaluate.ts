import { CLASS_NAMES, TIMING_KEY_NAMES, VERB_ATTRS, VERB_NAMES, classes, type Verb } from './registry'
import { parseScene } from './parse'
import { samplingContext, valueAt } from './sample'
import type { Action, ActionInfo, AttrSource, SceneError, SceneModel, SceneObject, TimeRef, Timing } from './types'

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

function behindHandle(value: unknown): SceneObject | Action | null {
  if (typeof value !== 'object' || value === null) return null
  const behind = (value as Record<symbol, unknown>)[HANDLE]
  return typeof behind === 'object' && behind !== null ? (behind as SceneObject | Action) : null
}

function isSceneObject(entry: SceneObject | Action): entry is SceneObject {
  return 'className' in entry
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
  const warnings: SceneError[] = []
  const model: SceneModel = { source, objects, actions, contentEnd: null, lastDeclEnd: parsed.lastDeclEnd, warnings }

  const actionHandle = (action: Action): Record<string | symbol, unknown> => ({
    [HANDLE]: action,
    start: timeRef({ kind: 'start', action }),
    end: timeRef({ kind: 'end', action }),
    progress: (fraction: number) => timeRef({ kind: 'progress', action, fraction }),
  })

  const addAction = (obj: SceneObject, verb: Verb, args: unknown[]): Record<string | symbol, unknown> => {
    const props = args.length > 0 ? args[args.length - 1] : {}
    if (typeof props !== 'object' || props === null) throw new Error(`${obj.name}.${verb}() expects a block of attributes`)
    const timing: Timing = {}
    const changes: Record<string, AttrSource> = {}
    const allowed = VERB_ATTRS[verb]
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (TIMING_KEY_NAMES.has(key)) {
        ;(timing as Record<string, unknown>)[key] = value
        continue
      }
      if (!classes[obj.className]?.attrs.some((a) => a.name === key)) {
        warnings.push({ message: `${obj.className} has no attribute "${key}"` })
        continue
      }
      if (allowed && !allowed.includes(key)) {
        warnings.push({ message: `${verb} does not change "${key}"; use to()` })
        continue
      }
      changes[key] = value as AttrSource
    }
    const action: Action = { id: actions.length, object: obj, verb, name: null, changes, timing, start: 0, end: 0, stmt: null, codeDriven: false }
    actions.push(action)
    obj.actions.push(action)
    return actionHandle(action)
  }

  const objectHandle = (obj: SceneObject): unknown => {
    const schema = classes[obj.className]!
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (key === HANDLE) return obj
        if (typeof key !== 'string') return undefined
        if (VERB_NAMES.has(key)) return (...args: unknown[]) => addAction(obj, key as Verb, args)
        if (key === 'appears' || key === 'disappears') return timeRef({ kind: key, object: obj })
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
        appears: 0,
        disappears: null,
        fadeIn: 0,
        fadeOut: 0,
      }
      objects.push(obj)
      return objectHandle(obj)
    }
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
    return { model: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }

  // Tie objects and actions back to the statements that made them.
  const declByName = new Map(parsed.decls.map((d) => [d.name, d]))
  for (const obj of objects) {
    const decl = declByName.get(obj.name)
    if (decl && decl.className === obj.className) {
      obj.decl = decl
      obj.codeDriven = false
    }
  }
  const infosByObject = new Map<string, ActionInfo[]>()
  for (const info of parsed.actions) {
    const list = infosByObject.get(info.objectName) ?? []
    list.push(info)
    infosByObject.set(info.objectName, list)
  }
  for (const obj of objects) {
    const infos = infosByObject.get(obj.name) ?? []
    let next = 0
    for (const action of obj.actions) {
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

  // Resolve when everything happens.
  const resolved = new Map<number, [number, number]>()
  const resolving = new Set<number>()

  const appearsOf = (obj: SceneObject): number => {
    const appear = obj.actions.find((a) => a.verb === 'appear')
    return appear ? resolveAction(appear)[0] : 0
  }
  const disappearsOf = (obj: SceneObject): number | null => {
    const disappear = obj.actions.find((a) => a.verb === 'disappear')
    return disappear ? resolveAction(disappear)[0] : null
  }

  const timeOf = (ref: unknown, fallback: number, what: string): number => {
    if (ref === undefined) return fallback
    if (typeof ref === 'number') return Number.isFinite(ref) ? ref : fallback
    if (!isTimeRef(ref)) throw new Error(`${what} must be seconds or a time reference such as other.end`)
    if (ref.action) {
      const [start, end] = resolveAction(ref.action)
      if (ref.kind === 'start') return start
      if (ref.kind === 'end') return end
      if (ref.kind === 'progress') return start + (end - start) * (ref.fraction ?? 0)
    }
    if (ref.object) {
      if (ref.kind === 'appears') return appearsOf(ref.object)
      if (ref.kind === 'disappears') return disappearsOf(ref.object) ?? fallback
    }
    throw new Error(`${what} is not a usable time reference`)
  }

  function resolveAction(action: Action): [number, number] {
    const memo = resolved.get(action.id)
    if (memo) return memo
    const label = `${action.object.name}.${action.verb}`
    if (resolving.has(action.id)) throw new Error(`${label} depends on its own timing`)
    resolving.add(action.id)
    const index = action.object.actions.indexOf(action)
    const previous = index > 0 ? action.object.actions[index - 1] : undefined
    const fallbackStart = previous ? resolveAction(previous)[1] : 0
    const start = timeOf(action.timing.at, fallbackStart, `${label} at`) + (action.timing.delay ?? 0)
    let duration: number
    if (action.verb === 'appear' || action.verb === 'disappear') duration = 0
    else if (action.timing.until !== undefined) duration = Math.max(0, timeOf(action.timing.until, start, `${label} until`) - start)
    else duration = Math.max(0, action.timing.duration ?? 1)
    const result: [number, number] = [start, start + duration]
    resolved.set(action.id, result)
    resolving.delete(action.id)
    action.start = result[0]
    action.end = result[1]
    return result
  }

  try {
    for (const action of actions) resolveAction(action)
    for (const obj of objects) {
      obj.appears = appearsOf(obj)
      obj.disappears = disappearsOf(obj)
      obj.fadeIn = Math.max(0, obj.actions.find((a) => a.verb === 'appear')?.timing.fadeIn ?? 0)
      obj.fadeOut = Math.max(0, obj.actions.find((a) => a.verb === 'disappear')?.timing.fadeOut ?? 0)
    }
  } catch (err) {
    return { model: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }

  let end = 0
  let any = false
  for (const action of actions) {
    end = Math.max(end, action.end)
    any = true
  }
  for (const obj of objects) if (obj.disappears !== null) end = Math.max(end, obj.disappears)
  model.contentEnd = any ? end : null

  return { model, error: null }
}

export { isSceneObject }
