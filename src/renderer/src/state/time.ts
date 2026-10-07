/** Round a time in seconds to the nearest frame boundary. */
export function snapToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps
}

/** Whole frame index for a time in seconds. */
export function frameAt(seconds: number, fps: number): number {
  return Math.floor(seconds * fps + 1e-6)
}

/** Timecode as m:ss:ff, for example `0:01:15`. */
export function timecode(seconds: number, fps: number): string {
  const frame = Math.max(0, frameAt(seconds, fps))
  const wholeSeconds = Math.floor(frame / fps)
  const minutes = Math.floor(wholeSeconds / 60)
  const s = String(wholeSeconds % 60).padStart(2, '0')
  const f = String(frame - wholeSeconds * fps).padStart(2, '0')
  return `${minutes}:${s}:${f}`
}

/** Timecode followed by the absolute frame number, for example `0:01:15  f45`. */
export function formatTime(seconds: number, fps: number): string {
  return `${timecode(seconds, fps)}  f${Math.max(0, frameAt(seconds, fps))}`
}
