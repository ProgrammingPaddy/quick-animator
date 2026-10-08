import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { valueAt } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { addObject, adjustDurations, beginTimed, deleteObjects, duplicateObjects, inProgressActions, jumpToObject, overrideClassAction, requestClasses, requestRename, resizeAttrs, resizedValues, setActionDestination, setAttrsAtMany, setLastActionTarget } from '../project/operations'
import { SceneRenderer, type Frame, type Handle } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { TRANSFORM_MODES, useStore, type Tool, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']
const MODE_LABEL: Record<TransformMode, string> = { all: 'Transform', move: 'Move', rotate: 'Rotate', resize: 'Resize' }
const MODE_TIP: Record<TransformMode, string> = {
  all: 'Every handle: drag the body to move, a corner or an edge to resize, the handle above to rotate. Shift makes the drag an animation.',
  move: 'Dragging moves. Shift makes it an animation.',
  rotate: 'Dragging turns the selection around its center. Shift makes it an animation.',
  resize: 'Corners resize both sides, edges resize one; hold Alt to keep the proportions. Shift makes it an animation.',
}
const BASE_ATTRS = ['x', 'y', 'rotation', 'width', 'height', 'radius', 'fontSize']

interface Drag {
  /** `plain`: edit the values at the playhead. `timed`: Shift, make an action. `destination`: the selected action's end follows. */
  kind: 'plain' | 'timed' | 'destination'
  op: 'move' | 'rotate' | 'resize'
  /** The objects the gesture changes: the whole selection, as one group (D96). */
  names: string[]
  primary: string
  handle: Handle | null
  /** Alt at the start: a corner keeps the proportions. */
  keepAspect: boolean
  /** The resize keeps the far side or the center in place (D104). */
  anchor: 'edge' | 'center'
  actionIndex: number
  /** The selected action came from a class statement; the object overrides it when the drag begins (D80). */
  derived: boolean
  /** Where the playhead goes when the drag begins, so the end state being written is what shows (D102). */
  showTime: number | null
  startX: number
  startY: number
  /** The gizmo frame when the drag began: the object's own frame, or the box around the group. */
  frame: Frame
  /** Each object's values at the time being edited, when the drag began. */
  base: Map<string, Record<string, number>>
  /** Each object's center in the gizmo frame's own axes, when the drag began. */
  locals: Map<string, { x: number; y: number }>
  /** The pointer's last angle around the gizmo center, and the turn so far, in radians; turns add up past a full circle (D105). */
  lastAngle: number
  turned: number
  /** Pointer position in the gizmo frame's own axes when a resize began. */
  local0: { x: number; y: number }
  moved: boolean
  created: Set<string>
  /** What a click without movement does. */
  click: 'cycle' | 'object' | 'none'
}

interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}

/** A world point in a frame's own axes: relative to its center, unrotated. */
function toLocal(frame: Frame, p: { x: number; y: number }): { x: number; y: number } {
  const a = (-frame.rotation * Math.PI) / 180
  const dx = p.x - frame.x
  const dy = p.y - frame.y
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A point in a frame's own axes, back in the world. */
function toWorld(frame: Frame, l: { x: number; y: number }): { x: number; y: number } {
  const a = (frame.rotation * Math.PI) / 180
  return { x: frame.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: frame.y + l.x * Math.sin(a) + l.y * Math.cos(a) }
}

function baseValues(model: SceneModel, obj: SceneObject, time: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const attr of BASE_ATTRS) {
    const v = valueAt(model, obj, attr, time)
    out[attr] = typeof v === 'number' ? v : 0
  }
  return out
}

/**
 * The world view. The wheel zooms around the cursor, Shift and the wheel over an object with
 * selected actions changes their durations (D97), otherwise Shift and the wheel pan sideways,
 * Alt and the wheel pan up and down, the middle button drags the view, and scrollbars show
 * where the view sits in a stable area around the frame (D82, D85). Click selects, Ctrl-click
 * adds or removes, a drag on empty space selects what it touches, Ctrl extends (D89), and a
 * click on the selected object cycles the mode (D79). The selection shows handles for its mode
 * (D86), on the one object or on the box around the group (D96): the body moves, corners and
 * edges resize keeping the far side or the center in place (D104), the handle above rotates
 * around the center, past a full turn if dragged on (D105). A drag writes end states directly
 * and shows them: a running action gets its end edited and the playhead moves to that end
 * (D102). Shift-drag makes an animation pinned to start or end here (D27, D103), the wheel
 * then sets its length, and the playhead returns when Shift is released. Snap rounds positions
 * and sizes to a grid and angles to a step (D91). A tool button then a click places an object.
 * Right-click adds objects or acts on the one under the cursor.
 */
export function PreviewPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /** A Shift gesture in progress: the playhead shows the new animation's end and returns here afterwards (D103). */
  const gestureRef = useRef<{ restore: number } | null>(null)
  /** The center rotations turn around, when dragged away from the selection's center, and whether a double-click armed it (D112). Forgotten when the selection changes. */
  const pivotRef = useRef<{ x: number; y: number } | null>(null)
  const pivotArmedRef = useRef(false)
  /** How far a group has been turned since it was selected, so its box turns with it (D116). */
  const groupRotationRef = useRef(0)
  const paintRef = useRef<() => void>(() => undefined)
  const [altDown, setAltDown] = useState(false)
  const [dragging, setDragging] = useState<'aspect' | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const settings = useStore((s) => s.settings)
  const time = useStore((s) => s.time)
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
  const transformMode = useStore((s) => s.transformMode)
  const previewSnap = useStore((s) => s.previewSnap)
  const pin = useStore((s) => s.pin)
  const anchor = useStore((s) => s.anchor)
  const setTool = useStore((s) => s.setTool)
  const setTransformMode = useStore((s) => s.setTransformMode)
  const setPreviewSnap = useStore((s) => s.setPreviewSnap)
  const setPin = useStore((s) => s.setPin)
  const setAnchor = useStore((s) => s.setAnchor)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const viewport = new Viewport(canvas)
    const renderer = new SceneRenderer()
    viewport.content.add(renderer.group)
    viewportRef.current = viewport
    rendererRef.current = renderer

    const paint = () => {
      const s = useStore.getState()
      renderer.update(s.model, s.time, s.selection, s.transformMode, 1 / viewport.zoom, pivotRef.current ? { ...pivotRef.current, armed: pivotArmedRef.current } : pivotArmedRef.current ? { ...(renderer.groupFrame(s.selection, groupRotationRef.current) ?? { x: 0, y: 0 }), armed: true } : null, groupRotationRef.current)
      viewport.render()
    }
    paintRef.current = paint
    viewport.onChange = () => {
      setZoom(viewport.zoom)
      paint()
      bump()
    }
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.selection !== prev.selection) {
        pivotRef.current = null
        pivotArmedRef.current = false
        groupRotationRef.current = 0
      }
      paint()
      if (s.model !== prev.model) bump()
    })
    paint()

    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect()
      viewport.resize(width, height, window.devicePixelRatio)
    })
    observer.observe(host)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const bounds = host.getBoundingClientRect()
      const paneX = e.clientX - bounds.left
      const paneY = e.clientY - bounds.top
      if (e.shiftKey) {
        // Shift and the wheel lengthen or shorten the selected actions, wherever the pointer is
        // (D97, D111). During a Shift gesture the playhead keeps showing the end of what is being made (D103).
        const s = useStore.getState()
        if (s.selectedActions.length === 0) return
        adjustDurations(s.selectedActions, (-Math.sign(e.deltaY) * s.wheelStep) / s.settings.fps, s.pin)
        const after = useStore.getState()
        const primary = after.selectedActions[0]
        const action = primary ? after.model?.objects.find((o) => o.name === primary.object)?.actions[primary.index] : undefined
        if (gestureRef.current && action && after.pin === 'start') after.setTime(action.end)
        return
      }
      if (e.altKey) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) viewport.panBy(e.deltaX, 0)
      else viewport.zoomAt(Math.exp(-e.deltaY * 0.0015), paneX, paneY)
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    // Releasing Shift ends the gesture: the playhead goes back to where it was. Alt held shows
    // that a corner drag keeps the proportions (D113).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false)
      if (e.key !== 'Shift' || !gestureRef.current || dragRef.current) return
      useStore.getState().setTime(gestureRef.current.restore)
      gestureRef.current = null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        setAltDown(true)
      }
    }
    const onBlur = () => setAltDown(false)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)

    return () => {
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      unsubscribe()
      observer.disconnect()
      viewport.dispose()
      viewportRef.current = null
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    viewportRef.current?.setComposition(settings.width, settings.height)
  }, [settings.width, settings.height])

  /** World position and the object under a pointer position in the pane. */
  const locate = (host: HTMLDivElement, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const renderer = rendererRef.current
    if (!viewport || !renderer) return null
    const bounds = host.getBoundingClientRect()
    // A pane that has never been painted (hidden since load) has not reported its size yet.
    if (!viewport.sized) viewport.resize(bounds.width, bounds.height, window.devicePixelRatio)
    const paneX = clientX - bounds.left
    const paneY = clientY - bounds.top
    return { viewport, renderer, bounds, paneX, paneY, world: viewport.toWorld(paneX, paneY), hit: renderer.pick(viewport.camera, viewport.toNdc(paneX, paneY)) }
  }

  const capture = (el: HTMLElement, pointerId: number, onMove: (ev: PointerEvent) => void, onEnd: (ev: PointerEvent) => void) => {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      onEnd(ev)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const host = e.currentTarget
    const viewport = viewportRef.current
    if (!viewport) return

    if (e.button === 1) {
      e.preventDefault()
      host.classList.add('panning')
      let last = { x: e.clientX, y: e.clientY }
      capture(
        host,
        e.pointerId,
        (ev) => {
          viewport.panBy(last.x - ev.clientX, last.y - ev.clientY)
          last = { x: ev.clientX, y: ev.clientY }
        },
        () => host.classList.remove('panning'),
      )
      return
    }
    if (e.button !== 0) return

    const located = locate(host, e.clientX, e.clientY)
    if (!located) return
    const { renderer } = located
    const store = useStore.getState()

    if (store.tool !== 'select') {
      addObject(store.tool, located.world.x, located.world.y)
      store.setTool('select')
      return
    }
    const model = store.model
    if (!model) return

    // A new gesture without Shift ends any Shift gesture still waiting for its key release.
    if (!e.shiftKey && gestureRef.current) {
      store.setTime(gestureRef.current.restore)
      gestureRef.current = null
    }

    const mode = store.transformMode
    const selection = store.selection
    const ctrl = e.ctrlKey || e.metaKey
    // A handle of the selection wins over whatever is drawn under it.
    const handle = selection.length > 0 && !ctrl ? renderer.pickHandle(located.world) : null
    const onPivot = selection.length > 0 && renderer.onPivot(located.world)
    if (handle?.kind !== 'pivot' && pivotArmedRef.current) {
      pivotArmedRef.current = false
      paintRef.current()
    }
    const hit = handle ? (selection.includes(located.hit ?? '') ? located.hit! : selection[0]!) : located.hit

    if (!hit) {
      // Empty space: a drag selects what it touches, a click clears the selection (D89).
      const start = { x: located.paneX, y: located.paneY }
      const extend = ctrl
      let moved = false
      let rect: Marquee | null = null
      capture(
        host,
        e.pointerId,
        (ev) => {
          const bounds = host.getBoundingClientRect()
          const p = { x: ev.clientX - bounds.left, y: ev.clientY - bounds.top }
          if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return
          moved = true
          rect = { x0: start.x, y0: start.y, x1: p.x, y1: p.y }
          setMarquee(rect)
        },
        () => {
          const s = useStore.getState()
          if (!moved || !rect) {
            if (!extend) s.select([])
          } else {
            const a = viewport.toWorld(Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1))
            const b = viewport.toWorld(Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1))
            const names = renderer.objectsIn({ left: a.x, right: b.x, top: a.y, bottom: b.y })
            s.select(extend ? [...s.selection, ...names.filter((n) => !s.selection.includes(n))] : names)
          }
          setMarquee(null)
        },
      )
      return
    }

    if (!handle && ctrl) {
      store.toggleSelected(hit)
      return
    }
    if (handle?.kind === 'pivot') {
      capture(
        host,
        e.pointerId,
        (ev) => {
          const bounds = host.getBoundingClientRect()
          const world = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
          const snap = useStore.getState().previewSnap
          pivotRef.current = snap.on ? { x: snapTo(world.x, snap.grid), y: snapTo(world.y, snap.grid) } : world
          paintRef.current()
        },
        () => undefined,
      )
      return
    }

    // The gesture works on the whole selection when the hit object is part of it, else on the hit object.
    const inSelection = selection.includes(hit)
    const names = handle || inSelection ? selection : [hit]
    if (!inSelection) store.select([hit])
    const objects = names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o)
    if (objects.length === 0) return
    const primary = objects.find((o) => o.name === hit) ?? objects[0]!
    const op: Drag['op'] = handle ? (handle.kind === 'rotate' ? 'rotate' : 'resize') : mode === 'rotate' ? 'rotate' : 'move'
    const group = objects.length > 1
    /** What the gesture is about: positions, the angle, or the size. A match here makes a selected action the target. */
    const primaryAttrs = (obj: SceneObject): string[] => (op === 'move' ? ['x', 'y'] : op === 'rotate' ? ['rotation'] : resizeAttrs(obj.className))

    let kind: Drag['kind'] = e.shiftKey ? 'timed' : 'plain'
    let actionIndex = -1
    let derived = false
    let showTime: number | null = null
    const selected = store.selectedActions.find((r) => r.object === primary.name)
    const selectedAction = selected ? primary.actions[selected.index] : undefined
    if (!e.shiftKey && !group && selectedAction && primaryAttrs(primary).some((a) => a in selectedAction.changes)) {
      kind = 'destination'
      actionIndex = selected!.index
      derived = !!selectedAction.classAction
      showTime = selectedAction.end
    } else if (!e.shiftKey) {
      // Dragging something mid-animation edits that animation's end state, and shows it (D102).
      const running = inProgressActions(names, [...primaryAttrs(primary), ...(op === 'resize' ? ['x', 'y'] : [])], store.time)
      if (running.length > 0) {
        showTime = Math.max(...running.map((r) => model.objects.find((o) => o.name === r.object)!.actions[r.index]!.end))
        store.selectActions(running)
      }
    }
    const sampleTime = kind === 'destination' ? selectedAction!.end : store.time
    const drawn = (group ? renderer.groupFrame(names, groupRotationRef.current) : renderer.frameOf(hit)) ?? { x: 0, y: 0, rotation: 0, width: 1, height: 1 }
    const groupRotation0 = groupRotationRef.current
    // A moved pivot is the center a rotation turns around (D112); sizes still work from the drawn frame.
    const pivot = op === 'rotate' ? pivotRef.current : null
    const frame = pivot ? { ...drawn, x: pivot.x, y: pivot.y, rotation: 0 } : drawn
    const orbit = group || !!pivot
    const base = new Map<string, Record<string, number>>()
    const locals = new Map<string, { x: number; y: number }>()
    for (const obj of objects) {
      const values = baseValues(model, obj, sampleTime)
      base.set(obj.name, values)
      locals.set(obj.name, toLocal(frame, { x: values['x']!, y: values['y']! }))
    }
    const alreadySingle = selection.length === 1 && selection[0] === hit && store.selectedActions.length === 0
    const angle0 = Math.atan2(located.world.y - frame.y, located.world.x - frame.x)
    const drag: Drag = {
      kind,
      op,
      names: objects.map((o) => o.name),
      primary: primary.name,
      handle,
      keepAspect: e.altKey,
      anchor: store.anchor,
      actionIndex,
      derived,
      showTime,
      startX: e.clientX,
      startY: e.clientY,
      frame,
      base,
      locals,
      lastAngle: angle0,
      turned: 0,
      local0: toLocal(frame, located.world),
      moved: false,
      created: new Set(),
      click: alreadySingle && !e.shiftKey && !handle && !onPivot ? 'cycle' : selected && !handle && !e.shiftKey ? 'object' : 'none',
    }
    dragRef.current = drag
    if (drag.op === 'resize' && drag.keepAspect) setDragging('aspect')
    const restoreTime = store.time
    capture(
      host,
      e.pointerId,
      (ev) => {
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (!drag.moved && Math.hypot(dx, dy) < 3) return
        if (!drag.moved) {
          if (drag.kind === 'destination' && drag.derived) {
            const index = overrideClassAction(drag.primary, drag.actionIndex)
            if (index === null) return
            drag.actionIndex = index
            drag.derived = false
          }
          if (drag.showTime !== null) useStore.getState().setTime(drag.showTime)
          if (drag.kind === 'timed') {
            if (!useStore.getState().selection.includes(drag.primary)) useStore.getState().select([drag.primary])
            if (useStore.getState().pin === 'start') gestureRef.current = { restore: restoreTime }
          }
        }
        drag.moved = true
        const bounds = host.getBoundingClientRect()
        const world = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const snap = useStore.getState().previewSnap
        const values = new Map<string, Record<string, number>>()
        const primaryBase = drag.base.get(drag.primary)!
        if (drag.op === 'rotate') {
          // The turn adds up move by move, so dragging on past a full circle keeps counting and the
          // direction is the one the pointer took (D105). Everything turns around the gizmo's center.
          const angle = Math.atan2(world.y - drag.frame.y, world.x - drag.frame.x)
          let step = angle - drag.lastAngle
          if (step > Math.PI) step -= 2 * Math.PI
          if (step < -Math.PI) step += 2 * Math.PI
          drag.turned += step
          drag.lastAngle = angle
          let delta = (drag.turned * 180) / Math.PI
          if (snap.on) delta = orbit ? snapTo(delta, snap.angle) : snapTo(primaryBase['rotation']! + delta, snap.angle) - primaryBase['rotation']!
          const rad = (delta * Math.PI) / 180
          if (group) groupRotationRef.current = groupRotation0 + delta
          for (const name of drag.names) {
            const b = drag.base.get(name)!
            const l = drag.locals.get(name)!
            const turned = { x: l.x * Math.cos(rad) - l.y * Math.sin(rad), y: l.x * Math.sin(rad) + l.y * Math.cos(rad) }
            const p = toWorld(drag.frame, turned)
            values.set(name, orbit ? { x: p.x, y: p.y, rotation: b['rotation']! + delta } : { rotation: b['rotation']! + delta })
          }
        } else if (drag.op === 'resize' && drag.handle?.kind === 'resize') {
          const { sx, sy } = drag.handle
          const l = toLocal(drag.frame, world)
          const w0 = Math.max(1e-6, drag.frame.width)
          const h0 = Math.max(1e-6, drag.frame.height)
          // The anchor stays put: the far side, or the center (D104). The new size is the distance from it.
          const anchorLocal = drag.anchor === 'center' ? { x: 0, y: 0 } : { x: (-sx * w0) / 2, y: (-sy * h0) / 2 }
          const across = drag.anchor === 'center' ? 2 : 1
          let width = sx !== 0 ? Math.max(1, sx * (l.x - anchorLocal.x) * across) : w0
          let height = sy !== 0 ? Math.max(1, sy * (l.y - anchorLocal.y) * across) : h0
          if (drag.keepAspect && sx !== 0 && sy !== 0) {
            // Keeping the proportions follows the pointer along the diagonal, which never flips between axes.
            const d = { x: sx * w0, y: sy * h0 }
            const v = { x: l.x - anchorLocal.x, y: l.y - anchorLocal.y }
            const f = Math.max(1 / Math.max(w0, h0), ((v.x * d.x + v.y * d.y) / (d.x * d.x + d.y * d.y)) * across)
            width = w0 * f
            height = h0 * f
          }
          if (snap.on) {
            width = Math.max(1, snapTo(width, snap.grid))
            height = Math.max(1, snapTo(height, snap.grid))
          }
          const fx = width / w0
          const fy = height / h0
          for (const name of drag.names) {
            const obj = objects.find((o) => o.name === name)!
            const b = drag.base.get(name)!
            const l0 = drag.locals.get(name)!
            const p = toWorld(drag.frame, { x: anchorLocal.x + (l0.x - anchorLocal.x) * fx, y: anchorLocal.y + (l0.y - anchorLocal.y) * fy })
            const v = resizedValues(obj.className, b, fx, fy)
            // The center moves only when something is anchored away from it.
            if (Math.abs(p.x - b['x']!) > 1e-6 || Math.abs(p.y - b['y']!) > 1e-6) Object.assign(v, { x: p.x, y: p.y })
            values.set(name, v)
          }
        } else {
          let tx = primaryBase['x']! + dx / viewport.zoom
          let ty = primaryBase['y']! - dy / viewport.zoom
          if (snap.on) {
            tx = snapTo(tx, snap.grid)
            ty = snapTo(ty, snap.grid)
          }
          const ddx = tx - primaryBase['x']!
          const ddy = ty - primaryBase['y']!
          for (const name of drag.names) {
            const b = drag.base.get(name)!
            values.set(name, { x: b['x']! + ddx, y: b['y']! + ddy })
          }
        }
        // Only values the gesture moved get written, so an edge drag on a circle adds one line, not two.
        const changed = (name: string, v: Record<string, number>): Record<string, number> => {
          const b = drag.base.get(name)!
          return Object.fromEntries(Object.entries(v).filter(([attr, value]) => Math.abs(value - (b[attr] ?? 0)) > 1e-6))
        }
        if (drag.kind === 'timed') {
          const pinNow = useStore.getState().pin
          for (const [name, v] of values) {
            if (!drag.created.has(name) && beginTimed(name, Object.keys(v), pinNow)) drag.created.add(name)
            if (drag.created.has(name)) setLastActionTarget(name, v)
          }
        } else if (drag.kind === 'destination') {
          const v = values.get(drag.primary)
          if (v) setActionDestination(drag.primary, drag.actionIndex, changed(drag.primary, v))
        } else {
          setAttrsAtMany([...values].map(([name, attrs]) => ({ name, attrs: changed(name, attrs) })), useStore.getState().time)
        }
      },
      (ev) => {
        const s = useStore.getState()
        if (!drag.moved) {
          if (drag.click === 'cycle') s.cycleTransformMode()
          else if (drag.click === 'object') s.select([drag.primary])
        }
        dragRef.current = null
        setDragging(null)
        // Shift already released: the gesture is over, the playhead goes back.
        if (gestureRef.current && !ev.shiftKey) {
          s.setTime(gestureRef.current.restore)
          gestureRef.current = null
        }
      },
    )
  }

  /** A double-click on the pivot cross arms it for dragging; another disarms it (D112). */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const located = locate(e.currentTarget, e.clientX, e.clientY)
    if (!located || useStore.getState().selection.length === 0 || !located.renderer.onPivot(located.world)) return
    pivotArmedRef.current = !pivotArmedRef.current
    if (pivotArmedRef.current && !pivotRef.current) {
      const frame = located.renderer.groupFrame(useStore.getState().selection, groupRotationRef.current)
      if (frame) pivotRef.current = { x: frame.x, y: frame.y }
    }
    paintRef.current()
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const located = locate(e.currentTarget, e.clientX, e.clientY)
    if (!located) {
      e.preventDefault()
      return
    }
    const { world, hit } = located
    if (hit) {
      const s = useStore.getState()
      const targets = s.selection.includes(hit) ? s.selection : [hit]
      if (!s.selection.includes(hit)) s.select([hit])
      const many = targets.length > 1
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(hit) },
        ...(many ? [] : [{ label: 'Rename…', run: () => requestRename({ object: hit }) }]),
        { label: 'Classes…', run: () => requestClasses(targets) },
        { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
        { label: many ? `Delete ${targets.length} objects` : 'Delete object', run: () => deleteObjects(targets), danger: true },
      ])
    } else {
      showMenu(
        e,
        TOOLS.map((t) => ({ label: 'Add', keyword: t, run: () => addObject(t, world.x, world.y) })),
      )
    }
  }

  // Scrollbars: the view's place within a stable area, the frame with a frame's width around
  // it, grown only by what objects occupy. Scrolling never changes the area (D82).
  const viewport = viewportRef.current
  const view = viewport?.sized ? viewport.viewRect() : null
  let scroll: { x: [number, number]; y: [number, number] } | null = null
  if (viewport && view) {
    const frame = viewport.frameRect()
    const frameWidth = frame.right - frame.left
    const frameHeight = frame.top - frame.bottom
    const content = rendererRef.current?.bounds()
    const left = Math.min(frame.left - frameWidth, (content?.left ?? frame.left) - frameWidth * 0.1)
    const right = Math.max(frame.right + frameWidth, (content?.right ?? frame.right) + frameWidth * 0.1)
    const top = Math.max(frame.top + frameHeight, (content?.top ?? frame.top) + frameHeight * 0.1)
    const bottom = Math.min(frame.bottom - frameHeight, (content?.bottom ?? frame.bottom) - frameHeight * 0.1)
    scroll = { x: [left, right], y: [-top, -bottom] }
  }
  const stop = (e: ReactPointerEvent) => e.stopPropagation()

  return (
    <div
      className={`preview${tool !== 'select' ? ' placing' : ''} mode-${transformMode}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} />
      {marquee && (
        <div className="preview-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
      )}
      <div className="preview-toolbar" onPointerDown={stop}>
        {TOOLS.map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(tool === t ? 'select' : t)} title={`Add a ${t}: pick it, then click where it goes. Click again to put it away.`}>
            {t}
          </button>
        ))}
        {tool !== 'select' && <span className="hint">Click to place</span>}
        {selection.length > 0 && (
          <>
            <div className="preview-modes" role="group" aria-label="Drag mode">
              {TRANSFORM_MODES.map((m) => (
                <button key={m} className={transformMode === m ? 'active' : ''} onClick={() => setTransformMode(m)} title={`${MODE_TIP[m]} Clicking the selected object cycles the modes.`} aria-pressed={transformMode === m}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <button
              className="preview-toggle"
              onClick={() => setAnchor(anchor === 'edge' ? 'center' : 'edge')}
              title={anchor === 'edge' ? 'Resizing keeps the far side in place. Click to resize from the center instead.' : 'Resizing keeps the center in place. Click to keep the far side instead.'}
            >
              {anchor === 'edge' ? 'Edge' : 'Center'}
            </button>
            <button
              className="preview-toggle"
              onClick={() => setPin(pin === 'start' ? 'end' : 'start')}
              title={pin === 'start' ? 'A Shift-drag makes an animation that starts at the playhead and runs on from it; Shift and the wheel move its end. Click to make animations end at the playhead instead.' : 'A Shift-drag makes an animation that ends at the playhead, arriving at what you drag; Shift and the wheel move its start. Click to make animations start at the playhead instead.'}
            >
              {pin === 'start' ? 'Starts at playhead' : 'Ends at playhead'}
            </button>
            {(altDown || dragging === 'aspect') && <span className="preview-chip">Keeping proportions</span>}
          </>
        )}
      </div>
      <div className="preview-tools" onPointerDown={stop}>
        <button className={previewSnap.on ? 'on' : ''} onClick={() => setPreviewSnap({ on: !previewSnap.on })} title={previewSnap.on ? 'Drags snap positions and sizes to the grid and angles to the step. Click for free placement.' : 'Drags place freely. Click to snap positions and sizes to a grid and angles to a step.'} aria-pressed={previewSnap.on}>
          Snap
        </button>
        {previewSnap.on && <NumberField label="Grid, in pixels" value={previewSnap.grid} unit="px" onChange={(grid) => setPreviewSnap({ grid })} />}
        {previewSnap.on && <NumberField label="Angle step, in degrees" value={previewSnap.angle} unit={'°'} onChange={(angle) => setPreviewSnap({ angle })} />}
        <button onClick={() => viewportRef.current?.setZoom(1)} title="Actual size">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => viewportRef.current?.fit()} title="Fit the camera frame">
          Fit
        </button>
      </div>
      <div className="preview-hud">
        <span>{formatTime(time, settings.fps)}</span>
        <span className="dim">
          {settings.width} x {settings.height}
        </span>
        {selection.length > 1 && <span className="dim">{selection.length} selected</span>}
      </div>
      {scroll && view && viewport && (
        <>
          <ScrollBar axis="x" rangeStart={scroll.x[0]} rangeEnd={scroll.x[1]} windowStart={view.left} windowEnd={view.right} onScroll={(start) => viewport.scrollTo({ left: start })} />
          <ScrollBar axis="y" rangeStart={scroll.y[0]} rangeEnd={scroll.y[1]} windowStart={-view.top} windowEnd={-view.bottom} onScroll={(start) => viewport.scrollTo({ top: -start })} />
        </>
      )}
      {!project && (
        <div className="preview-empty">
          <div className="title">No project open</div>
          {window.api ? (
            <div className="actions">
              <button onClick={() => void pickProject()}>Open project folder</button>
              <button onClick={() => void newProject()}>New project</button>
            </div>
          ) : (
            <div className="dim">Loading the sample</div>
          )}
        </div>
      )}
    </div>
  )
}
