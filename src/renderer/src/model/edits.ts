import type { AttrValue } from './registry'
import type { BlockInfo, Range } from './types'

/** A replacement of a span of the source. Positions refer to the source before any edit. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 1000) / 1000
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

/** Remove whole statements together with the line breaks that follow them. */
export function removeStatements(source: string, ranges: Range[]): TextEdit[] {
  return [...ranges]
    .sort((a, b) => b.from - a.from)
    .map((range) => {
      let to = range.to
      while (to < source.length && (source[to] === '\n' || source[to] === '\r')) to++
      return { from: range.from, to, insert: '' }
    })
}
