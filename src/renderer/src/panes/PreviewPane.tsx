import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { ScrollBar } from '../components/ScrollBar'
import { valueAt } from '../model/sample'
import { newProject, pickProject } from '../project/controller'
import { addObject, beginTimed, deleteObjects, duplicateObject, jumpToObject, materializeClassAction, modeAttrs, requestClasses, requestRename, setActionDestination, setAttrsAt, setLastActionTarget } from '../project/operations'
import { SceneRenderer } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { TRANSFORM_MODES, useStore, type Tool, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']
const MODE_LABEL: Record<TransformMode, string> = { move: 'Move', rotate: 'Rotate', scale: 'Scale' }

interface Drag {
  name: string
  mode: TransformMode
  /** `plain`: edit the value at the playhead. `timed`: Shift, make an action. `destination`: the selected action's end follows. */
  kind: 'plain' | 'timed' | 'destination'
  actionIndex: number
  /** The selected action came from a class statement; the object gets its own copy when the drag begins (D80). */
  derived: boolean
  startX: number
  startY: number
  /** The object's center and values when the drag began, at the time being edited. */
  center: { x: number; y: number }
  base: Record<string, number>
  angle0: number
  distance0: number
  moved: boolean
  created: boolean
}

/**
 * The world view. The wheel zooms around the cursor, Shift and the wheel pan sideways, Alt and
 * the wheel pan up and down, the middle button drags the view, and scrollbars show where the
 * view sits in a stable area around the frame (D82). Click selects; a click on the selected
 * object cycles move, rotate, scale (D79). A drag applies the mode now, Shift-drag makes it an
 * animation (D27), and a drag while a matching action is selected sets that action's
 * destination (D70). A tool button then a click places an object. Right-click adds objects or
 * acts on the one under the cursor.
 */
export function PreviewPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const settings = useStore((s) => s.settings)
  const time = useStore((s) => s.time)
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
  const transformMode = useStore((s) => s.transformMode)
  const setTool = useStore((s) => s.setTool)
  const setTransformMode = useStore((s) => s.setTransformMode)

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
      renderer.update(s.model, s.time, s.selection, s.transformMode, 8 / viewport.zoom)
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
    return { viewport, bounds, world: viewport.toWorld(paneX, paneY), hit: renderer.pick(viewport.camera, viewport.toNdc(paneX, paneY)) }
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
    const store = useStore.getState()

    if (store.tool !== 'select') {
      addObject(store.tool, located.world.x, located.world.y)
      store.setTool('select')
      return
    }

    const hit = located.hit
    if (!hit) {
      store.select([])
      return
    }
    const obj = store.model?.objects.find((o) => o.name === hit)
    if (!obj || !store.model) {
      store.select([hit])
      return
    }

    const mode = store.transformMode
    const { attrs } = modeAttrs(mode)
    const selected = store.selectedAction?.object === hit ? store.selectedAction : null
    const action = selected ? obj.actions[selected.index] : undefined
    const destination = !!action && !e.shiftKey && attrs.some((a) => a in action.changes)
    const alreadySelected = store.selection.length === 1 && store.selection[0] === hit && !selected
    if (!alreadySelected && !selected) store.select([hit])

    const sampleTime = destination ? action!.end : store.time
    const base: Record<string, number> = {}
    for (const attr of ['x', 'y', 'rotation', 'scale']) {
      const v = valueAt(store.model, obj, attr, sampleTime)
      base[attr] = typeof v === 'number' ? v : 0
    }
    const center = { x: base['x']!, y: base['y']! }
    const drag: Drag = {
      name: hit,
      mode,
      kind: destination ? 'destination' : e.shiftKey ? 'timed' : 'plain',
      actionIndex: selected?.index ?? -1,
      derived: !!action?.classAction,
      startX: e.clientX,
      startY: e.clientY,
      center,
      base,
      angle0: Math.atan2(located.world.y - center.y, located.world.x - center.x),
      distance0: Math.max(5 / viewport.zoom, Math.hypot(located.world.x - center.x, located.world.y - center.y)),
      moved: false,
      created: false,
    }
    dragRef.current = drag
    capture(
      host,
      e.pointerId,
      (ev) => {
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (!drag.moved && Math.hypot(dx, dy) < 3) return
        if (!drag.moved && drag.kind === 'destination' && action) {
          if (drag.derived) {
            const index = materializeClassAction(drag.name, drag.actionIndex)
            if (index === null) return
            drag.actionIndex = index
            drag.derived = false
          }
          useStore.getState().setTime(action.end)
        }
        drag.moved = true
        const bounds = host.getBoundingClientRect()
        const world = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        let values: Record<string, number>
        if (drag.mode === 'rotate') {
          const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x)
          values = { rotation: drag.base['rotation']! + ((angle - drag.angle0) * 180) / Math.PI }
        } else if (drag.mode === 'scale') {
          const distance = Math.hypot(world.x - drag.center.x, world.y - drag.center.y)
          values = { scale: Math.max(0.01, drag.base['scale']! * (distance / drag.distance0)) }
        } else {
          values = { x: drag.base['x']! + dx / viewport.zoom, y: drag.base['y']! - dy / viewport.zoom }
        }
        if (drag.kind === 'timed') {
          if (!drag.created) drag.created = beginTimed(drag.name, drag.mode)
          if (drag.created) setLastActionTarget(drag.name, values)
        } else if (drag.kind === 'destination') {
          setActionDestination(drag.name, drag.actionIndex, values)
        } else {
          setAttrsAt(drag.name, values, useStore.getState().time)
        }
      },
      () => {
        if (!drag.moved) {
          // A click, not a drag: on the selected object it cycles the mode; with an action
          // selected it goes back to the object.
          if (alreadySelected && !e.shiftKey) useStore.getState().cycleTransformMode()
          else if (selected) useStore.getState().select([hit])
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
      useStore.getState().select([hit])
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(hit) },
        { label: 'Rename…', run: () => requestRename({ object: hit }) },
        { label: 'Classes…', run: () => requestClasses(hit) },
        { label: 'Duplicate', run: () => duplicateObject(hit) },
        { label: 'Delete object', run: () => deleteObjects([hit]), danger: true },
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

  return (
    <div
      className={`preview${tool !== 'select' ? ' placing' : ''} mode-${transformMode}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} />
      <div className="preview-toolbar">
        {TOOLS.map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(tool === t ? 'select' : t)} title={`Add a ${t}: pick it, then click where it goes`}>
            {t}
          </button>
        ))}
        {tool !== 'select' && <span className="hint">Click to place</span>}
        {selection.length === 1 && (
          <div className="preview-modes" role="group" aria-label="Drag mode">
            {TRANSFORM_MODES.map((m) => (
              <button
                key={m}
                className={transformMode === m ? 'active' : ''}
                onClick={() => setTransformMode(m)}
                title={`Dragging the object ${m}s it now. Shift-drag makes that an animation. Clicking the selected object cycles the mode.`}
                aria-pressed={transformMode === m}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="preview-tools">
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
      </div>
      {scroll && view && viewport && (
        <>
          <ScrollBar axis="x" rangeStart={scroll.x[0]} rangeEnd={scroll.x[1]} windowStart={view.left} windowEnd={view.right} onScroll={(start) => viewport.panBy((start - view.left) * viewport.zoom, 0)} />
          <ScrollBar axis="y" rangeStart={scroll.y[0]} rangeEnd={scroll.y[1]} windowStart={-view.top} windowEnd={-view.bottom} onScroll={(start) => viewport.panBy(0, (start + view.top) * viewport.zoom)} />
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
