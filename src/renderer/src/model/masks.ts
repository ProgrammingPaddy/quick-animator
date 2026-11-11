import { groupMembers } from './groups'
import { CLASS_NAMES, GROUP } from './registry'
import type { Mask, SceneModel, SceneObject } from './types'

/** The words a mask's list holds beside names (D331, D345): everything beneath it in the layers, everything over it, the word before the names it lets out, and the word for a mask that masks nothing. */
export const MASK_BELOW = 'below'
export const MASK_ABOVE = 'above'
export const MASK_EXCEPT = 'except'
export const MASK_NONE = 'none'
export const MASK_WORDS: ReadonlySet<string> = new Set([MASK_BELOW, MASK_ABOVE, MASK_EXCEPT, MASK_NONE])

/** Whether a written `masks` makes its object a mask (D345): a list that is not empty. Unset or empty, the default, it is no mask. */
export function isMaskList(written: unknown): written is string {
  return typeof written === 'string' && written.trim() !== ''
}

/** A mask's list as written, `'below title except backdrop'`: what it takes in, then what it lets out. */
export interface MaskScope {
  names: string[]
  except: string[]
}

export function parseScope(text: string): MaskScope {
  const words = text.split(/\s+/).filter((w) => w !== '' && w !== MASK_NONE)
  const cut = words.indexOf(MASK_EXCEPT)
  if (cut < 0) return { names: words, except: [] }
  return { names: words.slice(0, cut), except: words.slice(cut + 1).filter((w) => w !== MASK_EXCEPT) }
}

/** A list as written; one that takes nothing in is `none`, since an empty one is no mask (D345). */
export function formatScope(scope: MaskScope): string {
  if (scope.names.length === 0) return MASK_NONE
  return [...scope.names, ...(scope.except.length > 0 ? [MASK_EXCEPT, ...scope.except] : [])].join(' ')
}

/**
 * The objects one word of a mask's list names (D331): the layers beneath the mask or over it, an
 * object, everything a group carries, or every member of a class or a type; null when it names
 * nothing.
 */
export function maskWord(model: SceneModel, owner: SceneObject, word: string): string[] | null {
  if (word === MASK_BELOW) return model.objects.filter((o) => o.id < owner.id && o.className !== GROUP).map((o) => o.name)
  if (word === MASK_ABOVE) return model.objects.filter((o) => o.id > owner.id && o.className !== GROUP).map((o) => o.name)
  const obj = model.objects.find((o) => o.name === word)
  if (obj) return obj.className === GROUP ? groupMembers(model, obj.name) : [obj.name]
  const members = model.objects.filter((o) => o.className !== GROUP && (o.className === word || o.classes.includes(word)))
  return members.length > 0 || CLASS_NAMES.has(word) ? members.map((o) => o.name) : null
}

/** Everything a list of words names, each object once. */
function reach(model: SceneModel, owner: SceneObject, words: string[]): Set<string> {
  const out = new Set<string>()
  for (const word of words) for (const name of maskWord(model, owner, word) ?? []) out.add(name)
  return out
}

/**
 * The masks of a scene (D331, D336): every object that carries `masks`, with the objects that
 * draw its picture, itself or everything a group carries, and the objects it hides outside that
 * picture. A group's members are its picture before they are masks of their own, and no mask's
 * picture is ever hidden by a mask.
 */
export function resolveMasks(model: SceneModel, warn: (message: string, about: SceneObject) => void): Mask[] {
  // An empty list, the default, is no mask (D345); anything else written there is one, or is told it is no list.
  const carriers = model.objects.filter((o) => 'masks' in o.attrs && (typeof o.attrs['masks'] !== 'string' || isMaskList(o.attrs['masks'])))
  if (carriers.length === 0) return []
  const drawnBy = new Map<string, string>()
  const masks: { mask: Mask; owner: SceneObject }[] = []
  for (const groups of [true, false]) {
    for (const owner of carriers) {
      if ((owner.className === GROUP) !== groups) continue
      if (typeof owner.attrs['masks'] !== 'string') {
        warn(`${owner.name}: masks is names in a string, such as 'below' or 'title logo'`, owner)
        continue
      }
      const holder = drawnBy.get(owner.name)
      if (holder) {
        warn(`${owner.name} is part of the mask ${holder}: its own masks is dropped`, owner)
        continue
      }
      const shapes = (groups ? groupMembers(model, owner.name) : [owner.name]).filter((n) => !drawnBy.has(n))
      for (const name of shapes) drawnBy.set(name, owner.name)
      masks.push({ owner, mask: { name: owner.name, shapes, targets: [], inverted: owner.attrs['inverted'] === true } })
    }
  }
  masks.sort((a, b) => a.owner.id - b.owner.id)
  for (const { mask, owner } of masks) {
    const scope = parseScope(owner.attrs['masks'] as string)
    for (const word of [...scope.names, ...scope.except]) if (maskWord(model, owner, word) === null) warn(`${owner.name} masks nothing named "${word}"`, owner)
    const taken = reach(model, owner, scope.names)
    const out = reach(model, owner, scope.except)
    mask.targets = model.objects.filter((o) => taken.has(o.name) && !out.has(o.name) && !drawnBy.has(o.name)).map((o) => o.name)
  }
  return masks.map((m) => m.mask)
}

interface MaskIndex {
  /** Each mask by its own name, and by each object of its picture. */
  byName: Map<string, Mask>
  byShape: Map<string, Mask>
  /** The masks that hide each object. */
  byTarget: Map<string, Mask[]>
}

const indexes = new WeakMap<SceneModel, MaskIndex>()

function indexOf(model: SceneModel): MaskIndex {
  let index = indexes.get(model)
  if (!index) {
    index = { byName: new Map(), byShape: new Map(), byTarget: new Map() }
    for (const mask of model.masks) {
      index.byName.set(mask.name, mask)
      for (const name of mask.shapes) index.byShape.set(name, mask)
      for (const name of mask.targets) index.byTarget.set(name, [...(index.byTarget.get(name) ?? []), mask])
    }
    indexes.set(model, index)
  }
  return index
}

/** The mask a name is: the object or the group that carries `masks`, or null. */
export function maskNamed(model: SceneModel, name: string): Mask | null {
  return indexOf(model).byName.get(name) ?? null
}

/** The mask an object draws for, itself or the group it is part of, or null: such an object is drawn nowhere else. */
export function maskDrawnBy(model: SceneModel, name: string): Mask | null {
  return indexOf(model).byShape.get(name) ?? null
}

/** The mask a name stands for in the panes: the mask itself, or the one its picture belongs to. */
export function maskFor(model: SceneModel, name: string): Mask | null {
  return maskNamed(model, name) ?? maskDrawnBy(model, name)
}

const NONE: Mask[] = []

/** The masks that hide an object, in the order of the layers. */
export function masksOn(model: SceneModel, name: string): Mask[] {
  return indexOf(model).byTarget.get(name) ?? NONE
}

/**
 * A mask's list with some things taken in or let out (D333), written the shortest way. Each
 * thing is a name: an object, a group, or a class. Taken in, it leaves the names let out, and
 * joins the list unless the list already reaches all of it; let out, it leaves the list, and
 * goes after `except` when the list still reaches any of it through a word, a group, or a class.
 */
export function scopeWith(model: SceneModel, mask: Mask, text: string, things: string[], on: boolean): string {
  const owner = model.objects.find((o) => o.name === mask.name)
  if (!owner) return text
  const scope = parseScope(text)
  const of = (word: string): string[] => maskWord(model, owner, word) ?? []
  for (const thing of things) {
    const mine = new Set(of(thing))
    if (mine.size === 0) continue
    const within = (word: string): boolean => {
      const names = of(word)
      return names.length > 0 && names.every((n) => mine.has(n))
    }
    if (on) {
      // A wider name let out, such as its class, is let out one by one instead, without this.
      scope.except = [...new Set(scope.except.flatMap((word) => (within(word) ? [] : of(word).some((n) => mine.has(n)) ? of(word).filter((n) => !mine.has(n)) : [word])))]
      const reached = reach(model, owner, scope.names)
      if (![...mine].every((n) => reached.has(n))) scope.names.push(thing)
    } else {
      scope.names = scope.names.filter((word) => word === MASK_BELOW || word === MASK_ABOVE || !within(word))
      const reached = reach(model, owner, scope.names)
      if ([...mine].some((n) => reached.has(n)) && !scope.except.includes(thing)) scope.except.push(thing)
    }
  }
  // A name let out that the list no longer reaches says nothing.
  const reached = reach(model, owner, scope.names)
  scope.except = scope.except.filter((word) => of(word).some((n) => reached.has(n)))
  return formatScope(scope)
}

/** A mask's list with names changed, or dropped where the new name is null: what a rename or a removal leaves it as. */
export function scopeRenamed(text: string, renames: Readonly<Record<string, string | null>>): string {
  const swap = (words: string[]): string[] => words.flatMap((w) => (MASK_WORDS.has(w) || !(w in renames) ? [w] : renames[w] === null ? [] : [renames[w]!]))
  const scope = parseScope(text)
  return formatScope({ names: swap(scope.names), except: swap(scope.except) })
}
