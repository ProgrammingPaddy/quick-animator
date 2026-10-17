import * as acorn from 'acorn'
import { formatNumber, type TextEdit } from './edits'
import type { BlockInfo, PropInfo, Range } from './types'

/** The slice of the ESTree shape this file reads. */
interface Node {
  type: string
  start: number
  end: number
}
interface ArrayNode extends Node {
  type: 'ArrayExpression'
  elements: (Node | null)[]
}

/** One `[x, y]` of a path's shape as written, with where it lives in the source. */
export interface PointLiteral {
  range: Range
  x: number
  y: number
}

/** A path's shape when it is written as a list of point literals (D194), which the GUI can edit point by point. */
export interface ShapeLiteral {
  prop: PropInfo
  /** The whole `[ ... ]`. */
  range: Range
  points: PointLiteral[]
  /** One point per line, as the GUI writes it, or all on one line. */
  multiline: boolean
  /** The indentation of a point's line, for a new one. */
  indent: string
}

function numberOf(node: Node | null, source: string): number | null {
  if (!node) return null
  const text = source.slice(node.start, node.end).replace(/\s+/g, '')
  if (node.type === 'Literal') return /^\d/.test(text) ? Number(text) : null
  if (node.type === 'UnaryExpression' && /^[-+]\d/.test(text)) return Number(text)
  return null
}

/**
 * The `shape` of a path statement as literal points, each with its text range, or null when
 * the shape is missing or is code: a function, a name, or anything but numbers.
 */
export function shapeLiteral(source: string, block: BlockInfo): ShapeLiteral | null {
  const prop = block.props.find((p) => p.key === 'shape')
  if (!prop) return null
  let node: Node
  try {
    // Only the value's own text, so the parser stops at its end instead of reading on into the next key.
    node = acorn.parseExpressionAt(source.slice(0, prop.valueRange.to), prop.valueRange.from, { ecmaVersion: 'latest' }) as unknown as Node
  } catch {
    return null
  }
  if (node.type !== 'ArrayExpression') return null
  const points: PointLiteral[] = []
  for (const element of (node as ArrayNode).elements) {
    if (!element || element.type !== 'ArrayExpression') return null
    const parts = (element as ArrayNode).elements
    if (parts.length !== 2) return null
    const x = numberOf(parts[0]!, source)
    const y = numberOf(parts[1]!, source)
    if (x === null || y === null) return null
    points.push({ range: { from: element.start, to: element.end }, x, y })
  }
  const text = source.slice(node.start, node.end)
  const multiline = text.includes('\n')
  const first = points[0]
  let indent = `${block.indent}  `
  if (first && multiline) {
    const lineStart = source.lastIndexOf('\n', first.range.from - 1) + 1
    const lead = source.slice(lineStart, first.range.from)
    if (/^\s*$/.test(lead)) indent = lead
  }
  return { prop, range: { from: node.start, to: node.end }, points, multiline, indent }
}

export function pointText(x: number, y: number): string {
  return `[${formatNumber(x)}, ${formatNumber(y)}]`
}

/** Replace one point's literal. */
export function setPointEdit(shape: ShapeLiteral, index: number, x: number, y: number): TextEdit | null {
  const point = shape.points[index]
  if (!point) return null
  return { from: point.range.from, to: point.range.to, insert: pointText(x, y) }
}

/**
 * Insert points so that the first lands at `index`: before the point there now, or at the end
 * when `index` is the count. One point per line when the list is written that way.
 */
export function insertPointsEdit(source: string, shape: ShapeLiteral, index: number, points: { x: number; y: number }[]): TextEdit | null {
  if (points.length === 0 || index < 0 || index > shape.points.length) return null
  const texts = points.map((p) => pointText(p.x, p.y))
  if (shape.multiline) {
    const lines = texts.map((t) => `${shape.indent}${t},`).join('\n')
    if (index === 0) {
      // Right after the opening bracket, before the first point's line.
      const at = shape.range.from + 1
      return { from: at, to: at, insert: `\n${lines}` }
    }
    const before = shape.points[index - 1]!
    const after = source.slice(before.range.to)
    const comma = /^\s*,/.exec(after)
    if (comma) {
      const at = before.range.to + comma[0].length
      return { from: at, to: at, insert: `\n${lines}` }
    }
    // The last point had no comma: give it one, then the lines, and the new last point keeps its comma.
    return { from: before.range.to, to: before.range.to, insert: `,\n${lines}` }
  }
  if (index === 0) {
    const at = shape.range.from + 1
    return { from: at, to: at, insert: `${texts.join(', ')}, ` }
  }
  const before = shape.points[index - 1]!
  return { from: before.range.to, to: before.range.to, insert: `, ${texts.join(', ')}` }
}

/** Remove one point; the last one stays, since a path with no points is nothing. */
export function removePointEdit(source: string, shape: ShapeLiteral, index: number): TextEdit | null {
  const point = shape.points[index]
  if (!point || shape.points.length < 2) return null
  const lineStart = source.lastIndexOf('\n', point.range.from - 1) + 1
  const lineEndIndex = source.indexOf('\n', point.range.to)
  const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex
  const before = source.slice(lineStart, point.range.from)
  const after = source.slice(point.range.to, lineEnd)
  // A point alone on its line goes with the line.
  if (/^\s*$/.test(before) && /^\s*,?\s*$/.test(after)) return { from: lineStart, to: Math.min(source.length, lineEnd + 1), insert: '' }
  const comma = /^\s*,\s*/.exec(after)
  if (comma) return { from: point.range.from, to: point.range.to + comma[0].length, insert: '' }
  // The last point on a line: take the comma before it too.
  const previous = /,\s*$/.exec(before)
  return { from: previous ? point.range.from - previous[0].length : point.range.from, to: point.range.to, insert: '' }
}
