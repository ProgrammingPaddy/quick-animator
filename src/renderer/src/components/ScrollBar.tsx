import type { PointerEvent as ReactPointerEvent } from 'react'

interface ScrollBarProps {
  axis: 'x' | 'y'
  /** The whole extent being scrolled over. */
  rangeStart: number
  rangeEnd: number
  /** The part currently in view. */
  windowStart: number
  windowEnd: number
  /** Called with the new window start while dragging or after a click on the track. */
  onScroll: (windowStart: number) => void
}

/** A thin scrollbar over an arbitrary range, for the timeline and the world view. */
export function ScrollBar({ axis, rangeStart, rangeEnd, windowStart, windowEnd, onScroll }: ScrollBarProps) {
  const range = Math.max(1e-9, rangeEnd - rangeStart)
  // The thumb keeps the window's size and pins at an end when the window lies outside the
  // range, so scrolling past the content never changes the scale of the bar (D82).
  const size = Math.max(0.03, Math.min(1, (windowEnd - windowStart) / range))
  const start = Math.max(0, Math.min(1 - size, (windowStart - rangeStart) / range))

  const beginDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const track = e.currentTarget.parentElement
    if (!track) return
    const rect = track.getBoundingClientRect()
    const length = axis === 'x' ? rect.width : rect.height
    const origin = { pointer: axis === 'x' ? e.clientX : e.clientY, windowStart }
    const thumb = e.currentTarget
    try {
      thumb.setPointerCapture(e.pointerId)
    } catch {
      // Synthetic events have no active pointer; dragging still works.
    }
    const onMove = (ev: PointerEvent) => {
      const delta = ((axis === 'x' ? ev.clientX : ev.clientY) - origin.pointer) / Math.max(1, length)
      onScroll(origin.windowStart + delta * range)
    }
    const onUp = () => {
      thumb.removeEventListener('pointermove', onMove)
      thumb.removeEventListener('pointerup', onUp)
      thumb.removeEventListener('pointercancel', onUp)
    }
    thumb.addEventListener('pointermove', onMove)
    thumb.addEventListener('pointerup', onUp)
    thumb.addEventListener('pointercancel', onUp)
  }

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = axis === 'x' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height
    const windowSize = windowEnd - windowStart
    onScroll(rangeStart + fraction * range - windowSize / 2)
  }

  const thumbStyle = axis === 'x' ? { left: `${start * 100}%`, width: `${size * 100}%` } : { top: `${start * 100}%`, height: `${size * 100}%` }
  return (
    <div className={`scrollbar ${axis}`} onPointerDown={onTrackDown}>
      <div className="scrollbar-thumb" style={thumbStyle} onPointerDown={beginDrag} />
    </div>
  )
}
