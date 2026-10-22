/**
 * Text laid out (D267) and drawn, by the whole or by its units (D268): the lines of a text, each
 * character and word with its place, measured by whoever draws, the renderer's canvas or an
 * estimate, so the sampler's box, the preview, and the preset card agree.
 */

export type UnitKind = 'char' | 'word' | 'line'
export const UNIT_KINDS: readonly UnitKind[] = ['char', 'word', 'line']
/** Seconds between one unit's start and the next when `by` is written without `stagger`. */
export const DEFAULT_STAGGER = 0.05

export interface TextStyle {
  text: string
  fontSize: number
  font: string
  weight: number
  italic: boolean
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
}

/** What a measurer says about a run of text at a style: its advance, and the font's ascent and descent at the size. */
export interface TextMeasure {
  width: number
  ascent: number
  descent: number
}

export type Measurer = (text: string, style: TextStyle) => TextMeasure

/** Whoever draws text sets this to measure with the same font; without one, an estimate serves. */
export const textMeasure: { current: Measurer | null } = { current: null }

/** A rough measure for when no canvas is at hand: a character a little over half the size wide. */
export function estimateMeasure(text: string, style: TextStyle): TextMeasure {
  const n = Array.from(text).length
  return { width: n * style.fontSize * 0.55 + Math.max(0, n - 1) * style.letterSpacing, ascent: style.fontSize * 0.8, descent: style.fontSize * 0.2 }
}

/** One unit of a text and where it sits: its text, its line and, for a character, its word; its left edge and baseline from the block's top left, the canvas way, down; its width; and its center in the text's own space, up being up. */
export interface TextUnit {
  text: string
  line: number
  word: number
  left: number
  baseline: number
  width: number
  cx: number
  cy: number
}

export interface TextLayout {
  style: TextStyle
  /** The block: the widest line by the lines' height. */
  width: number
  height: number
  ascent: number
  descent: number
  lines: { text: string; left: number; baseline: number; width: number }[]
  /** Every character but the spaces, every word, and every line, in reading order. */
  units: Record<UnitKind, TextUnit[]>
}

/** The CSS font a style draws with, at a scale of canvas pixels per world pixel. */
export function fontSpec(style: TextStyle, scale = 1): string {
  const px = Math.max(1, style.fontSize * scale)
  return `${style.italic ? 'italic ' : ''}${Math.max(100, Math.min(900, Math.round(style.weight) || 400))} ${px}px "${style.font}", "Segoe UI", sans-serif`
}

/** The lines of a text: a line break starts a new one. */
export function textLines(text: string): string[] {
  return text.split('\n')
}

/** When each unit begins, from the action's start (D268, D269): `stagger` seconds after the one before, or, for a function of the index, the gap it gives before that unit; the first begins at once. */
export function unitBegins(stagger: number | ((index: number) => number) | undefined, count: number): number[] {
  const begins: number[] = []
  let at = 0
  for (let k = 0; k < count; k++) {
    if (k > 0) {
      let gap = DEFAULT_STAGGER
      if (typeof stagger === 'function') {
        try {
          gap = Number(stagger(k))
        } catch {
          gap = DEFAULT_STAGGER
        }
      } else if (typeof stagger === 'number') gap = stagger
      at += Number.isFinite(gap) ? Math.max(0, gap) : DEFAULT_STAGGER
    }
    begins.push(at)
  }
  return begins
}

/** How many units of a kind a text has: its lines, its words, or its characters but the spaces (D268). */
export function unitCount(text: string, kind: UnitKind): number {
  const lines = textLines(text)
  if (kind === 'line') return lines.length
  if (kind === 'word') return lines.reduce((n, line) => n + line.split(/\s+/).filter((w) => w.length > 0).length, 0)
  return lines.reduce((n, line) => n + Array.from(line).filter((c) => !/\s/.test(c)).length, 0)
}

const layouts = new Map<string, TextLayout>()

function styleKey(style: TextStyle): string {
  return [style.text, style.fontSize, style.font, style.weight, style.italic ? 1 : 0, style.align, style.lineHeight, style.letterSpacing].join('\u0000')
}

/** Drop every layout, for when a font arrives and the measurements change. */
export function forgetTextLayouts(): void {
  layouts.clear()
}

/** The layout of a text at a style, kept while the style is the same. */
export function layoutOf(style: TextStyle): TextLayout {
  const key = styleKey(style)
  const known = layouts.get(key)
  if (known) return known
  const layout = layoutText(style, textMeasure.current ?? estimateMeasure)
  if (layouts.size > 500) layouts.clear()
  layouts.set(key, layout)
  return layout
}

/**
 * Lay a text out: lines stacked by the line height, each set left, centered, or right in the
 * block; every word and every character placed by measuring the line up to it, so kerning
 * holds and a character drawn alone lands where the whole line would put it.
 */
export function layoutText(style: TextStyle, measure: Measurer): TextLayout {
  const texts = textLines(style.text)
  const probe = measure('Hg', style)
  const ascent = probe.ascent
  const descent = probe.descent
  const step = style.fontSize * style.lineHeight
  const widths = texts.map((t) => (t.length > 0 ? measure(t, style).width : 0))
  const width = Math.max(1, ...widths)
  const height = Math.max(1, step * (texts.length - 1) + ascent + descent)
  const lines = texts.map((text, i) => {
    const w = widths[i]!
    const left = style.align === 'left' ? 0 : style.align === 'right' ? width - w : (width - w) / 2
    return { text, left, baseline: ascent + i * step, width: w }
  })
  const units: Record<UnitKind, TextUnit[]> = { char: [], word: [], line: [] }
  const unit = (text: string, line: number, word: number, left: number, baseline: number, w: number): TextUnit => ({ text, line, word, left, baseline, width: w, cx: left + w / 2 - width / 2, cy: height / 2 - (baseline + (descent - ascent) / 2) })
  lines.forEach((line, li) => {
    units.line.push(unit(line.text, li, -1, line.left, line.baseline, line.width))
    const chars = Array.from(line.text)
    // The advance up to each character, measured on the line so far, which keeps the kerning: a character's own origin is where the line's advance reaches the end of it, less its own width, so a kerned pair sits as the line sets it (D274).
    const advance: number[] = [0]
    let prefix = ''
    for (const ch of chars) {
      prefix += ch
      advance.push(measure(prefix, style).width)
    }
    const own = (text: string): number => measure(text, style).width
    const spaced = (w: number): number => Math.max(0, w - style.letterSpacing)
    let word = -1
    let inWord = false
    chars.forEach((ch, ci) => {
      const space = /\s/.test(ch)
      if (!space && !inWord) {
        // A word runs from here to the next space.
        let end = ci
        while (end < chars.length && !/\s/.test(chars[end]!)) end++
        const text = chars.slice(ci, end).join('')
        const w = own(text)
        word = units.word.length
        units.word.push(unit(text, li, word, line.left + advance[end]! - w, line.baseline, spaced(w)))
      }
      inWord = !space
      if (!space) {
        const w = own(ch)
        units.char.push(unit(ch, li, word, line.left + advance[ci + 1]! - w, line.baseline, spaced(w)))
      }
    })
  })
  return { style, width, height, ascent, descent, lines, units }
}

/** What a unit's animations have made of it right now (D268): offsets, a factor on its size, its opacity, its fill, null for the text's own, and the text it shows in place of its own, null for its own (D269). */
export interface UnitState {
  dx: number
  dy: number
  rotation: number
  scale: number
  opacity: number
  fill: string | null
  text: string | null
}

/**
 * Draw a laid-out text on a canvas: whole lines, or when the characters have states, each
 * character on its own with its offset, turn, size, opacity, and fill about its center. `scale`
 * is canvas pixels per world pixel, and the block's top left sits at `ox, oy` in world pixels.
 */
export function drawText(ctx: CanvasRenderingContext2D, layout: TextLayout, fill: string, states: UnitState[] | null, scale: number, ox: number, oy: number): void {
  const { style } = layout
  ctx.save()
  ctx.scale(scale, scale)
  ctx.font = fontSpec(style)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  // The font's kerning, in the measuring and the drawing alike (D274).
  ctx.fontKerning = 'normal'
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in spaced) spaced.letterSpacing = `${style.letterSpacing}px`
  if (!states) {
    ctx.fillStyle = fill
    for (const line of layout.lines) if (line.text.length > 0) ctx.fillText(line.text, ox + line.left, oy + line.baseline)
    ctx.restore()
    return
  }
  const { ascent, descent } = layout
  layout.units.char.forEach((unit, i) => {
    const s = states[i]
    if (!s || s.opacity <= 0.0005 || s.scale === 0) return
    // The character's center, then its state about that center; its own offset goes up for a positive dy.
    const cx = ox + unit.left + unit.width / 2 + s.dx
    const cy = oy + unit.baseline + (descent - ascent) / 2 - s.dy
    ctx.save()
    ctx.translate(cx, cy)
    if (s.rotation !== 0) ctx.rotate((-s.rotation * Math.PI) / 180)
    if (s.scale !== 1) ctx.scale(s.scale, s.scale)
    ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity))
    ctx.fillStyle = s.fill ?? fill
    // A character shown in place of its own sits centered in its slot (D269).
    const shown = s.text ?? unit.text
    const width = shown === unit.text ? unit.width : ctx.measureText(shown).width
    ctx.fillText(shown, -width / 2, (ascent - descent) / 2)
    ctx.restore()
  })
  ctx.restore()
}

/** How far the characters, in their states, reach beyond the block on each side, in world pixels: what a canvas must add around the block to hold them. */
export function unitOverflow(layout: TextLayout, states: UnitState[]): { x: number; y: number } {
  let x = 0
  let y = 0
  const { ascent, descent, width, height } = layout
  layout.units.char.forEach((unit, i) => {
    const s = states[i]
    if (!s || s.opacity <= 0.0005) return
    const cx = unit.left + unit.width / 2 + s.dx
    const cy = unit.baseline + (descent - ascent) / 2 - s.dy
    // The turned and scaled box of the character, by its half diagonal.
    const reach = (Math.hypot(unit.width, ascent + descent) / 2) * Math.abs(s.scale)
    x = Math.max(x, reach - cx, cx + reach - width)
    y = Math.max(y, reach - cy, cy + reach - height)
  })
  return { x: Math.ceil(x), y: Math.ceil(y) }
}
