import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { VERB_COLORS } from '../model/registry'
import type { Action, SceneObject } from '../model/types'
import { jumpToObject, setActionTiming } from '../project/operations'
import { useStore } from '../state/store'
import { formatTime, snapToFrame, timecode } from '../state/time'

/** Zoom limits in pixels per second. At the top, single frames at 30 fps sit about 130 px apart. */
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
  if (action.verb === 'to') return Object.keys(action.changes).join(', ') || 'to'
  return action.verb
}

type ClipMode = 'move' | 'start' | 'end'

/**
 * Transport, ruler, and a row per object with its lifetime and clips, over an open-ended time
 * axis. The wheel zooms around the cursor; Shift and the wheel scroll time; Alt and the wheel
 * scroll the rows. Clips drag by the body to move and by the edges to resize.
 */
export function TimelinePane() {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const fps = useStore((s) => s.settings.fps)
  const contentEnd = useStore((s) => s.contentEnd)
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const togglePlaying = useStore((s) => s.togglePlaying)
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
      if (e.altKey) {
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

  const timeAtPointer = (clientX: number): number => {
    const ruler = rulerRef.current
    if (!ruler) return 0
    const x = clientX - ruler.getBoundingClientRect().left
    const v = viewRef.current
    return Math.max(0, snapToFrame(v.scrollTime + x / v.pps, fps))
  }

  const beginScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    setTime(timeAtPointer(e.clientX))
    capture(e.currentTarget, e.pointerId, (ev) => setTime(timeAtPointer(ev.clientX)))
  }

  const beginClipDrag = (obj: SceneObject, index: number, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    select([obj.name])
    const action = obj.actions[index]
    if (!action?.stmt) return
    const atProp = action.stmt.props.find((p) => p.key === 'at')
    const untilProp = action.stmt.props.find((p) => p.key === 'until')
    if (atProp && atProp.kind !== 'literal' && mode !== 'end') return
    if (untilProp && mode !== 'move') return
    const origin = { x: e.clientX, start: action.start, end: action.end, pps: viewRef.current.pps, delay: action.timing.delay ?? 0 }
    const frame = 1 / fps
    capture(e.currentTarget, e.pointerId, (ev) => {
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const start = Math.max(0, snapToFrame(origin.start + dt, fps))
        setActionTiming(obj.name, index, { at: start - origin.delay })
      } else if (mode === 'end') {
        const end = Math.max(origin.start + frame, snapToFrame(origin.end + dt, fps))
        setActionTiming(obj.name, index, { duration: end - origin.start })
      } else {
        const start = Math.min(origin.end - frame, Math.max(0, snapToFrame(origin.start + dt, fps)))
        setActionTiming(obj.name, index, { at: start - origin.delay, duration: origin.end - start })
      }
    })
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
        <span className="time mono">{formatTime(time, fps)}</span>
        <span className="dim">
          {fps} fps{contentEnd !== null ? `, ends at ${timecode(contentEnd, fps)}` : ''}
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
          <div className="playhead head" style={{ left: xAt(time) }} />
        </div>
        <div className="tl-body" ref={bodyRef}>
          <div className="tl-rows">
            {objects.length === 0 && <div className="empty">No objects yet.</div>}
            {objects.map((obj) => {
              const selected = selection.includes(obj.name)
              const lifeFrom = xAt(obj.appears)
              const lifeTo = obj.disappears === null ? Math.max(lifeFrom, width) : xAt(obj.disappears)
              return (
                <div key={obj.name} className={`tl-row${selected ? ' selected' : ''}`}>
                  <div className="tl-row-header" onClick={() => select([obj.name])} onDoubleClick={() => jumpToObject(obj.name)} title="Double-click to jump to the code">
                    <span className="name">{obj.name}</span>
                    <span className="dim">{obj.className}</span>
                    {obj.codeDriven && <span className="badge">code</span>}
                  </div>
                  <div className="tl-track" onPointerDown={beginScrub}>
                    {ticks.map((t) => (
                      <div key={t} className="grid-line" style={{ left: xAt(t) }} />
                    ))}
                    <div className="lifetime" style={{ left: lifeFrom, width: Math.max(0, lifeTo - lifeFrom) }}>
                      {obj.fadeIn > 0 && <div className="fade in" style={{ width: obj.fadeIn * view.pps }} />}
                      {obj.fadeOut > 0 && <div className="fade out" style={{ width: obj.fadeOut * view.pps }} />}
                    </div>
                    {obj.actions.map((action, index) => {
                      if (action.verb === 'appear' || action.verb === 'disappear') return null
                      const locked = action.codeDriven || !action.stmt
                      const left = xAt(action.start)
                      const clipWidth = Math.max(8, (action.end - action.start) * view.pps)
                      return (
                        <div
                          key={action.id}
                          className={`clip${locked ? ' locked' : ''}`}
                          style={{ left, width: clipWidth, background: VERB_COLORS[action.verb] }}
                          onPointerDown={locked ? undefined : beginClipDrag(obj, index, 'move')}
                          title={`${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}  ${timecode(action.start, fps)} to ${timecode(action.end, fps)}`}
                        >
                          {!locked && <div className="clip-edge left" onPointerDown={beginClipDrag(obj, index, 'start')} />}
                          <span className="label">{clipLabel(action)}</span>
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
