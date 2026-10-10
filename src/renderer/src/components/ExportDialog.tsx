import { useEffect, useRef, useState } from 'react'
import { PRESETS, type ExportPreset } from '../../../shared/api'
import { frameSpan, runExport, type ExportProgress } from '../export/run'
import { useStore } from '../state/store'
import { formatTime } from '../state/time'
import { NumberField } from './NumberField'

const PRESET_KEY = 'quick-animator.exportPreset'
const PRESET_NAMES = Object.keys(PRESETS) as ExportPreset[]

function loadPreset(): ExportPreset {
  try {
    const raw = localStorage.getItem(PRESET_KEY)
    return raw && (PRESET_NAMES as string[]).includes(raw) ? (raw as ExportPreset) : 'h264'
  } catch {
    return 'h264'
  }
}

type Status = { kind: 'idle' } | ({ kind: 'running' } & ExportProgress) | { kind: 'done'; path: string; seconds: number } | { kind: 'failed'; message: string }

/** The export dialog (D132): a preset, the range, and the project's size and rate, then progress and the result. */
export function ExportDialogLayer() {
  const open = useStore((s) => s.exportOpen)
  if (!open) return null
  return <ExportDialog />
}

function ExportDialog() {
  const setOpen = useStore((s) => s.setExportOpen)
  const settings = useStore((s) => s.settings)
  const contentEnd = useStore((s) => s.contentEnd)
  const project = useStore((s) => s.project)
  const error = useStore((s) => s.error)
  const [preset, setPreset] = useState<ExportPreset>(loadPreset)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(contentEnd ?? 0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const cancelRef = useRef(false)
  const exportRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handle = setTimeout(() => exportRef.current?.focus(), 0)
    return () => clearTimeout(handle)
  }, [])

  const running = status.kind === 'running'
  const span = frameSpan({ from, to }, settings.fps)
  const problem = error ? 'The code has an error; fix it first.' : to <= from ? 'The end must come after the start.' : null
  const choosePreset = (p: ExportPreset) => {
    setPreset(p)
    try {
      localStorage.setItem(PRESET_KEY, p)
    } catch {
      // Preference only.
    }
  }
  const close = () => {
    if (running) return
    setOpen(false)
  }
  const start = async () => {
    const model = useStore.getState().model
    if (problem || !model || !window.api) return
    const path = await window.api.export.pickOutput(preset, project?.name || 'animation')
    if (!path) return
    cancelRef.current = false
    setStatus({ kind: 'running', frame: 0, total: span.count })
    const started = performance.now()
    const result = await runExport(model, settings, { from, to }, preset, path, (p) => setStatus({ kind: 'running', ...p }), () => cancelRef.current)
    setStatus(result.ok ? { kind: 'done', path, seconds: (performance.now() - started) / 1000 } : { kind: 'failed', message: result.message ?? 'Export failed' })
  }

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (running) cancelRef.current = true
            else close()
          }
        }}
      >
        <div className="dialog-title">Export</div>
        <div className="export-grid">
          <span className="dim">Format</span>
          <div className="export-presets" role="radiogroup" aria-label="Format">
            {PRESET_NAMES.map((p) => (
              <button key={p} className={p === preset ? 'active' : ''} onClick={() => choosePreset(p)} disabled={running} aria-pressed={p === preset}>
                {PRESETS[p].label}
              </button>
            ))}
          </div>
          <span className="dim">Range</span>
          <div className="export-range">
            <NumberField label="Start, in seconds" value={from} unit="s" min={0} onChange={(v) => setFrom(Math.max(0, v))} />
            <span className="dim">to</span>
            <NumberField label="End, in seconds" value={to} unit="s" min={0} onChange={(v) => setTo(Math.max(0, v))} />
            <span className="dim">
              {span.count} frame{span.count === 1 ? '' : 's'}
            </span>
          </div>
          <span className="dim">Output</span>
          <span className="mono">
            {settings.width} × {settings.height}, {settings.fps} fps{PRESETS[preset].alpha ? ', with alpha' : `, on ${settings.background}`}
          </span>
        </div>
        {status.kind === 'running' && (
          <div className="export-progress">
            <div className="export-bar">
              <div className="export-bar-fill" style={{ width: `${Math.round((status.frame / Math.max(1, status.total)) * 100)}%` }} />
            </div>
            <span className="dim mono">
              {status.frame} / {status.total} frames, {formatTime(status.frame / settings.fps, settings.fps)}
            </span>
          </div>
        )}
        {status.kind === 'done' && (
          <div className="export-result">
            Saved in {status.seconds.toFixed(1)} s:{' '}
            <button className="link" onClick={() => void window.api?.export.reveal(status.path)} title="Show the file in its folder">
              {status.path}
            </button>
          </div>
        )}
        {status.kind === 'failed' && <div className="dialog-problem">{status.message}</div>}
        {problem && status.kind === 'idle' && <div className="dialog-problem">{problem}</div>}
        <div className="dialog-actions">
          {running ? (
            <button onClick={() => (cancelRef.current = true)}>Cancel</button>
          ) : (
            <>
              <button onClick={close}>Close</button>
              <button ref={exportRef} className="primary" onClick={() => void start()} disabled={!!problem}>
                {status.kind === 'idle' ? 'Export…' : 'Export again…'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
