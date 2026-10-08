/**
 * An inline color picker like VS Code's (D120): a saturation and value square, a hue strip,
 * and a hex field, floating by the color it edits. It stays open while the pointer works
 * inside it and closes on a click elsewhere, on Escape, or when its text goes away.
 */

interface Hsv {
  h: number
  s: number
  v: number
}

function hexToHsv(hex: string): Hsv {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let hue = 0
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue = (hue * 60 + 360) % 360
  }
  return { h: hue, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r!)}${to(g!)}${to(b!)}`
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

let current: (() => void) | null = null

/** Open the picker by an element. Returns a function that closes it. Only one is open at a time. */
export function openColorPicker(anchor: HTMLElement, initial: string, onChange: (hex: string) => void, onClose: () => void): () => void {
  current?.()
  const hsv = hexToHsv(initial)
  const root = document.createElement('div')
  root.className = 'cm-color-picker'
  root.innerHTML = `
    <div class="cp-square"><div class="cp-white"></div><div class="cp-black"></div><div class="cp-marker"></div></div>
    <div class="cp-hue"><div class="cp-marker"></div></div>
    <div class="cp-row"><span class="cp-preview"></span><input class="cp-hex" spellcheck="false" autocomplete="off" /></div>`
  const square = root.querySelector<HTMLElement>('.cp-square')!
  const squareMarker = square.querySelector<HTMLElement>('.cp-marker')!
  const hueBar = root.querySelector<HTMLElement>('.cp-hue')!
  const hueMarker = hueBar.querySelector<HTMLElement>('.cp-marker')!
  const preview = root.querySelector<HTMLElement>('.cp-preview')!
  const hexInput = root.querySelector<HTMLInputElement>('.cp-hex')!
  document.body.appendChild(root)

  const place = () => {
    // The swatch is redrawn when the color changes; a detached one keeps the picker where it is.
    if (!anchor.isConnected) return
    const a = anchor.getBoundingClientRect()
    const r = root.getBoundingClientRect()
    let top = a.bottom + 6
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, a.top - r.height - 6)
    const left = Math.min(Math.max(8, a.left), window.innerWidth - r.width - 8)
    root.style.top = `${top}px`
    root.style.left = `${left}px`
  }

  const show = (fromInput = false) => {
    const hex = hsvToHex(hsv)
    square.style.background = `hsl(${hsv.h}, 100%, 50%)`
    squareMarker.style.left = `${hsv.s * 100}%`
    squareMarker.style.top = `${(1 - hsv.v) * 100}%`
    hueMarker.style.left = `${(hsv.h / 360) * 100}%`
    preview.style.background = hex
    if (!fromInput) hexInput.value = hex
  }

  const change = () => {
    show()
    onChange(hsvToHex(hsv))
  }

  const drag = (el: HTMLElement, apply: (fx: number, fy: number) => void) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const at = (ev: PointerEvent) => apply(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)))
      at(e)
      change()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic events have no active pointer; dragging still works.
      }
      const onMove = (ev: PointerEvent) => {
        at(ev)
        change()
      }
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    })
  }
  drag(square, (fx, fy) => {
    hsv.s = fx
    hsv.v = 1 - fy
  })
  drag(hueBar, (fx) => {
    hsv.h = fx * 360
  })

  hexInput.addEventListener('input', () => {
    const m = HEX.exec(hexInput.value.trim())
    if (!m) return
    const full = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
    Object.assign(hsv, hexToHsv(`#${full}`))
    show(true)
    onChange(`#${full.toLowerCase()}`)
  })
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      close()
    }
    e.stopPropagation()
  })

  const onOutside = (e: PointerEvent) => {
    if (e.target instanceof Node && (root.contains(e.target) || anchor.contains(e.target))) return
    close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const onBlur = () => close()
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', place)

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    window.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', place)
    root.remove()
    if (current === close) current = null
    onClose()
  }
  current = close

  show()
  place()
  hexInput.focus()
  hexInput.select()
  return close
}
