import { useEffect } from 'react'
import { useStore } from './store'

/**
 * Advances the playhead while playing, once per display frame. Loops at the content end when
 * one is known, otherwise runs on. Mount once, at the top of the app.
 */
export function useClock(): void {
  const playing = useStore((s) => s.playing)

  useEffect(() => {
    if (!playing) return
    let handle = 0
    let last: number | null = null

    const tick = (now: number) => {
      // The first callback only records the reference time. A frame timestamp can precede a
      // performance.now() taken when the effect ran, which would move the playhead backwards.
      if (last !== null) {
        const dt = Math.max(0, now - last) / 1000
        const { time, contentEnd } = useStore.getState()
        let next = time + dt
        if (contentEnd !== null && contentEnd > 0 && next >= contentEnd) next %= contentEnd
        useStore.setState({ time: Math.max(0, next) })
      }
      last = now
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing])
}
