import { useEffect } from 'react'
import { useStore } from './store'

/**
 * Advances the playhead while playing, once per display frame. The clock runs on between the
 * project's frames, at the rate the player is set to (D398), and the playhead shows the frame it
 * is in (D396): what takes one frame in the code is seen as one frame, as an export has it, with
 * nothing drawn between two frames whatever the display. At the content end it wraps when
 * looping is on, otherwise it stops there; a recording runs on past it (D397). Mount once, at
 * the top of the app.
 */
export function useClock(): void {
  const playing = useStore((s) => s.playing)

  useEffect(() => {
    if (!playing) return
    let handle = 0
    let last: number | null = null
    // Where the clock is, and the frame of it the playhead was last given.
    let clock = useStore.getState().time
    let shown = clock

    const tick = (now: number) => {
      // The first callback only records the reference time. A frame timestamp can precede a
      // performance.now() taken when the effect ran, which would move the playhead backwards.
      if (last !== null) {
        const dt = Math.max(0, now - last) / 1000
        const { time, playbackEnd, contentEnd, loop, settings, rate, recording } = useStore.getState()
        // The playhead put somewhere else, by a click on the ruler say: the clock goes on from there.
        if (time !== shown) clock = time
        let next = clock + (dt * rate) / 100
        // Playback runs through the hold, so the final frame stays as long as the project says (D54); a loop goes round at the content's end, without the hold (D202).
        const end = loop ? (contentEnd ?? playbackEnd) : playbackEnd
        if (!recording && end !== null && end > 0 && next >= end) {
          if (loop) next %= end
          else {
            useStore.setState({ time: end, playing: false })
            return
          }
        }
        clock = Math.max(0, next)
        const frame = Math.floor(clock * settings.fps + 1e-6) / settings.fps
        if (frame !== time) useStore.setState({ time: frame })
        shown = frame
      }
      last = now
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing])
}
