import { useEffect } from 'react'
import { useStore } from './store'

/**
 * Advances the playhead while playing, once per display frame. At the content end it wraps when
 * looping is on, otherwise it stops there. Mount once, at the top of the app.
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
        const { time, playbackEnd, loop } = useStore.getState()
        let next = time + dt
        // Playback runs through the hold, so the final frame stays as long as the project says (D54).
        if (playbackEnd !== null && playbackEnd > 0 && next >= playbackEnd) {
          if (loop) next %= playbackEnd
          else {
            useStore.setState({ time: playbackEnd, playing: false })
            return
          }
        }
        useStore.setState({ time: Math.max(0, next) })
      }
      last = now
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing])
}
