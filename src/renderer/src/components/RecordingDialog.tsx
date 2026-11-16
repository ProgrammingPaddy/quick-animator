import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber } from '../model/edits'
import { actionLabel } from '../model/label'
import { VERB_COLORS, type Verb } from '../model/registry'
import type { SceneModel } from '../model/types'
import { settleRecording } from '../project/operations'
import { findClip } from '../project/recording'
import { useStore, type RecordedClip } from '../state/store'
import { timecode } from '../state/time'
import { KindIcon } from './KindIcon'

/**
 * The review of a recording (D404): when one ends, what it wrote is listed by the thing each
 * animation is on, in the order of time, each to be kept or not. Keep keeps the ticked ones and
 * deletes the rest, in one undo step; Delete all deletes every one; Escape keeps them all.
 */
export function RecordingDialogLayer() {
  const clips = useStore((s) => s.recordReview)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  if (!clips || !model) return null
  return <RecordingDialog clips={clips} model={model} fps={fps} />
}

function RecordingDialog({ clips, model, fps }: { clips: RecordedClip[]; model: SceneModel; fps: number }) {
  const [kept, setKept] = useState<boolean[]>(() => clips.map(() => true))
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handle = setTimeout(() => keepRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])

  // By the thing each is on, the things in the order they were first recorded, each thing's animations in the order of time.
  const things = useMemo(() => {
    const by = new Map<string, number[]>()
    clips.forEach((clip, i) => by.set(clip.object, [...(by.get(clip.object) ?? []), i]))
    return [...by].map(([name, indexes]) => ({ name, kind: model.objects.find((o) => o.name === name)?.className ?? 'Rect', indexes: [...indexes].sort((a, b) => clips[a]!.start - clips[b]!.start) }))
  }, [clips, model])

  /** What an animation is called, as the Objects pane calls it. */
  const label = (clip: RecordedClip): string => {
    const at = findClip(model, clip)
    const action = at === null ? undefined : model.objects.find((o) => o.name === clip.object)?.actions[at]
    return action ? actionLabel(action) : clip.verb
  }
  const count = kept.filter(Boolean).length
  const settle = (keep: boolean[]) => settleRecording(clips.filter((_, i) => !keep[i]))
  const keepAll = () => settle(clips.map(() => true))

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) keepAll()
      }}
    >
      <div
        className="dialog record-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            keepAll()
          } else if (e.key === 'Enter' && count > 0) {
            e.preventDefault()
            settle(kept)
          }
        }}
      >
        <div className="dialog-title">Recorded animations</div>
        <ul className="dialog-items record-list">
          {things.map((thing) => {
            const on = thing.indexes.filter((i) => kept[i]).length
            return (
              <li key={thing.name}>
                <label className="record-thing">
                  <input
                    type="checkbox"
                    checked={on === thing.indexes.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < thing.indexes.length
                    }}
                    onChange={() => setKept((prev) => prev.map((k, i) => (thing.indexes.includes(i) ? on !== thing.indexes.length : k)))}
                  />
                  <KindIcon kind={thing.kind} />
                  <span className="mono">{thing.name}</span>
                </label>
                <ul>
                  {thing.indexes.map((i) => {
                    const clip = clips[i]!
                    return (
                      <li key={i}>
                        <label className="record-clip">
                          <input type="checkbox" checked={kept[i]} onChange={() => setKept((prev) => prev.map((k, j) => (j === i ? !k : k)))} />
                          <span className="record-swatch" style={{ background: VERB_COLORS[clip.verb as Verb] }} />
                          <span className="mono record-what">{label(clip)}</span>
                          <span className="mono dim">
                            {timecode(clip.start, fps)} to {timecode(clip.end, fps)}
                          </span>
                          <span className="mono dim record-length">{formatNumber(Math.round((clip.end - clip.start) * 100) / 100)} s</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
        <div className="dialog-actions record-actions">
          <button className="danger" onClick={() => settle(clips.map(() => false))}>
            Delete all
          </button>
          <span className="spacer" />
          <button ref={keepRef} className="primary" onClick={() => settle(kept)} disabled={count === 0}>
            {count === clips.length ? 'Keep all' : `Keep ${count} of ${clips.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
