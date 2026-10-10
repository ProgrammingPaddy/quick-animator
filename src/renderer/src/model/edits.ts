import type { AttrValue } from './registry'
import type { BlockInfo, Range } from './types'

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
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Set one attribute in a block: replace its literal, or add a line when it is not there. */
export function setProp(source: string, block: BlockInfo, key: string, value: AttrValue): TextEdit {
  const text = formatValue(value)
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
  const lines = Object.entries(attrs).map(([key, value]) => `  ${key}: ${formatValue(value)},`)
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
