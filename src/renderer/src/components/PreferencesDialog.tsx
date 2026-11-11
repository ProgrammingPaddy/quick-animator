import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { updateSettings } from '../project/controller'
import { roundSeconds } from '../project/operations'
import { bindingsOf, conflictsOf, HOTKEYS, keyLabel, keyOf, NO_OVERRIDES, SCOPE_LABEL, SCOPES, type Hotkey } from '../state/hotkeys'
import { DEFAULT_PREFS, RECENT_COLORS_MAX, SECTION_LABEL, sectionOrder, TIMELINE_SECTIONS, useStore, type TimelineSection } from '../state/store'
import { NumberField } from './NumberField'

export function PreferencesDialogLayer() {
  const open = useStore((s) => s.prefsOpen)
  if (!open) return null
  return <PreferencesDialog />
}

/**
 * The preferences (D145, D260): General, how long a new object lasts, an app setting, how
 * long the final frame holds, a project setting written to project.json (D54), whether Hide
 * reaches exports (D349), and the order of the timeline's sections (D339); and Hotkeys,
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
      <span className="dim">Hidden objects</span>
      <div className="row">
        <label className="check" title="What is hidden in the view is left out of exports too, and a hidden mask does not mask there">
          <input type="checkbox" checked={prefs.hideInExport === true} onChange={(e) => setPrefs({ hideInExport: e.target.checked })} />
          left out of exports
        </label>
      </div>
      <span className="dim">Code pane</span>
      <div className="row">
        <label className="check" title="Frames beside every time in the code">
          <input type="checkbox" checked={prefs.timeHints !== false} onChange={(e) => setPrefs({ timeHints: e.target.checked })} />
          frames beside times
        </label>
      </div>
      <span className="dim">Recent colors</span>
      <div className="row">
        <NumberField label="Shown beside a color, 0 to 12" value={prefs.recentColors ?? 0} unit="" min={0} onChange={(v) => setPrefs({ recentColors: Math.min(RECENT_COLORS_MAX, Math.round(v)) })} />
      </div>
      <span className="dim">Timeline</span>
      <div className="row">
        <label className="check" title="An opacity lane on every object clip">
          <input type="checkbox" checked={prefs.clipOpacity !== false} onChange={(e) => setPrefs({ clipOpacity: e.target.checked })} />
          opacity on object clips
        </label>
      </div>
      <span className="dim top">Timeline sections</span>
      <SectionOrder />
    </div>
  )
}

/** The order of the timeline's sections, top first (D339): a row dragged up or down, or moved with the arrow keys, takes its new place at once. */
function SectionOrder() {
  const saved = useStore((s) => s.prefs.timelineOrder)
  const setPrefs = useStore((s) => s.setPrefs)
  const order = sectionOrder(saved)
  const [dragging, setDragging] = useState<TimelineSection | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const place = (key: TimelineSection, index: number) => {
    const current = sectionOrder(useStore.getState().prefs.timelineOrder)
    const next = current.filter((k) => k !== key)
    next.splice(Math.max(0, Math.min(next.length, index)), 0, key)
    if (next.join() !== current.join()) setPrefs({ timelineOrder: next })
  }
  const begin = (key: TimelineSection) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus()
    setDragging(key)
    const onMove = (ev: PointerEvent) => {
      // The row sits where the pointer is: before the first other row whose middle is under the pointer.
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].filter((el) => el.dataset['section'] !== key)
      let index = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          index = i
          break
        }
      }
      place(key, index)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onKey = (key: TimelineSection) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    e.stopPropagation()
    place(key, order.indexOf(key) + (e.key === 'ArrowUp' ? -1 : 1))
  }
  return (
    <div className="row">
      <div className="section-order" ref={listRef} title="Top first: drag a row, or move it with the arrow keys">
        {order.map((key) => (
          <div key={key} className={`section-order-row${dragging === key ? ' dragging' : ''}`} data-section={key} tabIndex={0} onPointerDown={begin(key)} onKeyDown={onKey(key)}>
            <span className="grip" aria-hidden="true" />
            {SECTION_LABEL[key]}
          </div>
        ))}
      </div>
      {order.join() !== TIMELINE_SECTIONS.join() && (
        <button className="small" onClick={() => setPrefs({ timelineOrder: undefined })} title="Back to Objects, Groups, Classes, Masks">
          Reset
        </button>
      )}
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
                  ) : bindings.length === 0 && !h.fixed ? (
                    <button className="hotkey-chip unset" title="Click, then press a key" onClick={() => setRecording(h.id)}>
                      None
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
