import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { valueAt } from '../model/sample'
import { newProject, pickProject } from '../project/controller'
import { addObject, beginMove, setLastActionTarget, setPositionAt } from '../project/operations'
import { SceneRenderer } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { useStore, type Tool } from '../state/store'
import { formatTime } from '../state/time'

const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']

interface Drag {
  name: string
  shift: boolean
  startX: number
  startY: number
  objectX: number
  objectY: number
  moved: boolean
  created: boolean
}

/**
 * The world view. The wheel zooms around the cursor, Shift and the wheel pan sideways, Alt and
 * the wheel pan up and down, the middle button drags the view. Click selects, drag moves,
 * Shift-drag makes a timed move (decision D27). A tool button then a click places an object.
 */
export function PreviewPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [zoom, setZoom] = useState(1)
  const settings = useStore((s) => s.settings)
  const time = useStore((s) => s.time)
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const setTool = useStore((s) => s.setTool)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const viewport = new Viewport(canvas)
    const renderer = new SceneRenderer()
    viewport.content.add(renderer.group)
    viewport.onChange = () => setZoom(viewport.zoom)
    viewportRef.current = viewport
    rendererRef.current = renderer

    const paint = () => {
      const s = useStore.getState()
      renderer.update(s.model, s.time, s.selection)
      viewport.render()
    }
    const unsubscribe = useStore.subscribe(paint)
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
    const renderer = rendererRef.current
    if (!viewport || !renderer) return

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

    const bounds = host.getBoundingClientRect()
    // A pane that has never been painted (hidden since load) has not reported its size yet.
    if (!viewport.sized) viewport.resize(bounds.width, bounds.height, window.devicePixelRatio)
    const paneX = e.clientX - bounds.left
    const paneY = e.clientY - bounds.top
    const world = viewport.toWorld(paneX, paneY)
    const store = useStore.getState()

    if (store.tool !== 'select') {
      addObject(store.tool, world.x, world.y)
      store.setTool('select')
      return
    }

    const hit = renderer.pick(viewport.camera, viewport.toNdc(paneX, paneY))
    if (!hit) {
      store.select([])
      return
    }
    store.select([hit])
    const obj = store.model?.objects.find((o) => o.name === hit)
    if (!obj || !store.model) return
    const x = valueAt(store.model, obj, 'x', store.time)
    const y = valueAt(store.model, obj, 'y', store.time)
    const drag: Drag = {
      name: hit,
      shift: e.shiftKey,
      startX: e.clientX,
      startY: e.clientY,
      objectX: typeof x === 'number' ? x : 0,
      objectY: typeof y === 'number' ? y : 0,
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
        drag.moved = true
        const worldX = drag.objectX + dx / viewport.zoom
        const worldY = drag.objectY - dy / viewport.zoom
        if (drag.shift) {
          if (!drag.created) drag.created = beginMove(drag.name)
          if (drag.created) setLastActionTarget(drag.name, { x: worldX, y: worldY })
        } else {
          setPositionAt(drag.name, worldX, worldY, useStore.getState().time)
        }
      },
      () => {
        dragRef.current = null
      },
    )
  }

  return (
    <div
      className={`preview${tool !== 'select' ? ' placing' : ''}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} />
      <div className="preview-toolbar">
        {TOOLS.map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(tool === t ? 'select' : t)} title={`Add a ${t}: pick it, then click where it goes`}>
            {t}
          </button>
        ))}
        {tool !== 'select' && <span className="hint">Click to place</span>}
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
