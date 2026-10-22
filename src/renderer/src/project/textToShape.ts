import * as opentype from 'opentype.js'
import { applyEdits, beginGesture, endGesture, foldShapes } from '../code/editor'
import { removeProp, setPropText, type TextEdit } from '../model/edits'
import { formatCurves, serializePathData, type Seg } from '../model/pathData'
import { SHAPE } from '../model/registry'
import { textStyleAt } from '../model/sample'
import { layoutOf, type TextStyle } from '../model/text'
import type { Action } from '../model/types'
import { useStore } from '../state/store'
import { projectFontData } from './fonts'
import { deleteActions } from './operations'

/** What a Text has that a Shape has not: the attributes that go with the kind. */
const TEXT_ATTRS = ['text', 'fontSize', 'font', 'weight', 'italic', 'align', 'lineHeight', 'letterSpacing']

/**
 * Make a Text a Shape with its letters as curves (D273): the outlines of its glyphs from its
 * font's file, the project's or an installed one, laid out as the text was, centered where the
 * text was, with the name, the place, the fill, and the rest of its animations kept. What ran on
 * the text alone, by character, word, or line, or on a size the shape has not, is listed first
 * and removed on the owner's word.
 */
export async function convertTextToShape(name: string): Promise<void> {
  const s = useStore.getState()
  const obj = s.model?.objects.find((o) => o.name === name)
  if (!s.model || !obj?.decl || obj.className !== 'Text') return
  const style = textStyleAt(s.model, obj, obj.at)
  const textOnly = obj.actions.filter((a) => !a.overridden && !a.classAction && a.stmt && (a.timing.by !== undefined || TEXT_ATTRS.some((k) => k in a.changes)))
  const run = () => void convertNow(name, style, textOnly)
  if (textOnly.length === 0) {
    run()
    return
  }
  s.openDialog({
    title: 'Convert to shape',
    message: 'A shape has no text to animate: these will be removed.',
    items: textOnly.map((a) => `${a.name ? `${a.name} = ` : ''}${name}.${a.verb}${a.timing.by ? ` by ${a.timing.by}` : ''}`),
    confirmLabel: 'Convert',
    danger: true,
    onConfirm: run,
  })
}

async function convertNow(name: string, style: TextStyle, textOnly: Action[]): Promise<void> {
  const bytes = projectFontData(style.font) ?? (await window.api?.project.findFont(style.font))?.data ?? null
  const s = useStore.getState()
  if (!bytes) {
    s.openDialog({ title: 'Font not found', message: `No file for "${style.font}" was found. Put its .ttf or .otf in the project's assets/fonts folder, or choose an installed font.`, confirmLabel: 'OK', onConfirm: () => {} })
    return
  }
  let font: opentype.Font
  try {
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  } catch {
    s.openDialog({ title: 'Font not read', message: `The file for "${style.font}" could not be read as a font.`, confirmLabel: 'OK', onConfirm: () => {} })
    return
  }
  const layout = layoutOf(style)
  // The glyphs' outlines, line by line where the lines were laid, the block's center at the origin, up being up.
  const segs: Seg[] = []
  const X = (x: number): number => Math.round((x - layout.width / 2) * 100) / 100
  const Y = (y: number): number => Math.round((layout.height / 2 - y) * 100) / 100
  for (const line of layout.lines) {
    if (line.text.length === 0) continue
    const path = font.getPath(line.text, line.left, line.baseline, style.fontSize, { kerning: true, letterSpacing: style.letterSpacing / style.fontSize })
    for (const c of path.commands) {
      if (c.type === 'M') segs.push({ c: 'M', x: X(c.x ?? 0), y: Y(c.y ?? 0) })
      else if (c.type === 'L') segs.push({ c: 'L', x: X(c.x ?? 0), y: Y(c.y ?? 0) })
      else if (c.type === 'C') segs.push({ c: 'C', x1: X(c.x1 ?? 0), y1: Y(c.y1 ?? 0), x2: X(c.x2 ?? 0), y2: Y(c.y2 ?? 0), x: X(c.x ?? 0), y: Y(c.y ?? 0) })
      else if (c.type === 'Q') segs.push({ c: 'Q', x1: X(c.x1 ?? 0), y1: Y(c.y1 ?? 0), x: X(c.x ?? 0), y: Y(c.y ?? 0) })
      else segs.push({ c: 'Z' })
    }
  }
  if (segs.length === 0) return
  beginGesture()
  try {
    if (textOnly.length > 0) {
      const obj = useStore.getState().model?.objects.find((o) => o.name === name)
      if (obj) deleteActions(textOnly.map((a) => ({ object: name, index: obj.actions.indexOf(a) })).filter((r) => r.index >= 0), true)
    }
    const after = useStore.getState()
    const obj = after.model?.objects.find((o) => o.name === name)
    const decl = obj?.decl
    if (!obj || !decl) return
    const head = after.source.slice(decl.range.from, decl.propsOpen)
    const at = head.lastIndexOf('Text(')
    if (at < 0) return
    // The kind and the text's own attributes first, then the curves into the block as it then is, so no two edits overlap.
    const first: TextEdit[] = [{ from: decl.range.from + at, to: decl.range.from + at + 'Text'.length, insert: SHAPE }]
    for (const key of TEXT_ATTRS) {
      const edit = removeProp(after.source, decl, key)
      if (edit && !first.some((e) => e.from < edit.to && edit.from < e.to)) first.push(edit)
    }
    applyEdits(first, { selection: [name], selectedActions: [] })
    const fresh = useStore.getState()
    const again = fresh.model?.objects.find((o) => o.name === name)?.decl
    if (!fresh.model || !again) return
    applyEdits([setPropText(fresh.source, again, 'curves', formatCurves(serializePathData(segs), again.indent))], { selection: [name], selectedActions: [] })
  } finally {
    endGesture()
  }
  foldShapes()
}
