import { formatCurves, hasPathData } from './pathData'
import type { AttrValue } from './registry'
import type { BlockInfo, Range } from './types'

/** Whether a value is curves, SVG path data, which the code writes as a template string of lines (D244). */
function isCurves(key: string, value: AttrValue): value is string {
  return (key === 'curves' || key === 'shape' || key === 'to') && typeof value === 'string' && hasPathData(value)
}

/** Whether a value is a Shape's points, which the code writes one per line, as a path's, so they fold (D244). */
function isPoints(key: string, value: AttrValue): value is number[][] {
  return key === 'points' && Array.isArray(value)
}

/** A list of points as the code writes it: one per line, a step in from the block's properties. */
function formatPoints(points: number[][], indent: string): string {
  if (points.length === 0) return '[]'
  return `[\n${points.map((p) => `${indent}  [${p.map(formatNumber).join(', ')}],`).join('\n')}\n${indent}]`
}

/** A value as a block writes it: curves and points on their own lines, anything else on the property's. */
function propText(key: string, value: AttrValue, indent: string): string {
  if (isCurves(key, value)) return formatCurves(value, indent)
  if (isPoints(key, value)) return formatPoints(value, indent)
  return formatValue(value)
}

/** A replacement of a span of the source. Positions refer to the source before any edit. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** A number as written: at most four decimals, so a frame's length and a frame-aligned start survive (D110). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 10000) / 10000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

export function formatValue(value: AttrValue): string {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return String(value)
  // A list of points, on one line (D232).
  if (Array.isArray(value)) return `[${value.map((p) => `[${p.map(formatNumber).join(', ')}]`).join(', ')}]`
  // A line break in a Text's words is written as the escape, so the line of code stays one line (D267).
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`
}

/** Set one attribute in a block: replace its literal, or add a line when it is not there. A number given to a range, `[from, to]`, replaces the `to` (D221). */
/**
 * The smallest edit, whole lines at a time, that turns the text at a range into other text: the
 * lines both begin and end with are left alone, so a fold over the text stays folded and only
 * the lines that changed go into the history (D254). Null when nothing changes.
 */
export function lineEdit(source: string, from: number, to: number, text: string): TextEdit | null {
  const old = source.slice(from, to)
  if (old === text) return null
  const a = old.split('\n')
  const b = text.split('\n')
  if (a.length < 3 || b.length < 3) return { from, to, insert: text }
  let p = 0
  while (p < a.length - 1 && p < b.length - 1 && a[p] === b[p]) p++
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  if (p === 0 || q === 0) return { from, to, insert: text }
  // The lines between, each with the newline that ends it, from the start of the first to the start of the first kept at the end.
  const head = a.slice(0, p).join('\n').length + 1
  const tail = a.slice(a.length - q).join('\n').length
  return { from: from + head, to: to - tail, insert: text.slice(head, text.length - tail) }
}

export function setProp(source: string, block: BlockInfo, key: string, value: AttrValue): TextEdit {
  const prop = block.props.find((p) => p.key === key)
  if (prop?.parts && typeof value === 'number') return { from: prop.parts[1].from, to: prop.parts[1].to, insert: formatValue(value) }
  return setPropText(source, block, key, propText(key, value, block.indent))
}

/** A time written as frames, `frames(15)`, with its count. */
const FRAMES = /^frames\(\s*(-?\d+(?:\.\d+)?)\s*\)$/

/** Set a time in a block as it was written (D276): one written as `frames(n)` stays frames, the count whole when the time sits on a frame; any other way, seconds. */
export function setTimeProp(source: string, block: BlockInfo, key: string, seconds: number, fps: number): TextEdit {
  const prop = block.props.find((p) => p.key === key)
  if (prop && FRAMES.test(prop.raw.trim())) {
    const count = seconds * fps
    const whole = Math.round(count)
    return setPropText(source, block, key, `frames(${Math.abs(count - whole) < 1e-6 ? whole : formatNumber(count)})`)
  }
  return setProp(source, block, key, seconds)
}

/** Set where a ranged attribute begins from, the `from` of `[from, to]`; null when the attribute is not written as a range (D221). */
export function setPropFrom(block: BlockInfo, key: string, value: number): TextEdit | null {
  const prop = block.props.find((p) => p.key === key)
  if (!prop?.parts) return null
  return { from: prop.parts[0].from, to: prop.parts[0].to, insert: formatValue(value) }
}

/** Set a property to code as written, such as a time reference `slide.end` (D170). */
export function setPropText(source: string, block: BlockInfo, key: string, text: string): TextEdit {
  const prop = block.props.find((p) => p.key === key)
  if (prop) return { from: prop.valueRange.from, to: prop.valueRange.to, insert: text }
  const multiline = source.slice(block.propsOpen, block.propsClose).includes('\n')
  if (block.props.length === 0) {
    return multiline
      ? { from: block.propsOpen, to: block.propsOpen, insert: `\n${block.indent}${key}: ${text},` }
      : { from: block.propsOpen, to: block.propsClose, insert: ` ${key}: ${text} ` }
  }
  if (!multiline) {
    return block.trailingComma
      ? { from: block.lastPropEnd, to: block.lastPropEnd, insert: ` ${key}: ${text},` }
      : { from: block.lastPropEnd, to: block.lastPropEnd, insert: `, ${key}: ${text}` }
  }
  return block.trailingComma
    ? { from: block.lastPropEnd, to: block.lastPropEnd, insert: `\n${block.indent}${key}: ${text},` }
    : { from: block.lastPropEnd, to: block.lastPropEnd, insert: `,\n${block.indent}${key}: ${text}` }
}

/** Remove one attribute line from a block, or just the property when it shares a line. Null when absent. */
export function removeProp(source: string, block: BlockInfo, key: string): TextEdit | null {
  const prop = block.props.find((p) => p.key === key)
  if (!prop) return null
  const lineStart = source.lastIndexOf('\n', prop.range.from - 1) + 1
  const lineEndIndex = source.indexOf('\n', prop.range.to)
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex
  const before = source.slice(lineStart, prop.range.from)
  const after = source.slice(prop.range.to, lineEnd)
  if (/^\s*$/.test(before) && /^\s*,?\s*$/.test(after)) return { from: lineStart, to: Math.min(source.length, lineEnd + 1), insert: '' }
  const comma = /^\s*,\s*/.exec(after)
  return { from: prop.range.from, to: prop.range.to + (comma ? comma[0].length : 0), insert: '' }
}

/** A statement such as `box = Rect({ ... })` or `box.move({ ... })`, one attribute per line. */
export function blockText(head: string, attrs: Record<string, AttrValue>): string {
  const lines = Object.entries(attrs).map(([key, value]) => `  ${key}: ${propText(key, value, '  ')},`)
  return `${head}({\n${lines.join('\n')}\n})`
}

/** Insert a new object declaration after the last one, or at the top when there is none. */
export function insertDeclaration(lastDeclEnd: number | null, text: string): TextEdit {
  if (lastDeclEnd === null) return { from: 0, to: 0, insert: `${text}\n\n` }
  return { from: lastDeclEnd, to: lastDeclEnd, insert: `\n\n${text}` }
}

/** Append a statement at the end of the script, separated by a blank line. */
export function appendStatement(source: string, text: string): TextEdit {
  const trimmed = source.replace(/\s+$/, '')
  const prefix = trimmed.length === 0 ? '' : '\n\n'
  return { from: trimmed.length, to: source.length, insert: `${prefix}${text}\n` }
}

/** The start of the comment lines directly above a statement, with no blank line between, or the statement's own start (D129). */
function attachedCommentStart(source: string, from: number): number {
  const lineStartOf = (pos: number): number => {
    let at = pos
    while (at > 0 && source[at - 1] !== '\n') at--
    return at
  }
  let start = lineStartOf(from)
  // Only a statement that begins its line owns the lines above it.
  if (source.slice(start, from).trim() !== '') return from
  while (start > 0) {
    const previousStart = lineStartOf(start - 1)
    const line = source.slice(previousStart, start).trim()
    if (line.startsWith('//')) start = previousStart
    else if (line.endsWith('*/')) {
      // A block comment belongs here when its opening also begins its line.
      const open = source.lastIndexOf('/*', start - 1)
      if (open < 0) break
      const openLine = lineStartOf(open)
      if (source.slice(openLine, open).trim() !== '') break
      start = openLine
    } else break
  }
  return start
}

/**
 * Move a statement elsewhere in the file, its comment lines with it (D129, D210): the edits that
 * take it out, line breaks after it included, and put it before or after another statement.
 */
export function moveStatementEdits(source: string, range: Range, target: Range, where: 'before' | 'after'): TextEdit[] {
  const from = attachedCommentStart(source, range.from)
  let to = range.to
  while (to < source.length && (source[to] === '\n' || source[to] === '\r')) to++
  const text = source.slice(from, range.to)
  const at = where === 'before' ? attachedCommentStart(source, target.from) : target.to
  return [
    { from, to, insert: '' },
    where === 'before' ? { from: at, to: at, insert: `${text}\n\n` } : { from: at, to: at, insert: `\n\n${text}` },
  ]
}

/** Remove whole statements together with the comment lines directly above them and the line breaks that follow them (D129). */
export function removeStatements(source: string, ranges: Range[]): TextEdit[] {
  return [...ranges]
    .sort((a, b) => b.from - a.from)
    .map((range) => {
      let to = range.to
      while (to < source.length && (source[to] === '\n' || source[to] === '\r')) to++
      return { from: attachedCommentStart(source, range.from), to, insert: '' }
    })
}
