import { CLASS_NAMES, GROUP, TIMING_KEY_NAMES, VERB_ALIASES, VERB_ATTRS, VERB_NAMES, VERB_PARAMS, canonicalVerb, classes, type Verb } from './registry'
import { parseScene } from './parse'
import { forgetSampling, samplingContext, stateStretches, valueAt, type Stretch } from './sample'
import { STATE_DIRECTIONS, STATE_NAMES, type Action, type ActionInfo, type AttrSource, type ClassAction, type SceneError, type SceneModel, type SceneObject, type StateDirection, type StateName, type TimeRef, type Timing } from './types'

/** Links a handle (what user code holds) to the model entry behind it. */
const HANDLE = Symbol('handle')
/** Marks a stand-in for a name that is only declared further down (D148). */
const FORWARD = Symbol('forward')

/** The 1-based line of a position in the source. */
function lineAt(source: string, pos: number): number {
  return source.slice(0, Math.max(0, pos)).split('\n').length
}

/** An error raised while resolving times, carrying the line of the statement it came from. */
class TimingError extends Error {
  constructor(
    message: string,
    readonly line: number | undefined,
  ) {
    super(message)
  }
}

/** A name used before its declaration in a way that needs the declaration (D148). */
class ForwardUseError extends Error {
  constructor(
    readonly name: string,
    readonly key: string | null,
  ) {
    super(`${name} is not defined`)
  }
}

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
export function evaluateScene(source: string, fps = 60): EvaluateResult {
  const parsed = parseScene(source, CLASS_NAMES, VERB_NAMES)
  // A statement written with an old name for a verb is the verb it now means, and remembers the name for a note (D211).
  for (const info of parsed.actions) {
    const meant = VERB_ALIASES[info.verb]
    if (meant) {
      info.alias = info.verb
      info.verb = meant
    }
  }
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
  /** Warnings raised while the script runs, tied to what raised them once statements are known, so each can say its line (D149). */
  const raised: { message: string; about: Action | ClassAction | SceneObject | null }[] = []
  const warn = (message: string, about: Action | ClassAction | SceneObject | null = null): void => {
    raised.push({ message, about })
  }
  /** Every warning raised since `mark` that nothing has claimed belongs to `about`. */
  const claim = (mark: number, about: Action | ClassAction | SceneObject): void => {
    for (let i = mark; i < raised.length; i++) if (!raised[i]!.about) raised[i]!.about = about
  }
  /** Actions whose `overrides` names a class action declared further down, applied once the script has run (D148). */
  const deferredOverrides: { action: Action; name: string }[] = []
  const model: SceneModel = { source, objects, actions, classActions, classes: new Map(), groups: new Map(), lastActionEnd: null, lastUntil: null, contentEnd: null, lastDeclEnd: parsed.lastDeclEnd, warnings }

  const actionHandle = (own: Action[], behind: Action | ClassAction): Record<string | symbol, unknown> => ({
    [HANDLE]: behind,
    start: timeRef({ kind: 'start', actions: own }),
    end: timeRef({ kind: 'end', actions: own }),
    progress: (fraction: number) => timeRef({ kind: 'progress', actions: own, fraction }),
  })

  const readBlock = (owner: string, verb: Verb, className: string, args: unknown[]): { timing: Timing; changes: Record<string, AttrSource>; from: Record<string, AttrSource>; overrides: unknown } => {
    const props = args.length > 0 ? args[args.length - 1] : {}
    if (typeof props !== 'object' || props === null) throw new Error(`${owner}.${verb}() expects a block of attributes`)
    const timing: Timing = {}
    const changes: Record<string, AttrSource> = {}
    const from: Record<string, AttrSource> = {}
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
        // Only a group pivots: for anything else the point is meaningless and is dropped with a note. A path's shape and its settings belong to any object's path (D192).
        if (className === GROUP || verb === 'path') changes[key] = value as AttrSource
        else warn(`${owner}.${verb}: ${key} applies to a group's ${verb}`)
        continue
      }
      if (!classes[className]?.attrs.some((a) => a.name === key)) {
        warn(`${className} has no attribute "${key}"`)
        continue
      }
      if (allowed && !allowed.includes(key)) {
        warn(`${verb} does not change "${key}"; use to()`)
        continue
      }
      // A range, `[from, to]`: the action begins from the first instead of where the object is (D221). A path's pairs are points, never ranges.
      if (verb !== 'path' && Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        from[key] = value[0]
        changes[key] = value[1]
        continue
      }
      changes[key] = value as AttrSource
    }
    return { timing, changes, from, overrides }
  }

  const makeAction = (obj: SceneObject, verb: Verb, block: { timing: Timing; changes: Record<string, AttrSource>; from: Record<string, AttrSource> }, classAction: ClassAction | null): Action => {
    const action: Action = { id: actions.length, object: obj, verb, name: null, changes: block.changes, from: block.from, timing: block.timing, start: 0, end: 0, stmt: null, codeDriven: false, classAction, overrides: null, overridden: false }
    actions.push(action)
    obj.actions.push(action)
    return action
  }

  /** `overrides: rise` switches the class action off for this object; this action stands in for it. */
  const applyOverride = (action: Action, value: unknown): void => {
    const obj = action.object
    const target = behindHandle(value)
    const classAction = target && 'members' in target ? target : null
    const member = classAction?.members.find((m) => m.object === obj)
    if (!classAction) warn(`${obj.name}.${action.verb}: overrides must name a class action, such as rise = all('bars').move(...)`, action)
    else if (!member) warn(`${obj.name} is not a member of all('${classAction.className}'); nothing to override`, action)
    else {
      member.overridden = true
      action.overrides = classAction
    }
  }

  const addAction = (obj: SceneObject, verb: Verb, args: unknown[]): Record<string | symbol, unknown> => {
    const mark = raised.length
    const block = readBlock(obj.name, verb, obj.className, args)
    // A path is nothing without its shape: points, or a function of the progress (D192).
    if (verb === 'path' && !('shape' in block.changes)) warn(`${obj.name}.path needs a shape: points [[x, y], ...] or a function of the progress, (p) => [x, y]`)
    const action = makeAction(obj, verb, block, null)
    claim(mark, action)
    if (block.overrides !== undefined) {
      const forward = forwardName(block.overrides)
      if (forward !== null) deferredOverrides.push({ action, name: forward })
      else applyOverride(action, block.overrides)
    }
    return actionHandle([action], action)
  }

  /** `all('name').verb({ ... })`: one action per member declared so far. */
  const addClassAction = (className: string, verb: Verb, args: unknown[]): Record<string | symbol, unknown> => {
    const classAction: ClassAction = { id: classActions.length, className, verb, name: null, stmt: null, members: [] }
    classActions.push(classAction)
    const mark = raised.length
    for (const obj of objects) {
      if (!isMember(obj, className)) continue
      // Each member reads the block against its own class, so a Text member ignores `radius`.
      const block = readBlock(`all('${className}')`, verb, obj.className, args)
      classAction.members.push(makeAction(obj, verb, block, classAction))
    }
    claim(mark, classAction)
    if (classAction.members.length === 0) warn(`all('${className}') has no members yet; declare objects with class: '${className}' above it`, classAction)
    return actionHandle(classAction.members, classAction)
  }

  /**
   * A state of an object as a handle (D212): `box.moving` is its first stretch of moving, with
   * `start`, `end`, and `progress(f)`; `box.moving[2]` its second and `box.moving.last` its last;
   * `box.moving.right` the stretches of moving right, and `box.turning.clockwise` likewise.
   */
  const stateHandle = (obj: SceneObject, name: StateName, direction: StateDirection | undefined, index: number | 'last'): unknown =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (typeof key !== 'string') return undefined
        const ref = (part: 'start' | 'end' | 'progress', fraction?: number) => timeRef({ kind: 'state', actions: [], object: obj, state: { name, direction, index, part }, fraction })
        if (key === 'start' || key === 'end') return ref(key)
        if (key === 'progress') return (fraction: number) => ref('progress', fraction)
        if (key === 'last') return stateHandle(obj, name, direction, 'last')
        if (/^\d+$/.test(key)) return stateHandle(obj, name, direction, Math.max(1, Number(key)))
        if (direction === undefined && (STATE_DIRECTIONS[name] as readonly string[] | undefined)?.includes(key)) return stateHandle(obj, name, key as StateDirection, index)
        return undefined
      },
    })

  const objectHandle = (obj: SceneObject): unknown => {
    const schema = classes[obj.className]!
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (key === HANDLE) return obj
        if (typeof key !== 'string') return undefined
        if (VERB_NAMES.has(key)) return (...args: unknown[]) => addAction(obj, canonicalVerb(key)!, args)
        if (key === 'name') return obj.name
        // When the object begins and when it is removed, as time references (D138).
        if (key === 'start' || key === 'end') return timeRef({ kind: key === 'start' ? 'objectStart' : 'objectEnd', actions: [], object: obj })
        // What the object is doing, as time references worked out once the file has run (D212).
        if ((STATE_NAMES as readonly string[]).includes(key)) return stateHandle(obj, key as StateName, undefined, 1)
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
      const mark = raised.length
      for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
        if (!schema.attrs.some((a) => a.name === key)) {
          warn(`${className} has no attribute "${key}"`)
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
        groups: [],
        at: 0,
        until: null,
      }
      objects.push(obj)
      claim(mark, obj)
      return objectHandle(obj)
    }
  }

  /**
   * A stand-in for a name that is not declared yet (D148): its times, `start`, `end`, and
   * `progress`, can be referred to now and are looked up once the whole script has run. Anything
   * else about it needs the declaration first, and says so.
   */
  const forwardNames = new Set<string>()
  const forwardHandle = (name: string): unknown => {
    forwardNames.add(name)
    const target = (): void => {}
    return new Proxy(target as unknown as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (key === FORWARD) return name
        if (typeof key !== 'string' || key.startsWith('__') || key === 'then' || key === 'toJSON' || key === 'valueOf' || key === 'toString') return undefined
        if (key === 'name') return name
        if (key === 'start' || key === 'end') return timeRef({ kind: 'forward', actions: [], forward: { name, part: key } })
        if (key === 'progress') return (fraction: number) => timeRef({ kind: 'forward', actions: [], fraction, forward: { name, part: 'progress' } })
        throw new ForwardUseError(name, key)
      },
      apply() {
        throw new ForwardUseError(name, null)
      },
    })
  }
  const forwardName = (value: unknown): string | null => {
    if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return null
    const name = (value as Record<symbol, unknown>)[FORWARD]
    return typeof name === 'string' ? name : null
  }
  api['all'] = (className: unknown) => {
    if (typeof className !== 'string' || !className) throw new Error("all() expects a class name, as in all('logos')")
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, key) {
        if (typeof key === 'string' && VERB_NAMES.has(key)) return (...args: unknown[]) => addClassAction(className, canonicalVerb(key)!, args)
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
        // Not declared yet: a stand-in, checked once the script has run (D148).
        return forwardHandle(key)
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
    if (err instanceof ForwardUseError) {
      // Declared further down, or not at all: the first use says which line.
      const declaredBelow = parsed.decls.some((d) => d.name === err.name) || parsed.actions.some((a) => a.name === err.name)
      const message = !declaredBelow
        ? `${err.name} is not defined`
        : err.key === null
          ? `${err.name} is declared further down: move its declaration above this line`
          : VERB_NAMES.has(err.key)
            ? `${err.name}.${err.key} is used above ${err.name}'s declaration: move the declaration up`
            : `${err.name}.${err.key} is used above ${err.name}'s declaration: move the declaration up, or use a link such as () => ${err.name}.${err.key}`
      return { model: null, error: { message, line: lineOfName(source, `${err.name} is not defined`) } }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { model: null, error: { message, line: lineOfName(source, message) } }
  }
  for (const name of forwardNames) {
    if (!(name in names)) return { model: null, error: { message: `${name} is not defined`, line: lineOfName(source, `${name} is not defined`) } }
  }
  for (const { action, name } of deferredOverrides) applyOverride(action, names[name])

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
  // Groups list their members by name: objects, classes (every member), or other groups (D124).
  for (const group of objects) {
    if (group.className !== GROUP) continue
    const written = group.attrs['members']
    const names = typeof written === 'string' ? written.split(/\s+/).filter(Boolean) : []
    const members: string[] = []
    for (const name of names) {
      if (name === group.name) {
        warn(`${group.name} cannot be its own member`, group)
        continue
      }
      const target = objects.find((o) => o.name === name)
      if (target) members.push(target.name)
      else if (model.classes.has(name)) members.push(...model.classes.get(name)!)
      else if (CLASS_NAMES.has(name)) members.push(...objects.filter((o) => o.className === name && o !== group).map((o) => o.name))
      else warn(`${group.name} has no member named "${name}"`, group)
    }
    const unique = [...new Set(members)]
    model.groups.set(group.name, unique)
    for (const name of unique) objects.find((o) => o.name === name)!.groups.push(group.name)
  }
  // A group inside itself, through any number of others, carries nothing: the loop is cut where it closes.
  for (const group of objects) {
    if (group.className !== GROUP) continue
    const trail = [group.name]
    const reaches = (name: string): boolean => {
      for (const outer of objects.find((o) => o.name === name)!.groups) {
        if (outer === group.name) return true
        if (trail.includes(outer)) continue
        trail.push(outer)
        if (reaches(outer)) return true
        trail.pop()
      }
      return false
    }
    if (reaches(group.name)) {
      warn(`${group.name} contains itself through ${trail.slice(1).join(', ')}`, group)
      const last = trail[trail.length - 1]!
      model.groups.set(last, (model.groups.get(last) ?? []).filter((n) => n !== group.name))
      group.groups = group.groups.filter((n) => n !== last)
    }
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
        // An old name for the verb still runs, and says so at its line (D211).
        if (info.alias) warn(`${obj.name}.${info.alias} is now ${action.verb}: write ${obj.name}.${action.verb}({ ... })`, action)
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
  const resolving = new Set<number | string>()
  const lifetimes = new Map<number, { at: number; until: number | null }>()
  const states = new Map<string, Stretch[]>()

  /**
   * The stretches of a state (D212). Everything not already being worked out is worked out
   * first, so the object's values can be sampled; an animation of the object itself that waits on
   * this state is a loop, and says so. The sampler's memory is dropped after, since what it saw may
   * still change.
   */
  function statesOf(obj: SceneObject, name: StateName, direction: StateDirection | undefined): Stretch[] {
    const key = `${obj.id}:${name}:${direction ?? ''}`
    const memo = states.get(key)
    if (memo) return memo
    for (const other of objects) if (!resolving.has(`object ${other.id}`)) resolveLifetime(other)
    for (const action of actions) if (!resolving.has(action.id)) resolveAction(action)
    for (const action of obj.actions) {
      if (!action.overridden && resolving.has(action.id)) {
        const stmt = action.stmt ?? action.classAction?.stmt ?? null
        throw new TimingError(`${obj.name}.${action.verb} waits on ${obj.name}.${name}, which it is part of`, stmt ? lineAt(source, stmt.range.from) : undefined)
      }
    }
    const stretches = stateStretches(model, obj, name, direction, fps)
    forgetSampling(model)
    states.set(key, stretches)
    return stretches
  }

  const timeOf = (ref: unknown, fallback: number, what: string): number => {
    if (ref === undefined) return fallback
    if (typeof ref === 'number') return Number.isFinite(ref) ? ref : fallback
    if (!isTimeRef(ref)) throw new Error(`${what} must be seconds or a time reference such as other.end`)
    if (ref.kind === 'forward' && ref.forward) {
      // The name is declared by now: its handle gives the real reference (D148).
      const { name, part } = ref.forward
      const handle = names[name] as Record<string, unknown> | undefined
      const real = handle === undefined || handle === null ? undefined : part === 'progress' ? (handle['progress'] as ((f: number) => unknown) | undefined)?.(ref.fraction ?? 0) : handle[part]
      if (!isTimeRef(real)) throw new Error(`${what}: ${name}.${part} is not a time; ${name} must be an object or an animation`)
      return timeOf(real, fallback, what)
    }
    if (ref.kind === 'state' && ref.state && ref.object) {
      // A state is read off the finished timeline (D212): every other animation is worked out first, and this one sees its own object's.
      const { name, direction, index, part } = ref.state
      const stretches = statesOf(ref.object, name, direction)
      const label = `${ref.object.name}.${name}${direction ? `.${direction}` : ''}`
      const stretch = index === 'last' ? stretches[stretches.length - 1] : stretches[index - 1]
      if (!stretch) throw new Error(stretches.length === 0 ? `${what}: ${ref.object.name} is never ${name}${direction ? ` ${direction}` : ''}` : `${what}: ${label} happens ${stretches.length} ${stretches.length === 1 ? 'time' : 'times'}, so there is no ${label}[${index}]`)
      if (part === 'start') return stretch.start
      if (part === 'end') return stretch.end
      return stretch.start + (stretch.end - stretch.start) * (ref.fraction ?? 0)
    }
    if (ref.kind === 'objectStart' || ref.kind === 'objectEnd') {
      if (!ref.object) return fallback
      const life = resolveLifetime(ref.object)
      if (ref.kind === 'objectStart') return life.at
      if (life.until !== null) return life.until
      // Without `until`, an object ends when its last action does, or when it begins if it has none.
      const own = ref.object.actions.filter((a) => !a.overridden)
      return own.length > 0 ? Math.max(...own.map((a) => resolveAction(a)[1])) : life.at
    }
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

  /** When an object begins and ends (D138): `at` and `until` on its declaration, seconds or time references; a group has neither. */
  function resolveLifetime(obj: SceneObject): { at: number; until: number | null } {
    const memo = lifetimes.get(obj.id)
    if (memo) return memo
    const key = `object ${obj.id}`
    const line = obj.decl ? lineAt(source, obj.decl.range.from) : undefined
    if (resolving.has(key)) throw new TimingError(`${obj.name} depends on its own timing`, line)
    resolving.add(key)
    let at: number
    let until: number | null
    try {
      at = Math.max(0, timeOf(obj.attrs['at'], 0, `${obj.name} at`))
      const rawUntil = obj.attrs['until']
      until = rawUntil === undefined ? null : timeOf(rawUntil, at, `${obj.name} until`)
    } catch (err) {
      throw err instanceof TimingError ? err : new TimingError(err instanceof Error ? err.message : String(err), line)
    }
    if (until !== null && until <= at) throw new TimingError(`${obj.name} is removed at ${until}, before it begins at ${at}`, line)
    const life = { at, until }
    lifetimes.set(obj.id, life)
    resolving.delete(key)
    obj.at = at
    obj.until = until
    return life
  }

  function resolveAction(action: Action): [number, number] {
    const memo = resolved.get(action.id)
    if (memo) return memo
    const label = `${action.object.name}.${action.verb}`
    const stmt = action.stmt ?? action.classAction?.stmt ?? null
    const line = stmt ? lineAt(source, stmt.range.from) : undefined
    if (resolving.has(action.id)) throw new TimingError(`${label} depends on its own timing`, line)
    resolving.add(action.id)
    const index = action.object.actions.indexOf(action)
    let previous: Action | undefined
    for (let i = index - 1; i >= 0 && !previous; i--) if (!action.object.actions[i]!.overridden) previous = action.object.actions[i]
    // Without `at`, an action follows the one before it, which is worked out first, and the first starts when the object begins (D138). With `at`, the one before is left alone, so a later animation that waits on a state is no loop through it (D212).
    const fallbackStart = action.timing.at === undefined && previous ? resolveAction(previous)[1] : resolveLifetime(action.object).at
    let start: number
    let duration: number
    try {
      start = timeOf(action.timing.at, fallbackStart, `${label} at`) + (action.timing.delay ?? 0)
      duration = action.timing.until !== undefined ? Math.max(0, timeOf(action.timing.until, start, `${label} until`) - start) : Math.max(0, action.timing.duration ?? 1)
    } catch (err) {
      throw err instanceof TimingError ? err : new TimingError(err instanceof Error ? err.message : String(err), line)
    }
    const result: [number, number] = [start, start + duration]
    resolved.set(action.id, result)
    resolving.delete(action.id)
    action.start = result[0]
    action.end = result[1]
    return result
  }

  try {
    for (const action of actions) resolveAction(action)
    for (const obj of objects) resolveLifetime(obj)
  } catch (err) {
    // Errors from resolving say the line of the statement whose time could not be worked out (D149).
    return { model: null, error: { message: err instanceof Error ? err.message : String(err), line: err instanceof TimingError ? err.line : undefined } }
  }

  let end: number | null = null
  for (const action of actions) if (!action.overridden) end = Math.max(end ?? 0, action.end)
  model.lastActionEnd = end
  // An action outside its object's lifetime does nothing visible: allowed, and said (D138).
  for (const obj of objects) {
    if (obj.until !== null) model.lastUntil = Math.max(model.lastUntil ?? 0, obj.until)
    for (const action of obj.actions) {
      if (action.overridden) continue
      const label = `${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}`
      if (obj.at > 0 && action.end <= obj.at) warn(`${label} ends before ${obj.name} begins at ${obj.at}`, action)
      else if (obj.until !== null && action.start >= obj.until) warn(`${label} starts after ${obj.name} is removed at ${obj.until}`, action)
    }
  }
  const last = Math.max(model.lastActionEnd ?? -Infinity, model.lastUntil ?? -Infinity)
  model.contentEnd = Number.isFinite(last) ? last : null
  // Every warning says the line of what raised it, where that is known (D149).
  const positionOf = (about: Action | ClassAction | SceneObject | null): number | undefined => {
    if (!about) return undefined
    if ('members' in about) return about.stmt?.range.from
    if ('verb' in about) return (about.stmt ?? about.classAction?.stmt)?.range.from
    return about.decl?.range.from
  }
  for (const r of raised) {
    const pos = positionOf(r.about)
    warnings.push(pos === undefined ? { message: r.message } : { message: r.message, line: lineAt(source, pos) })
  }

  return { model, error: null }
}
