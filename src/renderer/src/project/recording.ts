import type { SceneModel } from '../model/types'
import { useStore, type RecordedClip } from '../state/store'

/**
 * What a recording has written (D404): each animation, by what it is on and when, which is how
 * it is found again in the code whatever is edited meanwhile; the lives the recording widened, as
 * they stood before it; the groups it made for things dragged as one; and the things it made,
 * a line drawn with the pencil (D412).
 */
interface Recorded {
  clips: RecordedClip[]
  lives: Map<string, { at: number; until: number | null }>
  groups: string[]
  made: string[]
}

/** The recording that is running. */
let running: Recorded | null = null
/** The recording that has ended and is being looked over, until that is settled. */
let reviewing: Recorded | null = null

/** What the recording that is running has written, or the one being looked over; null with neither. */
export function recorded(): Recorded | null {
  return running ?? reviewing
}

/** Remember the lives of things as they stand, before a recorded animation widens them; the first time each is named counts. */
export function noteLives(model: SceneModel, names: readonly string[]): void {
  if (!running) return
  for (const name of names) {
    if (running.lives.has(name)) continue
    const obj = model.objects.find((o) => o.name === name)
    if (obj) running.lives.set(name, { at: obj.at, until: obj.until })
  }
}

/** An animation the recording has written. */
export function noteClip(clip: RecordedClip): void {
  running?.clips.push(clip)
}

/** A group the recording made for things dragged as one (D124, D397). */
export function noteGroup(name: string): void {
  if (running && !running.groups.includes(name)) running.groups.push(name)
}

/** A thing the recording made, which goes again when everything recorded on it does (D412). */
export function noteMade(name: string): void {
  if (running && !running.made.includes(name)) running.made.push(name)
}

/** Where one of a recording's animations is in the code now: its index among its object's, or null when it is no longer there as it was written. */
export function findClip(model: SceneModel, clip: RecordedClip): number | null {
  const obj = model.objects.find((o) => o.name === clip.object)
  if (!obj) return null
  const index = obj.actions.findIndex((a) => !!a.stmt && !a.classAction && a.verb === clip.verb && Math.abs(a.start - clip.start) < 1e-4 && Math.abs(a.end - clip.end) < 1e-4)
  return index < 0 ? null : index
}

/** The review is over: what was being looked over is let go. */
export function closeReview(): void {
  reviewing = null
}

/**
 * Follow the recording (D404): one begun starts a list of what it writes; one ended hands the
 * list to the review, once everything else that follows the stop has run, so a gesture still
 * held then is in it. A recording that wrote nothing has nothing to look over, one whose
 * project was closed under it is forgotten, and with the review turned off in the preferences
 * everything written is kept as it is (D410). Call once.
 */
export function watchRecording(): void {
  useStore.subscribe((s, p) => {
    if (s.recording && !p.recording) {
      running = { clips: [], lives: new Map(), groups: [], made: [] }
      return
    }
    if (s.recording || !p.recording) return
    const closed = s.project !== p.project
    queueMicrotask(() => {
      const ended = running
      running = null
      if (!ended || closed || useStore.getState().prefs.recordReview === false) return
      const now = useStore.getState()
      const model = now.model && now.model.source === now.source ? now.model : null
      const clips = model ? ended.clips.filter((c) => findClip(model, c) !== null) : []
      if (clips.length === 0) return
      reviewing = { ...ended, clips }
      now.setRecordReview(clips)
    })
  })
}
