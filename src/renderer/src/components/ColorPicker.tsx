import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { parseColor } from '../model/sample'
import type { SceneModel } from '../model/types'
import { useStore } from '../state/store'

/** The colors a scene writes, the fills and strokes of its objects and their changes, each once, in the order written (D294). */
export function colorsOf(model: SceneModel | null): string[] {
  const out: string[] = []
  const add = (v: unknown): void => {
    if (typeof v === 'string' && parseColor(v) && !out.includes(v)) out.push(v)
  }
  for (const obj of model?.objects ?? []) {
    add(obj.attrs['fill'])
    add(obj.attrs['stroke'])
    for (const a of obj.actions) {
      add(a.changes['fill'])
      add(a.from['fill'])
      add(a.changes['stroke'])
    }
  }
  return out
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const rgb = parseColor(hex) ?? [255, 255, 255]
  const r = rgb[0] / 255
  const g = rgb[1] / 255
  const b = rgb[2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max > 1e-9 ? d / max : 0, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const part = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * A color, picked the same way everywhere (D303, D309): the color itself, wide, with the colors
 * used lately beside it as small boxes, as many as the preference says; the color opens a picker
 * with a hue bar, a square of saturation and brightness, the hex, the colors used lately, and
 * every color the project writes; with `onDrop`, a dropper that takes a color from the preview.
 * A color picked from the lists or let go of in the picker joins the colors used lately.
 */
export function ColorPicker({ value, onChange, onDrop, disabled, title, onOpen, onClose }: { value: string; onChange: (hex: string) => void; onDrop?: () => void; disabled?: boolean; title?: string; onOpen?: () => void; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const [hex, setHex] = useState(value)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const recent = useStore((s) => s.recentColors)
  const beside = useStore((s) => s.prefs.recentColors ?? 0)
  const rememberColor = useStore((s) => s.rememberColor)
  const model = useStore((s) => s.model)
  const project = useMemo(() => colorsOf(model), [model])
  const valid = parseColor(value) ? value : '#ffffff'
  const hsv = useMemo(() => hexToHsv(valid), [valid])
  const hueRef = useRef(hsv.h)
  /** The color the picker was opened on: only a color changed in it is one used lately. */
  const openedOn = useRef(value)
  if (hsv.s > 1e-6 && hsv.v > 1e-6) hueRef.current = hsv.h

  useEffect(() => setHex(value), [value])

  const show = () => {
    if (disabled) return
    const r = buttonRef.current?.getBoundingClientRect()
    if (r) setAt({ left: Math.min(r.left, window.innerWidth - 232), top: r.bottom + 4 })
    openedOn.current = value
    setOpen(true)
    onOpen?.()
  }
  const hide = () => {
    if (!open) return
    setOpen(false)
    onClose?.()
    if (value !== openedOn.current && parseColor(value)) rememberColor(value)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return
      hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        hide()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  })

  const pick = (h: number, s: number, v: number) => onChange(hsvToHex(h, s, v))

  /** Drag over the square or the hue bar: the pointer's share of it, kept while the pointer is down. */
  const track = (e: ReactPointerEvent<HTMLDivElement>, onAt: (x: number, y: number) => void) => {
    const el = e.currentTarget
    const read = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect()
      onAt(Math.max(0, Math.min(1, (clientX - r.left) / r.width)), Math.max(0, Math.min(1, (clientY - r.top) / r.height)))
    }
    read(e.clientX, e.clientY)
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // A synthetic pointer; the drag still follows.
    }
    const move = (ev: PointerEvent) => read(ev.clientX, ev.clientY)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const swatches = (colors: string[], kind: string) =>
    colors.map((c) => (
      <button
        key={`${kind}${c}`}
        className={`swatch${c === valid ? ' active' : ''}`}
        style={{ background: c }}
        title={c}
        aria-label={c}
        disabled={disabled}
        onClick={() => {
          onChange(c)
          rememberColor(c)
        }}
      />
    ))

  return (
    <span className="color-well">
      <button ref={buttonRef} className="color-swatch" style={{ background: valid }} disabled={disabled} title={title ?? valid} aria-label={title ?? 'Color'} onClick={() => (open ? hide() : show())} />
      {beside > 0 && recent.length > 0 && (
        <span className="color-recent" role="group" aria-label="Recent colors">
          {swatches(recent.slice(0, beside), 'b')}
        </span>
      )}
      {open && (
        <div ref={popRef} className="color-picker" style={{ left: at.left, top: at.top }} role="dialog" aria-label="Color">
          <div
            className="color-square"
            style={{ backgroundColor: hsvToHex(hueRef.current, 1, 1) }}
            onPointerDown={(e) => {
              e.preventDefault()
              track(e, (x, y) => pick(hueRef.current, x, 1 - y))
            }}
          >
            <span className="color-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <div
            className="color-hue"
            onPointerDown={(e) => {
              e.preventDefault()
              track(e, (x) => {
                hueRef.current = x * 359.999
                pick(hueRef.current, Math.max(hsv.s, 1e-6), Math.max(hsv.v, 1e-6))
              })
            }}
          >
            <span className="color-dot" style={{ left: `${(hueRef.current / 360) * 100}%`, top: '50%' }} />
          </div>
          <div className="color-row">
            <input
              className="color-hex mono"
              value={hex}
              spellCheck={false}
              onChange={(e) => setHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const t = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`
                  if (parseColor(t)) onChange(t.toLowerCase())
                }
              }}
              onBlur={() => {
                const t = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`
                if (parseColor(t)) onChange(t.toLowerCase())
                else setHex(value)
              }}
              aria-label="Hex"
            />
            {onDrop && (
              <button
                className="dropper"
                title="Take a color from the preview"
                aria-label="Dropper"
                onClick={() => {
                  hide()
                  onDrop()
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M4 20l1-4 9-9 3 3-9 9z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M13 6l2-2a2.1 2.1 0 0 1 3 3l-2 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {recent.length > 0 && (
            <div className="color-group">
              <span className="color-label">Recent</span>
              <div className="color-list">{swatches(recent, 'r')}</div>
            </div>
          )}
          {project.length > 0 && (
            <div className="color-group">
              <span className="color-label">Project</span>
              <div className="color-list">{swatches(project, 'p')}</div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
