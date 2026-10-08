import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { ScrollBar } from '../components/ScrollBar'
import { valueAt } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { addObject, beginTimed, deleteObjects, dragAttrs, duplicateObjects, jumpToObject, overrideClassAction, requestClasses, requestRename, resizedValues, setActionDestination, setAttrsAt, setLastActionTarget, type DragKind } from '../project/operations'
import { SceneRenderer, type Frame, type Handle } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { TRANSFORM_MODES, useStore, type Tool, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']
const MODE_LABEL: Record<TransformMode, string> = { all: 'Transform', move: 'Move', rotate: 'Rotate', resize: 'Resize' }
const MODE_TIP: Record<TransformMode, string> = {
  all: 'Every handle: drag the body to move, a corner or an edge to resize, the handle above to rotate. Shift makes the drag an animation.',
  move: 'Dragging moves the object. Shift makes it an animation.',
  rotate: 'Dragging turns the object around its center. Shift makes it an animation.',
  resize: 'Corners resize keeping the proportions, edges resize one side. Shift makes it an animation.',
}
const BASE_ATTRS = ['x', 'y', 'rotation', 'width', 'height', 'radius', 'fontSize']

interface Drag {
  /** `plain`: edit the values at the playhead. `timed`: Shift, make an action. `destination`: the selected action's end follows. */
  kind: 'plain' | 'timed' | 'destination'
  op: DragKind
  /** Objects being dragged: every selected object moves together; one object turns or resizes. */
  names: string[]
  primary: string
  handle: Handle | null
  actionIndex: number
  /** The selected action came from a class statement; the object overrides it when the drag begins (D80). */
  derived: boolean
  startX: number
  startY: number
  /** The primary object's drawn frame when the drag began. */
  frame: Frame
  /** Each dragged object's values at the time being edited, when the drag began. */
  base: Map<string, Record<string, number>>
  angle0: number
  /** Pointer position in the primary object's own frame when a resize began. */
  local0: { x: number; y: number }
  moved: boolean
  created: Set<string>
  /** What a click without movement does. */
  click: 'cycle' | 'toggle' | 'object' | 'none'
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

/** A world point in an object's own frame: relative to its center, unrotated. */
function toLocal(frame: Frame, p: { x: number; y: number }): { x: number; y: number } {
  const a = (-frame.rotation * Math.PI) / 180
  const dx = p.x - frame.x
  const dy = p.y - frame.y
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A vector in an object's own frame, turned back into world axes. */
function toWorldDelta(frame: Frame, l: { x: number; y: number }): { x: number; y: number } {
  const a = (frame.rotation * Math.PI) / 180
  return { x: l.x * Math.cos(a) - l.y * Math.sin(a), y: l.x * Math.sin(a) + l.y * Math.cos(a) }
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
 * The world view. The wheel zooms around the cursor, Shift and the wheel pan sideways, Alt and
 * the wheel pan up and down, the middle button drags the view, and scrollbars show where the
 * view sits in a stable area around the frame (D82, D85). Click selects, Ctrl-click adds or
 * removes, a drag on empty space selects what it touches (D89), and a click on the selected
 * object cycles the mode (D79). The selected object shows handles for its mode (D86): the body
 * moves, corners and edges resize, the handle above rotates. A drag applies now, Shift-drag
 * makes it an animation (D27), and a drag while a matching action is selected sets that
 * action's destination (D70). Snap rounds positions and sizes to a grid and angles to a step
 * (D91). A tool button then a click places an object. Right-click adds objects or acts on the
 * one under the cursor.
 */
export function PreviewPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const dragRef = useRef<Drag | null>(null)
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
  const setTool = useStore((s) => s.setTool)
  const setTransformMode = useStore((s) => s.setTransformMode)
  const setPreviewSnap = useStore((s) => s.setPreviewSnap)

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
      renderer.update(s.model, s.time, s.selection, s.transformMode, 1 / viewport.zoom)
      viewport.render()
    }
    viewport.onChange = () => {
      setZoom(viewport.zoom)
      paint()
      bump()
    }
    const unsubscribe = useStore.subscribe((s, prev) => {
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
      if (e.shiftKey) viewport.panBy(e.deltaY, 0)
      else if (e.altKey) viewport.panBy(0, e.deltaY)
      else viewport.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - bounds.left, e.clientY - bounds.top)
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      host.removeEventListener('wheel', onWheel)
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

  const capture = (el: HTMLElement, pointerId: number, onMove: (ev: PointerEvent) => void, onEnd: () => void) => {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      onEnd()
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

    const mode = store.transformMode
    const selection = store.selection
    const single = selection.length === 1 ? selection[0]! : null
    // A handle of the selected object wins over whatever is drawn under it.
    const handle = single ? renderer.pickHandle(located.world) : null
    const hit = handle ? single : located.hit

    if (!hit) {
      // Empty space: a drag selects what it touches, a click clears the selection (D89).
      const start = { x: located.paneX, y: located.paneY }
      const extend = e.shiftKey
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
            if (!extend && !e.ctrlKey && !e.metaKey) s.select([])
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

    const obj = model.objects.find((o) => o.name === hit)
    if (!obj) return
    if (!handle && (e.ctrlKey || e.metaKey)) {
      store.toggleSelected(hit)
      return
    }

    const selectedAction = store.selectedAction?.object === hit ? store.selectedAction : null
    const action = selectedAction ? obj.actions[selectedAction.index] : undefined
    const op: DragKind = handle ? (handle.kind === 'rotate' ? 'rotate' : 'resize') : mode === 'rotate' ? 'rotate' : 'move'
    const { attrs } = dragAttrs(op, obj.className)
    const destination = !!action && !e.shiftKey && attrs.some((a) => a in action.changes)
    const inSelection = selection.includes(hit)
    const alreadySingle = single === hit && !selectedAction
    const names = op === 'move' && inSelection && !destination && !e.shiftKey ? selection : [hit]
    if (!inSelection && !e.shiftKey && !selectedAction) store.select([hit])

    const sampleTime = destination ? action!.end : store.time
    const base = new Map<string, Record<string, number>>()
    for (const name of names) {
      const o = model.objects.find((x) => x.name === name)
      if (o) base.set(name, baseValues(model, o, sampleTime))
    }
    const primaryBase = base.get(hit)!
    const frame = renderer.frameOf(hit) ?? { x: primaryBase['x']!, y: primaryBase['y']!, rotation: primaryBase['rotation']!, width: 1, height: 1 }
    const drag: Drag = {
      kind: destination ? 'destination' : e.shiftKey ? 'timed' : 'plain',
      op,
      names,
      primary: hit,
      handle,
      actionIndex: selectedAction?.index ?? -1,
      derived: !!action?.classAction,
      startX: e.clientX,
      startY: e.clientY,
      frame,
      base,
      angle0: Math.atan2(located.world.y - frame.y, located.world.x - frame.x),
      local0: toLocal(frame, located.world),
      moved: false,
      created: new Set(),
      click: alreadySingle && !e.shiftKey && !handle ? 'cycle' : e.shiftKey && !handle ? 'toggle' : selectedAction ? 'object' : 'none',
    }
    dragRef.current = drag
    capture(
      host,
      e.pointerId,
      (ev) => {
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (!drag.moved && Math.hypot(dx, dy) < 3) return
        if (!drag.moved) {
          if (drag.kind === 'destination' && action) {
            if (drag.derived) {
              const index = overrideClassAction(drag.primary, drag.actionIndex)
              if (index === null) return
              drag.actionIndex = index
              drag.derived = false
            }
            useStore.getState().setTime(action.end)
          }
          if (drag.kind === 'timed' && !useStore.getState().selection.includes(drag.primary)) useStore.getState().select([drag.primary])
        }
        drag.moved = true
        const bounds = host.getBoundingClientRect()
        const world = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const snap = useStore.getState().previewSnap
        const values = new Map<string, Record<string, number>>()
        if (drag.op === 'rotate') {
          const angle = Math.atan2(world.y - drag.frame.y, world.x - drag.frame.x)
          const base0 = primaryBase['rotation']!
          let target = base0 + ((angle - drag.angle0) * 180) / Math.PI
          if (snap.on) target = snapTo(target, snap.angle)
          const delta = target - base0
          for (const name of drag.names) values.set(name, { rotation: (drag.base.get(name)?.['rotation'] ?? 0) + delta })
        } else if (drag.op === 'resize' && drag.handle?.kind === 'resize') {
          const { sx, sy } = drag.handle
          const l = toLocal(drag.frame, world)
          const w0 = Math.max(1e-6, drag.frame.width)
          const h0 = Math.max(1e-6, drag.frame.height)
          // The side across from the handle stays put, so the new size is the distance from it.
          let width = sx !== 0 ? Math.max(1, sx * l.x + w0 / 2) : w0
          let height = sy !== 0 ? Math.max(1, sy * l.y + h0 / 2) : h0
          if (sx !== 0 && sy !== 0) {
            // A corner keeps the proportions, following the axis that moved more.
            const f = Math.abs(l.x - drag.local0.x) >= Math.abs(l.y - drag.local0.y) ? width / w0 : height / h0
            width = w0 * f
            height = h0 * f
          }
          if (snap.on) {
            width = Math.max(1, snapTo(width, snap.grid))
            height = Math.max(1, snapTo(height, snap.grid))
          }
          const dims = resizedValues(obj.className, primaryBase, width / w0, height / h0)
          if (drag.kind === 'plain') {
            // Keeping the far side in place means the center moves by half the growth.
            const shift = toWorldDelta(drag.frame, { x: (sx * (width - w0)) / 2, y: (sy * (height - h0)) / 2 })
            dims['x'] = primaryBase['x']! + shift.x
            dims['y'] = primaryBase['y']! + shift.y
          }
          values.set(drag.primary, dims)
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
            const b = drag.base.get(name)
            if (b) values.set(name, { x: b['x']! + ddx, y: b['y']! + ddy })
          }
        }
        for (const [name, v] of values) {
          if (drag.kind === 'timed') {
            if (!drag.created.has(name) && beginTimed(name, drag.op)) drag.created.add(name)
            if (drag.created.has(name)) setLastActionTarget(name, v)
          } else if (drag.kind === 'destination') {
            setActionDestination(name, drag.actionIndex, v)
          } else {
            setAttrsAt(name, v, useStore.getState().time)
          }
        }
      },
      () => {
        if (!drag.moved) {
          const s = useStore.getState()
          if (drag.click === 'cycle') s.cycleTransformMode()
          else if (drag.click === 'toggle') s.toggleSelected(drag.primary)
          else if (drag.click === 'object') s.select([drag.primary])
        }
        dragRef.current = null
      },
    )
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
        TOOLS.map((t) => ({ label: `Add ${t} here`, run: () => addObject(t, world.x, world.y) })),
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
          <div className="preview-modes" role="group" aria-label="Drag mode">
            {TRANSFORM_MODES.map((m) => (
              <button key={m} className={transformMode === m ? 'active' : ''} onClick={() => setTransformMode(m)} title={`${MODE_TIP[m]} Clicking the selected object cycles the modes.`} aria-pressed={transformMode === m}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="preview-tools" onPointerDown={stop}>
        <button className={previewSnap.on ? 'on' : ''} onClick={() => setPreviewSnap({ on: !previewSnap.on })} title={previewSnap.on ? 'Drags snap positions and sizes to the grid and angles to the step. Click for free placement.' : 'Drags place freely. Click to snap positions and sizes to a grid and angles to a step.'} aria-pressed={previewSnap.on}>
          Snap
        </button>
        {previewSnap.on && (
          <>
            <label className="snap-field" title="Grid, in pixels">
              <input type="number" min={1} step={1} value={previewSnap.grid} onChange={(e) => setPreviewSnap({ grid: Math.max(1, Number(e.target.value) || 1) })} />
              <span>px</span>
            </label>
            <label className="snap-field" title="Angle step, in degrees">
              <input type="number" min={1} step={1} value={previewSnap.angle} onChange={(e) => setPreviewSnap({ angle: Math.max(1, Number(e.target.value) || 1) })} />
              <span>{'°'}</span>
            </label>
          </>
        )}
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
