import { useEffect, useRef, useState } from 'react'
import { updateSettings } from '../project/controller'
import { roundSeconds } from '../project/operations'
import { DEFAULT_PREFS, useStore } from '../state/store'
import { NumberField } from './NumberField'

export function PreferencesDialogLayer() {
  const open = useStore((s) => s.prefsOpen)
  if (!open) return null
  return <PreferencesDialog />
}

/**
 * The preferences (D145): how long a new object lasts, an app setting, and how long the final
 * frame holds after the content ends, a project setting written to project.json (D54).
 */
function PreferencesDialog() {
  const setOpen = useStore((s) => s.setPrefsOpen)
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const hold = useStore((s) => s.settings.hold)
  const project = useStore((s) => s.project)
  /** The length kept while "to the end" is ticked, so unticking brings it back. */
  const [length, setLength] = useState(prefs.objectLength ?? DEFAULT_PREFS.objectLength ?? 2)
  const closeRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    const handle = setTimeout(() => closeRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])

  const toEnd = prefs.objectLength === null
  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="dialog prefs-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        <div className="dialog-title">Preferences</div>
        <div className="prefs-grid">
          <span className="dim">New objects last</span>
          <div className="row">
            <NumberField
              label="Seconds a new object lasts from where it is added"
              value={length}
              unit="s"
              min={0.1}
              step={0.1}
              onChange={(v) => {
                setLength(v)
                if (!toEnd) setPrefs({ objectLength: v })
              }}
            />
            <label className="check" title="New objects last to the end of the content instead of a set length">
              <input
                type="checkbox"
                checked={toEnd}
                onChange={(e) => setPrefs({ objectLength: e.target.checked ? null : roundSeconds(length) })}
              />
              to the end
            </label>
          </div>
          <span className="dim">Hold the final frame</span>
          <div className="row">
            <NumberField label="Seconds the final frame stays after the content ends, in playback and export; saved with the project" value={hold} unit="s" min={0} step={0.1} onChange={(v) => updateSettings({ hold: roundSeconds(v) })} disabled={!project} />
            {!project && <span className="dim">Open a project to set its hold.</span>}
          </div>
        </div>
        <div className="dialog-note dim">An object added from the preview, the object pane, or the timeline begins at the playhead and lasts this long; drag its clip's edges to change that. The hold keeps the last frame on screen without extending the content.</div>
        <div className="dialog-actions">
          <button ref={closeRef} className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
