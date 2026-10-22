import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { updateSettings } from '../project/controller'
import { roundSeconds } from '../project/operations'
import { bindingsOf, conflictsOf, HOTKEYS, keyLabel, keyOf, NO_OVERRIDES, SCOPE_LABEL, SCOPES, type Hotkey } from '../state/hotkeys'
import { DEFAULT_PREFS, useStore } from '../state/store'
import { NumberField } from './NumberField'

export function PreferencesDialogLayer() {
  const open = useStore((s) => s.prefsOpen)
  if (!open) return null
  return <PreferencesDialog />
}

/**
 * The preferences (D145, D260): General, how long a new object lasts, an app setting, and how
 * long the final frame holds, a project setting written to project.json (D54); and Hotkeys,
 * every key the app answers to, each rebindable, with a warning when a key is already taken.
 */
function PreferencesDialog() {
  const setOpen = useStore((s) => s.setPrefsOpen)
  const [tab, setTab] = useState<'general' | 'hotkeys'>('general')
  const closeRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    const handle = setTimeout(() => closeRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])

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
        <div className="prefs-body">
          <div className="prefs-tabs" role="tablist" aria-orientation="vertical">
            <button role="tab" aria-selected={tab === 'general'} className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
              General
            </button>
            <button role="tab" aria-selected={tab === 'hotkeys'} className={tab === 'hotkeys' ? 'active' : ''} onClick={() => setTab('hotkeys')}>
              Hotkeys
            </button>
          </div>
          <div className="prefs-content" role="tabpanel">
            {tab === 'general' ? <GeneralTab /> : <HotkeysTab />}
          </div>
        </div>
        <div className="dialog-actions">
          <button ref={closeRef} className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function GeneralTab() {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const hold = useStore((s) => s.settings.hold)
  const project = useStore((s) => s.project)
  /** The length kept while "to the end" is ticked, so unticking brings it back. */
  const [length, setLength] = useState(prefs.objectLength ?? DEFAULT_PREFS.objectLength ?? 2)
  const toEnd = prefs.objectLength === null
  return (
    <div className="prefs-grid">
      <span className="dim">Object default duration</span>
      <div className="row">
        <NumberField
          label="Seconds"
          value={length}
          unit="s"
          min={0.1}
          step={0.1}
          onChange={(v) => {
            setLength(v)
            if (!toEnd) setPrefs({ objectLength: v })
          }}
        />
        <label className="check" title="To the end of the content">
          <input type="checkbox" checked={toEnd} onChange={(e) => setPrefs({ objectLength: e.target.checked ? null : roundSeconds(length) })} />
          to the end
        </label>
      </div>
      <span className="dim">Final frame hold</span>
      <div className="row">
        <NumberField label="Seconds" value={hold} unit="s" min={0} step={0.1} onChange={(v) => updateSettings({ hold: roundSeconds(v) })} disabled={!project} />
        {!project && <span className="dim">Open a project first.</span>}
      </div>
      <span className="dim">Code pane</span>
      <div className="row">
        <label className="check" title="Every time in the code with its frames beside it, and frames with their seconds">
          <input type="checkbox" checked={prefs.timeHints !== false} onChange={(e) => setPrefs({ timeHints: e.target.checked })} />
          frames beside times
        </label>
      </div>
    </div>
  )
}

/** Every hotkey by pane (D260): click a key to press another for it; a key already taken in that pane, or everywhere, is said beside it. The editor's and the pointer's own keys are listed and stay as they are. */
function HotkeysTab() {
  const overrides = useStore((s) => s.prefs.hotkeys) ?? NO_OVERRIDES
  const setPrefs = useStore((s) => s.setPrefs)
  const [recording, setRecording] = useState<string | null>(null)
  const set = (id: string, bindings: string[] | null) => {
    const next: Record<string, readonly string[]> = { ...overrides }
    if (bindings === null) delete next[id]
    else next[id] = bindings
    setPrefs({ hotkeys: next })
  }
  const record = (e: ReactKeyboardEvent<HTMLButtonElement>, hotkey: Hotkey) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const key = keyOf(e.nativeEvent)
    if (!key) return
    set(hotkey.id, [key])
    setRecording(null)
  }
  return (
    <div className="hotkeys">
      {SCOPES.map((scope) => (
        <section key={scope}>
          <div className="hotkeys-scope">{SCOPE_LABEL[scope]}</div>
          {HOTKEYS.filter((h) => h.scope === scope).map((h) => {
            const bindings = bindingsOf(h, overrides)
            const conflicts = h.fixed ? [] : bindings.flatMap((b) => conflictsOf(h, b, overrides))
            const changed = overrides[h.id] !== undefined
            return (
              <div key={h.id} className={`hotkey-row${conflicts.length > 0 ? ' conflict' : ''}`} title={h.what}>
                <span className="hotkey-label">{h.label}</span>
                <span className="hotkey-keys">
                  {recording === h.id ? (
                    <button className="hotkey-chip recording" autoFocus onKeyDown={(e) => record(e, h)} onBlur={() => setRecording(null)}>
                      Press a key
                    </button>
                  ) : (
                    bindings.map((b) => (
                      <button key={b} className="hotkey-chip" disabled={h.fixed} title={h.fixed ? 'Fixed' : 'Click, then press the new key'} onClick={() => setRecording(h.id)}>
                        {keyLabel(b)}
                      </button>
                    ))
                  )}
                  {changed && (
                    <button className="small" onClick={() => set(h.id, null)} title="Back to the default">
                      Reset
                    </button>
                  )}
                </span>
                {conflicts.length > 0 && <span className="hotkey-conflict">Also {conflicts.map((c) => `${c.label}${c.scope === h.scope ? '' : `, ${SCOPE_LABEL[c.scope].toLowerCase()}`}`).join('; ')}</span>}
              </div>
            )
          })}
        </section>
      ))}
      {Object.keys(overrides).length > 0 && (
        <div className="row hotkeys-foot">
          <button className="small" onClick={() => setPrefs({ hotkeys: {} })}>
            Reset all
          </button>
        </div>
      )}
    </div>
  )
}
