import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Pane } from './components/Pane'
import { TitleBar } from './components/TitleBar'
import { CodePane } from './panes/CodePane'
import { NowPane } from './panes/NowPane'
import { ObjectPane } from './panes/ObjectPane'
import { PreviewPane } from './panes/PreviewPane'
import { TimelinePane } from './panes/TimelinePane'

/** The resizable edges: the left column, the right column, the timeline, and the Now pane. */
type Side = 'left' | 'right' | 'bottom' | 'now'

interface LayoutState {
  size: Record<Side, number>
  collapsed: Record<Side, boolean>
}

const STORAGE_KEY = 'quick-animator.layout.v1'
/** Width or height of a collapsed pane's strip, in pixels. */
const STRIP = 26
const GUTTER = 4
const MIN: Record<Side | 'center' | 'code', number> = { left: 180, right: 320, bottom: 140, now: 120, center: 360, code: 200 }
const DEFAULT: LayoutState = {
  size: { left: 260, right: 520, bottom: 280, now: 220 },
  collapsed: { left: false, right: false, bottom: false, now: false },
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<LayoutState>
      return {
        size: { ...DEFAULT.size, ...saved.size },
        collapsed: { ...DEFAULT.collapsed, ...saved.collapsed },
      }
    }
  } catch {
    // Unavailable or corrupt storage: fall through to the default.
  }
  return DEFAULT
}

/**
 * The fixed layout: objects left; preview over timeline in the center; code over the Now pane
 * on the right. Splits drag, panes collapse, and the arrangement persists.
 */
export function Layout() {
  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Storage is a convenience only.
    }
  }, [layout])

  const toggle = useCallback((side: Side) => {
    setLayout((s) => ({ ...s, collapsed: { ...s.collapsed, [side]: !s.collapsed[side] } }))
  }, [])

  // Keep the center usable when the window is narrower or shorter than the stored sizes: shrink
  // the right column first, then the left, then the bottom panes, each down to its minimum.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => {
      const { width, height } = root.getBoundingClientRect()
      if (width === 0 || height === 0) return
      setLayout((s) => {
        const next = { ...s.size }
        const ext = (side: Side) => (s.collapsed[side] ? STRIP : next[side])
        let overflow = ext('left') + ext('right') + GUTTER * 2 + MIN.center - width
        for (const side of ['right', 'left'] as const) {
          if (overflow <= 0 || s.collapsed[side]) continue
          const give = Math.min(overflow, next[side] - MIN[side])
          if (give > 0) {
            next[side] -= give
            overflow -= give
          }
        }
        const bottomOverflow = ext('bottom') + GUTTER + MIN.center - height
        if (bottomOverflow > 0 && !s.collapsed.bottom) next.bottom = Math.max(MIN.bottom, next.bottom - bottomOverflow)
        const nowOverflow = ext('now') + GUTTER + MIN.code - height
        if (nowOverflow > 0 && !s.collapsed.now) next.now = Math.max(MIN.now, next.now - nowOverflow)
        const changed = (Object.keys(next) as Side[]).some((k) => next[k] !== s.size[k])
        return changed ? { ...s, size: next } : s
      })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const extent = (side: Side): number => (layout.collapsed[side] ? STRIP : layout.size[side])

  const beginDrag = (side: Side) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (layout.collapsed[side] || e.button !== 0) return
    const root = rootRef.current
    if (!root) return
    const bounds = root.getBoundingClientRect()
    const origin = { x: e.clientX, y: e.clientY, size: layout.size[side] }
    const max =
      side === 'bottom'
        ? bounds.height - MIN.center - GUTTER
        : side === 'now'
          ? bounds.height - MIN.code - GUTTER
          : bounds.width - extent(side === 'left' ? 'right' : 'left') - MIN.center - GUTTER * 2

    const gutter = e.currentTarget
    try {
      gutter.setPointerCapture(e.pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    gutter.classList.add('active')

    const onMove = (ev: PointerEvent) => {
      const delta =
        side === 'left' ? ev.clientX - origin.x : side === 'right' ? origin.x - ev.clientX : origin.y - ev.clientY
      const next = Math.round(Math.max(MIN[side], Math.min(max, origin.size + delta)))
      setLayout((s) => (s.size[side] === next ? s : { ...s, size: { ...s.size, [side]: next } }))
    }
    const onUp = () => {
      gutter.classList.remove('active')
      gutter.removeEventListener('pointermove', onMove)
      gutter.removeEventListener('pointerup', onUp)
      gutter.removeEventListener('pointercancel', onUp)
    }
    gutter.addEventListener('pointermove', onMove)
    gutter.addEventListener('pointerup', onUp)
    gutter.addEventListener('pointercancel', onUp)
  }

  const style = {
    '--col-left': `${extent('left')}px`,
    '--col-right': `${extent('right')}px`,
    '--row-bottom': `${extent('bottom')}px`,
    '--row-now': `${extent('now')}px`,
  } as CSSProperties

  const gutterClass = (axis: 'v' | 'h', side: Side) => `gutter ${axis}${layout.collapsed[side] ? ' disabled' : ''}`

  return (
    <div className="app">
      <TitleBar />
    <div className="layout" ref={rootRef} style={style}>
      <Pane title="Objects" side="left" collapsed={layout.collapsed.left} onToggle={() => toggle('left')}>
        <ObjectPane />
      </Pane>
      <div className={gutterClass('v', 'left')} onPointerDown={beginDrag('left')} />
      <div className="column center">
        <Pane title="Preview" side="center" collapsed={false}>
          <PreviewPane />
        </Pane>
        <div className={gutterClass('h', 'bottom')} onPointerDown={beginDrag('bottom')} />
        <Pane title="Timeline" side="bottom" collapsed={layout.collapsed.bottom} onToggle={() => toggle('bottom')}>
          <TimelinePane />
        </Pane>
      </div>
      <div className={gutterClass('v', 'right')} onPointerDown={beginDrag('right')} />
      {layout.collapsed.right ? (
        <Pane title="Code" side="right" collapsed onToggle={() => toggle('right')}>
          {null}
        </Pane>
      ) : (
        <div className="column right">
          <Pane title="Code" side="right" collapsed={false} onToggle={() => toggle('right')}>
            <CodePane />
          </Pane>
          <div className={gutterClass('h', 'now')} onPointerDown={beginDrag('now')} />
          <Pane title="Selected" side="now" collapsed={layout.collapsed.now} onToggle={() => toggle('now')}>
            <NowPane />
          </Pane>
        </div>
      )}
    </div>
    </div>
  )
}
