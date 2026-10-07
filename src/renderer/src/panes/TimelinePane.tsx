import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { VERB_COLORS, VERBS } from '../model/registry'
import { valueAt } from '../model/sample'
import type { Action, SceneModel, SceneObject } from '../model/types'
import { updateSettings } from '../project/controller'
import { addAction, appearHere, canEdit, deleteAction, deleteObjects, disappearHere, jumpToAction, jumpToObject, roundSeconds, setActionTiming } from '../project/operations'
import { useStore } from '../state/store'
import { formatTime, snapToFrame, timecode } from '../state/time'

/** Zoom limits in pixels per second. At the top, single frames at 60 fps sit about 65 px apart. */
const MIN_PPS = 4
const MAX_PPS = 4000
/** One second per labelled tick at the default zoom. */
const DEFAULT_PPS = 100
/** Candidate spacings between labelled ticks, in seconds, beyond frame multiples. */
const SECOND_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
/** Minimum distance between labelled ticks, in pixels. */
const TICK_SPACING = 80
/** Width of the row header column, in pixels. Keep in step with styles.css. */
const HEADER_W = 180
/** Height of one lane of clips in a row. Overlapping clips stack in lanes. */
const LANE_H = 22
/** Height of the opacity lane at the bottom of every row. */
const OPACITY_H = 14
/** How close a drag must come to a snap target, in pixels. */
const SNAP_PX = 8

interface View {
  /** Pixels per second. */
  pps: number
  /** Time at the left edge of the track, in seconds. */
  scrollTime: number
}

/** The coarsest spacing that keeps labelled ticks at least TICK_SPACING apart. */
function tickStep(pps: number, fps: number): number {
  const frame = 1 / fps
  const steps = [frame, frame * 2, frame * 5, frame * 10, ...SECOND_STEPS.filter((s) => s > frame * 10)]
  return steps.find((s) => s * pps >= TICK_SPACING) ?? steps[steps.length - 1]!
}

function tickLabel(seconds: number, step: number, fps: number): string {
  if (step >= 60) return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  if (step >= 1) return `${Math.round(seconds)}s`
  if (step >= 0.5) return `${seconds.toFixed(1)}s`
  return timecode(seconds, fps)
}

function clipLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}

/** Overlapping clips go in separate lanes so each stays visible and grabbable. */
function assignLanes(actions: Action[]): { lanes: Map<number, number>; count: number } {
  const sorted = [...actions].sort((a, b) => a.start - b.start || a.id - b.id)
  const laneEnds: number[] = []
  const lanes = new Map<number, number>()
  for (const action of sorted) {
    let lane = laneEnds.findIndex((end) => end <= action.start)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = Math.max(action.end, action.start + 1e-6)
    lanes.set(action.id, lane)
  }
  return { lanes, count: Math.max(1, laneEnds.length) }
}

/**
 * Snap a dragged time to whole seconds and to the starts and ends of other actions when
 * snapping is on (D64); otherwise keep it exact to the millisecond.
 */
function snapTime(raw: number, model: SceneModel | null, exclude: Action | null, pps: number, snap: boolean): number {
  if (!snap) return Math.max(0, roundSeconds(raw))
  const threshold = SNAP_PX / pps
  const candidates = [0, Math.floor(raw), Math.ceil(raw)]
  if (model) for (const action of model.actions) if (action !== exclude) candidates.push(action.start, action.end)
  let best = raw
  let bestDistance = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - raw)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return Math.max(0, roundSeconds(best))
}

/** The opacity of one object over the visible range, as a filled curve. Memoised: it ignores the playhead. */
const OpacityLane = memo(function OpacityLane({ model, obj, scrollTime, pps, width, height }: { model: SceneModel; obj: SceneObject; scrollTime: number; pps: number; width: number; height: number }) {
  const path = useMemo(() => {
    if (width <= 0) return ''
    const points: string[] = []
    for (let x = 0; x <= width; x += 3) {
      const value = valueAt(model, obj, 'opacity', scrollTime + x / pps)
      const opacity = Math.max(0, Math.min(1, typeof value === 'number' ? value : 0))
      points.push(`${x},${(height - 1 - opacity * (height - 3)).toFixed(1)}`)
    }
    return `M0,${height} L${points.join(' L')} L${width},${height} Z`
  }, [model, obj, scrollTime, pps, width, height])
  return (
    <svg className="opacity-lane" width={width} height={height} aria-hidden="true">
      <path d={path} />
    </svg>
  )
})

type ClipMode = 'move' | 'start' | 'end'

/**
 * Transport, ruler, and a row per object with its clips in lanes and its opacity below, over an
 * open-ended time axis. Over the tracks the wheel zooms around the cursor, Shift and the wheel
 * scroll time, Alt and the wheel scroll the rows; over the row headers the wheel scrolls the
 * rows. Clips drag by the body to move and by the edges to resize; right-click for more.
 */
export function TimelinePane() {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const loop = useStore((s) => s.loop)
  const snap = useStore((s) => s.snap)
  const fps = useStore((s) => s.settings.fps)
  const hold = useStore((s) => s.settings.hold)
  const contentEnd = useStore((s) => s.contentEnd)
  const model = useStore((s) => s.model)
  const source = useStore((s) => s.source)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const toggleSnap = useStore((s) => s.toggleSnap)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTime = useStore((s) => s.setTime)
  const gridRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ pps: DEFAULT_PPS, scrollTime: 0 })
  const [width, setWidth] = useState(0)
  // The ref is the live value: wheel events can arrive faster than renders, and each one must
  // build on the previous one, not on the last rendered view.
  const viewRef = useRef(view)
  const setView = (next: View) => {
    viewRef.current = next
    setViewState(next)
  }
  const editable = canEdit()
  void source

  useEffect(() => {
    const ruler = rulerRef.current
    if (!ruler) return
    const observer = new ResizeObserver(() => setWidth(ruler.getBoundingClientRect().width))
    observer.observe(ruler)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    const ruler = rulerRef.current
    if (!grid || !ruler) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const overHeaders = e.clientX < grid.getBoundingClientRect().left + HEADER_W
      if (overHeaders || e.altKey) {
        if (bodyRef.current) bodyRef.current.scrollTop += e.deltaY
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / v.pps
        setView({ pps: v.pps, scrollTime: Math.max(0, v.scrollTime + delta) })
      } else {
        const x = e.clientX - ruler.getBoundingClientRect().left
        const anchor = v.scrollTime + x / v.pps
        const pps = Math.min(MAX_PPS, Math.max(MIN_PPS, v.pps * Math.exp(-e.deltaY * 0.002)))
        setView({ pps, scrollTime: Math.max(0, anchor - x / pps) })
      }
    }
    grid.addEventListener('wheel', onWheel, { passive: false })
    return () => grid.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the playhead in view while playing: page forward near the right edge, jump back on loop.
  useEffect(() => {
    if (!playing || width === 0) return
    const v = viewRef.current
    const visible = width / v.pps
    if (time > v.scrollTime + visible * 0.95) setView({ pps: v.pps, scrollTime: time - visible * 0.1 })
    else if (time < v.scrollTime) setView({ pps: v.pps, scrollTime: Math.max(0, time - visible * 0.1) })
  }, [time, playing, width])

  const xAt = (seconds: number): number => (seconds - view.scrollTime) * view.pps

  const capture = (el: HTMLElement, pointerId: number, onMove: (ev: PointerEvent) => void) => {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  /** Raw time under a pointer position, not snapped. */
  const rawTimeAt = (clientX: number): number => {
    const ruler = rulerRef.current
    if (!ruler) return 0
    const x = clientX - ruler.getBoundingClientRect().left
    const v = viewRef.current
    return Math.max(0, v.scrollTime + x / v.pps)
  }

  const beginScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const scrub = (clientX: number) => setTime(snapToFrame(rawTimeAt(clientX), fps))
    scrub(e.clientX)
    capture(e.currentTarget, e.pointerId, (ev) => scrub(ev.clientX))
  }

  const beginClipDrag = (obj: SceneObject, index: number, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (!action?.stmt || !canEdit()) return
    const atProp = action.stmt.props.find((p) => p.key === 'at')
    const untilProp = action.stmt.props.find((p) => p.key === 'until')
    if (atProp && atProp.kind !== 'literal' && mode !== 'end') return
    if (untilProp && mode !== 'move') return
    const origin = { x: e.clientX, start: action.start, end: action.end, pps: viewRef.current.pps, delay: action.timing.delay ?? 0 }
    const minimum = 1 / fps
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    capture(e.currentTarget, e.pointerId, (ev) => {
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const start = snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn)
        setActionTiming(obj.name, index, { at: start - origin.delay })
      } else if (mode === 'end') {
        const end = Math.max(origin.start + minimum, snapTime(origin.end + dt, currentModel, action, origin.pps, snapOn))
        setActionTiming(obj.name, index, { duration: end - origin.start })
      } else {
        const start = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn))
        setActionTiming(obj.name, index, { at: start - origin.delay, duration: origin.end - start })
      }
    })
  }

  /** Drag the end-of-content marker to set the hold after the last action (D54). */
  const beginHoldDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const lastEnd = model?.lastActionEnd ?? 0
    capture(e.currentTarget, e.pointerId, (ev) => {
      const end = snapTime(rawTimeAt(ev.clientX), model, null, viewRef.current.pps, useStore.getState().snap)
      updateSettings({ hold: Math.max(0, roundSeconds(end - lastEnd)) })
    })
  }

  const objectMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    select([obj.name])
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      { label: 'Delete object', run: () => deleteObjects([obj.name]), danger: true },
    ])
  }

  const clipMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectAction(obj.name, index)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  /** Right-click on empty track space: add an action of a kind at that time. */
  const trackMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    if (!canEdit() || obj.codeDriven) return
    select([obj.name])
    const t = snapTime(rawTimeAt(e.clientX), model, null, viewRef.current.pps, useStore.getState().snap)
    const label = timecode(t, fps)
    showMenu(e, [
      ...VERBS.map((verb) => ({ label: `Add ${verb} at ${label}`, run: () => addAction(obj.name, verb, t) })),
      { label: `Appear at ${label} (fade in)`, run: () => appearHere(obj.name, t) },
      { label: `Disappear at ${label} (fade out)`, run: () => disappearHere(obj.name, t) },
    ])
  }

  const step = tickStep(view.pps, fps)
  const firstTick = Math.floor(view.scrollTime / step)
  const tickCount = width > 0 ? Math.ceil(width / (step * view.pps)) + 2 : 0
  const ticks = Array.from({ length: tickCount }, (_, i) => (firstTick + i) * step)
  const objects = model?.objects ?? []

  return (
    <div className="timeline">
      <div className="transport">
        <button
          className="transport-button"
          onClick={(e) => {
            setPlaying(false)
            setTime(0)
            e.currentTarget.blur()
          }}
          title="Return to start (Home)"
          aria-label="Return to start"
        >
          {'⏮'}
        </button>
        <button
          className="transport-button play"
          onClick={(e) => {
            togglePlaying()
            // Release focus so that space keeps toggling through the app shortcut, not the button.
            e.currentTarget.blur()
          }}
          title="Play or pause (space)"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className="transport-button"
          disabled={contentEnd === null}
          onClick={(e) => {
            if (contentEnd !== null) {
              setPlaying(false)
              setTime(contentEnd)
            }
            e.currentTarget.blur()
          }}
          title="Jump to the end of the content (End)"
          aria-label="Jump to end"
        >
          {'⏭'}
        </button>
        <button
          className={`transport-button${loop ? ' on' : ''}`}
          onClick={(e) => {
            toggleLoop()
            e.currentTarget.blur()
          }}
          title={loop ? 'Looping at the end. Click to stop at the end instead.' : 'Stopping at the end. Click to loop.'}
          aria-label="Loop"
          aria-pressed={loop}
        >
          {'↻'}
        </button>
        <button
          className={`transport-button text${snap ? ' on' : ''}`}
          onClick={(e) => {
            toggleSnap()
            e.currentTarget.blur()
          }}
          title={snap ? 'Drags snap to whole seconds and to other actions. Click for free placement.' : 'Drags place freely. Click to snap to whole seconds and to other actions.'}
          aria-label="Snap"
          aria-pressed={snap}
        >
          Snap
        </button>
        <span className="time mono">{formatTime(time, fps)}</span>
        <span className="dim">
          {fps} fps{contentEnd !== null ? `, ends at ${timecode(contentEnd, fps)}` : ''}
          {hold > 0 ? ` (hold ${roundSeconds(hold)}s)` : ''}
          {!editable ? ', code has an error' : ''}
        </span>
      </div>
      <div className="tl-grid" ref={gridRef}>
        <div className="tl-corner" />
        <div className="tl-ruler" ref={rulerRef} onPointerDown={beginScrub}>
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: xAt(t) }}>
              <span>{tickLabel(t, step, fps)}</span>
            </div>
          ))}
          {contentEnd !== null && (
            <div className="end-marker" style={{ left: xAt(contentEnd) }} onPointerDown={beginHoldDrag} title="End of the content. Drag to hold the final state longer." />
          )}
          <div className="playhead head" style={{ left: xAt(time) }} />
        </div>
        <div className="tl-body" ref={bodyRef}>
          <div className="tl-rows">
            {objects.length === 0 && <div className="empty">No objects yet.</div>}
            {objects.map((obj) => {
              const selected = selection.includes(obj.name)
              const { lanes, count } = assignLanes(obj.actions)
              const rowHeight = 6 + count * LANE_H + OPACITY_H
              return (
                <div key={obj.name} className={`tl-row${selected ? ' selected' : ''}`} style={{ height: rowHeight }}>
                  <div
                    className="tl-row-header"
                    onClick={() => select([obj.name])}
                    onDoubleClick={() => jumpToObject(obj.name)}
                    onContextMenu={objectMenu(obj)}
                    title="Double-click to jump to the code, right-click for more"
                  >
                    <span className="name">{obj.name}</span>
                    <span className="dim">{obj.className}</span>
                    {obj.codeDriven && <span className="badge">code</span>}
                  </div>
                  <div className="tl-track" onPointerDown={beginScrub} onContextMenu={trackMenu(obj)}>
                    {ticks.map((t) => (
                      <div key={t} className="grid-line" style={{ left: xAt(t) }} />
                    ))}
                    {model && width > 0 && (
                      <div className="opacity-slot" style={{ top: 4 + count * LANE_H, height: OPACITY_H }} title="Opacity. Right-click the row to appear or disappear here.">
                        <OpacityLane model={model} obj={obj} scrollTime={view.scrollTime} pps={view.pps} width={width} height={OPACITY_H} />
                      </div>
                    )}
                    {obj.actions.map((action, index) => {
                      const locked = action.codeDriven || !action.stmt || !editable
                      const isSelected = selectedAction?.object === obj.name && selectedAction.index === index
                      const left = xAt(action.start)
                      const clipWidth = Math.max(8, (action.end - action.start) * view.pps)
                      const top = 4 + (lanes.get(action.id) ?? 0) * LANE_H
                      return (
                        <div
                          key={action.id}
                          className={`clip${locked ? ' locked' : ''}${isSelected ? ' selected' : ''}`}
                          style={{ left, top, width: clipWidth, background: VERB_COLORS[action.verb] }}
                          onPointerDown={locked ? undefined : beginClipDrag(obj, index, 'move')}
                          onContextMenu={action.stmt ? clipMenu(obj, index) : undefined}
                          title={`${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}  ${timecode(action.start, fps)} to ${timecode(action.end, fps)}`}
                        >
                          {!locked && <div className="clip-edge left" onPointerDown={beginClipDrag(obj, index, 'start')} />}
                          <span className="label">
                            {action.name && <span className="ident">{action.name}</span>}
                            {clipLabel(action)}
                          </span>
                          {!locked && <div className="clip-edge right" onPointerDown={beginClipDrag(obj, index, 'end')} />}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="playhead line" style={{ left: HEADER_W + xAt(time) }} />
          </div>
        </div>
      </div>
    </div>
  )
}
