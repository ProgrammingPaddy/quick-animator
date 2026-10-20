import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { showMenu } from '../components/ContextMenu'
import { PresetPreview } from '../components/PresetPreview'
import { labelOn, VERB_COLORS } from '../model/registry'
import { addObject } from '../project/operations'
import { ANIMATION_PRESETS, applyAnimationPreset, dropTime, presetById, userAnimationPreset, type AnimationPreset } from '../project/presets'
import { addUserObject, applyClassPreset, deleteUserPreset } from '../project/userPresets'
import { dropTargets } from '../state/dropTargets'
import { OBJECT_KINDS, useStore, type ObjectKind, type UserPreset } from '../state/store'

/** The width of a preset's clip in the pane, before it stretches to its length over the timeline. */
const CARD_W = 96
/** How big an object's thumbnail is against the object itself. */
const THUMB_SCALE = 0.15
const GROUP_FILL = 'rgba(168, 85, 247, 0.45)'
const CLASS_COLOR = '#64748b'

/** How an object is drawn, for its picture and its ghost: its size, its fill, whether it is round or outlined, and its word when it is a Text. */
interface Look {
  width: number
  height: number
  fill: string
  round: boolean
  outline?: boolean
  text?: string
  /** A polygon, as the corners of its box in percent, for a Shape's picture (D232). */
  polygon?: string
}
/** How an object of each kind looks when new, as addObject writes it (D222). */
const OBJECT_LOOK: Record<ObjectKind, Look> = {
  Rect: { width: 240, height: 140, fill: '#4f8cff', round: false },
  Circle: { width: 120, height: 120, fill: '#f59e0b', round: true },
  Text: { width: 106, height: 58, fill: '#ffffff', round: false, text: 'Text' },
  Shape: { width: 120, height: 100, fill: '#4f8cff', round: false, polygon: '50% 0%, 100% 100%, 0% 100%' },
}

/** A list of points as the corners of its box in percent, for a picture; up is up on screen (D232). */
function polygonOf(points: number[][]): string | undefined {
  const valid = points.filter((p) => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
  if (valid.length < 3) return undefined
  const xs = valid.map((p) => p[0]!)
  const ys = valid.map((p) => p[1]!)
  const w = Math.max(...xs) - Math.min(...xs) || 1
  const h = Math.max(...ys) - Math.min(...ys) || 1
  return valid.map((p) => `${Math.round(((p[0]! - Math.min(...xs)) / w) * 100)}% ${Math.round(((Math.max(...ys) - p[1]!) / h) * 100)}%`).join(', ')
}

/** How one of the user's objects or groups looks, from what its declaration says, else as its kind looks new (D227). */
function lookOf(p: UserPreset): Look {
  if (p.kind === 'group') return { width: p.size?.width ?? 240, height: p.size?.height ?? 140, fill: GROUP_FILL, round: false, outline: true }
  const kind = (p.className ?? 'Rect') as ObjectKind
  const base = OBJECT_LOOK[kind] ?? OBJECT_LOOK.Rect
  const l = p.look ?? {}
  if (kind === 'Circle') {
    const d = (l.radius ?? base.width / 2) * 2
    return { ...base, width: d, height: d, fill: l.fill ?? base.fill }
  }
  if (kind === 'Text') {
    const size = l.fontSize ?? 48
    const text = l.text ?? 'Text'
    return { ...base, width: Math.max(1, size * 0.55 * text.length), height: size * 1.2, fill: l.fill ?? base.fill, text }
  }
  if (kind === 'Shape') return { ...base, width: p.size?.width ?? base.width, height: p.size?.height ?? base.height, fill: l.fill ?? base.fill, polygon: (l.points && polygonOf(l.points)) ?? base.polygon }
  return { ...base, width: l.width ?? base.width, height: l.height ?? base.height, fill: l.fill ?? base.fill }
}

interface Drag {
  kind: 'animation' | 'object' | 'class'
  id: string
  /** One of the user's own (D227). */
  user: boolean
  variant?: string
  label: string
  color: string
  duration: number
  look: Look
  x: number
  y: number
  /** Whether the pointer has gone far enough for a drag, as opposed to a click. */
  moved: boolean
  over: 'timeline' | 'preview' | null
  /** The ghost's size right now: the card's, a clip's length at the timeline's scale, or an object's size at the preview's zoom (D219, D222). */
  width: number
  height: number
}

/** A still picture of an object as it will be when added: the shape at a scale, or the word for a Text (D222). */
function ObjectImage({ look, scale }: { look: Look; scale: number }) {
  if (look.text) {
    return (
      <span className="object-image text" style={{ fontSize: Math.max(8, (look.height / 1.2) * scale), color: look.fill }}>
        {look.text}
      </span>
    )
  }
  return <span className="object-image" style={{ width: Math.max(2, look.width * scale), height: Math.max(2, look.height * scale), background: look.fill, borderRadius: look.round ? '50%' : look.polygon ? 0 : Math.max(1, 6 * scale), border: look.outline ? '1px solid rgba(168, 85, 247, 0.9)' : undefined, clipPath: look.polygon ? `polygon(${look.polygon})` : undefined }} />
}

/**
 * The presets, under the objects (D217, D219, D222, D227): a search box, then three collapsible
 * lists. Animations: a play mark, the name with its variations under it, and the animation as
 * the clip it will be on the timeline; click to apply it to the selected objects at its place,
 * drag it onto a clip in the timeline or an object in the preview. Objects: a still picture of
 * what each adds; click to add it at the middle of the view, drag it into the preview or onto
 * the timeline. Yours: the user's own, saved from the right-click menus, of all those kinds and
 * classes too, which click onto the selection or drop onto an object.
 */
export function PresetsPane() {
  const selection = useStore((s) => s.selection)
  const model = useStore((s) => s.model)
  const userPresets = useStore((s) => s.userPresets)
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [variants, setVariants] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<Drag | null>(null)
  const [preview, setPreview] = useState<{ id: string; variant: string | undefined; label: string; left: number; top: number; pinned: boolean } | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const targets = selection.filter((name) => model?.objects.some((o) => o.name === name && o.decl))
  const variantOf = (p: AnimationPreset): string | undefined => (p.variants ? (variants[p.id] ?? p.variants[0]!.id) : undefined)
  const q = query.trim().toLowerCase()
  const matches = (words: string[]): boolean => q === '' || words.join(' ').toLowerCase().includes(q)
  const animations = ANIMATION_PRESETS.filter((p) => matches([p.label, p.id, p.verb, ...(p.variants?.map((v) => v.label) ?? [])]))
  const objects = OBJECT_KINDS.filter((k) => matches([k]))
  const yours = userPresets.filter((p) => matches([p.label, p.kind, p.verb ?? '', p.className ?? '']))

  /** Apply to the selected objects, each at the preset's default place (D219). */
  const applyToSelection = (p: AnimationPreset) => {
    if (targets.length === 0) return
    applyAnimationPreset(p.id, variantOf(p), targets.map((object) => ({ object, time: null })))
  }

  /** Add an object of a kind, or one of the user's own, at a place and time (D219, D227). */
  const addKind = (d: { id: string; user: boolean }, x: number, y: number, at?: number) => {
    if (d.user) {
      const p = userPresets.find((u) => u.id === d.id)
      if (p) addUserObject(p, x, y, at)
    } else addObject(d.id as ObjectKind, x, y, at)
  }

  /** Where a drag ended, and what that means (D219, D222, D227). */
  const drop = (d: Drag, clientX: number, clientY: number) => {
    const tl = dropTargets.timeline?.(clientX, clientY)
    const pv = dropTargets.preview?.(clientX, clientY)
    const now = useStore.getState()
    if (d.kind === 'animation') {
      if (tl?.inside && tl.object) applyAnimationPreset(d.id, d.variant, [{ object: tl.object, time: tl.time }])
      else if (pv?.inside && pv.hit) {
        const preset = presetById(d.id)
        const obj = now.model?.objects.find((o) => o.name === pv.hit)
        if (preset && obj) applyAnimationPreset(d.id, d.variant, [{ object: obj.name, time: dropTime(preset, obj, now.time) }])
      }
      return
    }
    if (d.kind === 'class') {
      const p = userPresets.find((u) => u.id === d.id)
      const onto = tl?.inside && tl.object ? tl.object : pv?.inside && pv.hit ? pv.hit : null
      if (p && onto) applyClassPreset(p, [onto])
      return
    }
    if (pv?.inside) addKind(d, pv.world.x, pv.world.y)
    else if (tl?.inside) {
      const center = dropTargets.previewCenter?.() ?? { x: 0, y: 0 }
      addKind(d, center.x, center.y, tl.time)
    }
  }

  const beginDrag = (start: Omit<Drag, 'x' | 'y' | 'moved' | 'over' | 'width' | 'height'>, onClick: () => void) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const origin = { x: e.clientX, y: e.clientY }
    const base = start.kind === 'object' ? { width: 28, height: 28 } : { width: CARD_W, height: 20 }
    let current: Drag = { ...start, x: e.clientX, y: e.clientY, moved: false, over: null, ...base }
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onMove = (ev: PointerEvent) => {
      if (!current.moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 4) return
      const tl = dropTargets.timeline?.(ev.clientX, ev.clientY)
      const pv = dropTargets.preview?.(ev.clientX, ev.clientY)
      const over: Drag['over'] = tl?.inside ? 'timeline' : pv?.inside ? 'preview' : null
      let size = base
      if (start.kind === 'animation') {
        // Over the timeline the clip takes its real length at the timeline's scale, with a pop (D219).
        if (over === 'timeline' && tl) size = { width: Math.max(40, Math.round(start.duration * tl.pps)), height: 20 }
      } else if (start.kind === 'object' && over === 'timeline' && tl) {
        // An object becomes the clip it will be: as long as a new object lasts, at the timeline's scale (D222).
        const length = useStore.getState().prefs.objectLength ?? 2
        size = { width: Math.max(40, Math.round(length * tl.pps)), height: 34 }
      } else if (start.kind === 'object' && over === 'preview' && pv) {
        // In the preview it becomes the object itself, at the preview's scale (D222).
        size = { width: Math.max(4, Math.round(start.look.width * pv.zoom)), height: Math.max(4, Math.round(start.look.height * pv.zoom)) }
      }
      current = { ...current, x: ev.clientX, y: ev.clientY, moved: true, over, ...size }
      setDrag(current)
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setDrag(null)
      if (current.moved) drop(current, ev.clientX, ev.clientY)
      else onClick()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const showPreview = (p: AnimationPreset, el: HTMLElement, pinned: boolean) => {
    // Beside the pane, like a menu, so the list stays readable.
    const r = el.getBoundingClientRect()
    const pane = el.closest('.pane')?.getBoundingClientRect()
    setPreview({ id: p.id, variant: variantOf(p), label: `${p.label}${p.variants ? ` ${p.variants.find((v) => v.id === variantOf(p))?.label ?? ''}` : ''}`, left: (pane?.right ?? r.right) + 8, top: r.top - 8, pinned })
  }
  const onPlayEnter = (p: AnimationPreset) => (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => showPreview(p, el, false), 220)
  }
  const onPlayLeave = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setPreview((v) => (v && !v.pinned ? null : v))
  }

  /** Right-click on one of the user's own: take it out (D227). */
  const userMenu = (p: UserPreset) => (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    showMenu(e, [{ label: 'Delete preset', keyword: p.label, run: () => deleteUserPreset(p.id), danger: true }])
  }

  /** The ghost's place and size: an animation's clip by the pointer, an object centered on it in the preview, a clip from it on the timeline, else its card (D222). */
  const ghostStyle = (d: Drag): CSSProperties => {
    if (d.kind !== 'object') return { left: d.x - 10, top: d.y - 10, width: d.width, height: d.height, background: d.color, color: labelOn(d.color) }
    if (d.over === 'preview') return { left: d.x - d.width / 2, top: d.y - d.height / 2, width: d.width, height: d.height }
    if (d.over === 'timeline') return { left: d.x, top: d.y - 10, width: d.width, height: d.height }
    return { left: d.x - 14, top: d.y - 14, width: d.width, height: d.height }
  }
  const ghostContent = (d: Drag) => {
    if (d.kind !== 'object') return d.label
    if (d.over === 'preview') return <ObjectImage look={d.look} scale={d.width / d.look.width} />
    if (d.over === 'timeline') {
      const kind = d.user ? (userPresets.find((u) => u.id === d.id)?.className ?? 'Group') : d.id
      return (
        <span className="ghost-clip">
          <span className="ghost-clip-title">
            <span className="name">{d.label.toLowerCase()}</span>
            <span className="kind">{kind}</span>
          </span>
        </span>
      )
    }
    return <ObjectImage look={d.look} scale={THUMB_SCALE} />
  }

  /** A collapsible category: its name folds and unfolds it (owner, 2026-10-18). */
  const section = (key: string, title: string, children: ReactNode) => (
    <div className="presets-section">
      <button type="button" className="presets-title" onClick={() => setFolded((f) => ({ ...f, [key]: !f[key] }))} aria-expanded={!folded[key]}>
        <span className="caret">{folded[key] ? '▸' : '▾'}</span>
        {title}
      </button>
      {!folded[key] && children}
    </div>
  )

  /** One animation's row: the play mark, the name with its variations, and the clip to drag (D219). */
  const animationRow = (p: AnimationPreset, user: boolean, onContextMenu?: (e: ReactMouseEvent) => void) => {
    const color = VERB_COLORS[p.verb]
    const variant = variantOf(p)
    return (
      <div key={p.id} className="preset-row" onContextMenu={onContextMenu}>
        <button
          className={`preset-play${preview?.id === p.id ? ' on' : ''}`}
          title="Preview"
          aria-label={`Preview ${p.label}`}
          onPointerEnter={onPlayEnter(p)}
          onPointerLeave={onPlayLeave}
          onClick={(e) => (preview?.id === p.id && preview.pinned ? setPreview(null) : showPreview(p, e.currentTarget, true))}
        >
          ▶
        </button>
        <div className="preset-text">
          <span className="name" title={p.title}>
            {p.label}
          </span>
          {p.variants && (
            <select className="variant" value={variant} onChange={(e) => setVariants((v) => ({ ...v, [p.id]: e.target.value }))}>
              {p.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="preset-card" style={{ background: color, color: labelOn(color), width: CARD_W }} title={p.title} onPointerDown={beginDrag({ kind: 'animation', id: p.id, user, variant, label: user ? p.label : p.id, color, duration: p.duration, look: OBJECT_LOOK.Rect }, () => applyToSelection(p))}>
          <span className="ident">{user ? p.label : p.id}</span>
          {p.verb}
        </div>
      </div>
    )
  }

  /** One object's row: its name and its picture to drag (D222). */
  const objectRow = (id: string, label: string, look: Look, user: boolean, kind: string, onContextMenu?: (e: ReactMouseEvent) => void) => (
    <div key={id} className="preset-row" onContextMenu={onContextMenu}>
      <span />
      <div className="preset-text">
        <span className="name">{label}</span>
      </div>
      <div
        className="preset-card object"
        title={user ? `${kind}: add it` : `Add a ${label}`}
        onPointerDown={beginDrag({ kind: 'object', id, user, label, color: '#3b82f6', duration: 0, look }, () => {
          const center = dropTargets.previewCenter?.() ?? { x: 0, y: 0 }
          addKind({ id, user }, center.x, center.y)
        })}
      >
        <ObjectImage look={look} scale={THUMB_SCALE} />
      </div>
    </div>
  )

  /** One of the user's classes: its name as a chip to click onto the selection or drop onto an object (D227). */
  const classRow = (p: UserPreset) => (
    <div key={p.id} className="preset-row" onContextMenu={userMenu(p)}>
      <span />
      <div className="preset-text">
        <span className="name">{p.label}</span>
      </div>
      <div className="preset-card class" style={{ background: CLASS_COLOR, color: labelOn(CLASS_COLOR), width: CARD_W }} title={`Class ${p.className}`} onPointerDown={beginDrag({ kind: 'class', id: p.id, user: true, label: p.className ?? p.label, color: CLASS_COLOR, duration: 0, look: OBJECT_LOOK.Rect }, () => targets.length > 0 && applyClassPreset(p, targets))}>
        <span className="ident">{p.className}</span>
        class
      </div>
    </div>
  )

  return (
    <div className="presets-body">
      <input className="presets-search" type="search" value={query} placeholder="Search" aria-label="Search presets" onChange={(e) => setQuery(e.target.value)} />
      <div className="presets-scroll">
        {animations.length > 0 && section('animations', 'Animations', <div className="presets-list">{animations.map((p) => animationRow(p, false))}</div>)}
        {objects.length > 0 && section('objects', 'Objects', <div className="presets-list presets-objects">{objects.map((k) => objectRow(k, k, OBJECT_LOOK[k], false, k))}</div>)}
        {yours.length > 0 &&
          section(
            'yours',
            'Yours',
            <div className="presets-list presets-yours">
              {yours.map((p) => {
                if (p.kind === 'animation') {
                  const preset = userAnimationPreset(p)
                  return preset ? animationRow(preset, true, userMenu(p)) : null
                }
                if (p.kind === 'class') return classRow(p)
                return objectRow(p.id, p.label, lookOf(p), true, p.kind === 'group' ? 'Group' : (p.className ?? 'Object'), userMenu(p))
              })}
            </div>,
          )}
        {animations.length === 0 && objects.length === 0 && yours.length === 0 && <div className="presets-empty dim">Nothing matches</div>}
      </div>
      {drag &&
        drag.moved &&
        createPortal(
          <div className={`preset-ghost${drag.kind === 'object' ? ' object' : ''}${drag.over ? ` over-${drag.over}` : ''}`} style={ghostStyle(drag)}>
            {ghostContent(drag)}
          </div>,
          document.body,
        )}
      {preview && createPortal(<PresetPreview id={preview.id} variant={preview.variant} left={preview.left} top={preview.top} label={preview.label} />, document.body)}
    </div>
  )
}
