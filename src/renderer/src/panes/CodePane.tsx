import { useEffect, useRef, useState } from 'react'
import { applyEdits, createEditor, getEditor, highlightRanges, markErrorLine, placeCursor, scrollToPos, setGhostClickHandler, setGhostLines, type GhostBlock, type HighlightSpec } from '../code/editor'
import { formatValue, setProp } from '../model/edits'
import { classes, OBJECT_COLOR, VERB_COLORS } from '../model/registry'
import { commitSource } from '../project/controller'
import { useStore } from '../state/store'

interface Mark {
  from: number
  to: number
  color: string
  kind: 'full' | 'bar' | 'error'
}

/**
 * The code pane hosts the app's one editor. The selected object or action is tinted across its
 * lines and scrolled into view; everything related to it gets a left bar in the color of its
 * kind (decisions D12, D67). Unset attributes show as ghost lines (D35). A ruler on the right
 * shows where the marks and the error are in the whole file. Errors show at their line, in the
 * gutter, and below the text, and clicking the message jumps there.
 */
export function CodePane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const error = useStore((s) => s.error)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const model = useStore((s) => s.model)
  const source = useStore((s) => s.source)
  const showDefaults = useStore((s) => s.showDefaults)
  const toggleDefaults = useStore((s) => s.toggleDefaults)
  const [marks, setMarks] = useState<Mark[]>([])
  const [docLines, setDocLines] = useState(1)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = createEditor((doc) => commitSource(doc, 'editor'))
    host.appendChild(view.dom)
    return () => {
      view.dom.remove()
    }
  }, [])

  // Marks: tint the selected thing, bar what relates to it; keep the ruler in step.
  useEffect(() => {
    const spec: HighlightSpec = { full: [], bars: [] }
    if (model) {
      if (selectedAction) {
        const obj = model.objects.find((o) => o.name === selectedAction.object)
        const action = obj?.actions[selectedAction.index]
        if (action?.stmt) spec.full.push({ range: action.stmt.range, color: VERB_COLORS[action.verb] })
        if (obj?.decl) spec.bars.push({ range: obj.decl.range, color: OBJECT_COLOR })
      } else {
        for (const name of selection) {
          const obj = model.objects.find((o) => o.name === name)
          if (!obj) continue
          if (obj.decl) spec.full.push({ range: obj.decl.range, color: OBJECT_COLOR })
          for (const action of obj.actions) if (action.stmt) spec.bars.push({ range: action.stmt.range, color: VERB_COLORS[action.verb] })
        }
      }
    }
    highlightRanges(spec)
    const view = getEditor()
    if (!view) return
    const doc = view.state.doc
    const lineOf = (pos: number) => doc.lineAt(Math.max(0, Math.min(pos, doc.length))).number
    const next: Mark[] = []
    for (const f of spec.full) next.push({ from: lineOf(f.range.from), to: lineOf(f.range.to), color: f.color, kind: 'full' })
    for (const b of spec.bars) next.push({ from: lineOf(b.range.from), to: lineOf(b.range.to), color: b.color, kind: 'bar' })
    if (error?.line) next.push({ from: error.line, to: error.line, color: 'var(--error)', kind: 'error' })
    setMarks(next)
    setDocLines(doc.lines)
  }, [selection, selectedAction, model, error, source])

  // Selecting something scrolls the code to it.
  useEffect(() => {
    if (!model) return
    if (selectedAction) {
      const action = model.objects.find((o) => o.name === selectedAction.object)?.actions[selectedAction.index]
      if (action?.stmt) scrollToPos(action.stmt.range.from)
      return
    }
    const obj = selection[0] ? model.objects.find((o) => o.name === selection[0]) : undefined
    if (obj?.decl) scrollToPos(obj.decl.range.from)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, selectedAction])

  useEffect(() => {
    markErrorLine(error?.line ?? null)
  }, [error])

  // Ghost lines for unset attributes, only while the model describes the current text.
  useEffect(() => {
    const blocks: GhostBlock[] = []
    if (showDefaults && model && model.source === source) {
      for (const obj of model.objects) {
        if (!obj.decl) continue
        const schema = classes[obj.className]
        if (!schema) continue
        const present = new Set(obj.decl.props.map((p) => p.key))
        const missing = schema.attrs.filter((a) => !present.has(a.name)).map((a) => ({ key: a.name, value: formatValue(a.default) }))
        blocks.push({ name: obj.name, closePos: obj.decl.propsClose, indent: obj.decl.indent, missing })
      }
    }
    setGhostLines(blocks)
  }, [model, source, showDefaults])

  useEffect(() => {
    setGhostClickHandler((name, key) => {
      const s = useStore.getState()
      const obj = s.model && s.model.source === s.source ? s.model.objects.find((o) => o.name === name) : undefined
      const attr = obj ? classes[obj.className]?.attrs.find((a) => a.name === key) : undefined
      if (!obj?.decl || !attr) return
      const edit = setProp(s.source, obj.decl, key, attr.default)
      applyEdits([edit])
      const valueText = formatValue(attr.default)
      const valueStart = edit.from + edit.insert.indexOf(`${key}: `) + key.length + 2
      placeCursor(valueStart, valueStart + valueText.length)
      s.select([name])
    })
    return () => setGhostClickHandler(null)
  }, [])

  const jumpToError = () => {
    const view = getEditor()
    if (!view || !error?.line || error.line > view.state.doc.lines) return
    const line = view.state.doc.line(error.line)
    placeCursor(line.from + (line.text.length - line.text.trimStart().length))
  }

  const jumpToLine = (n: number) => {
    const view = getEditor()
    if (!view) return
    scrollToPos(view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines))).from)
  }

  return (
    <div className="code-pane">
      <div className="code" ref={hostRef} />
      <div className="code-tools">
        <button className={showDefaults ? 'on' : ''} onClick={toggleDefaults} title={showDefaults ? 'Showing unset attributes as ghost lines. Click to show only what is written.' : 'Showing only what is written. Click to show unset attributes as ghost lines.'} aria-pressed={showDefaults}>
          Defaults
        </button>
      </div>
      <div className="overview-ruler" aria-hidden="true">
        {marks.map((m, i) => {
          const top = ((m.from - 1) / Math.max(1, docLines)) * 100
          const height = Math.max(0.6, ((m.to - m.from + 1) / Math.max(1, docLines)) * 100)
          return <div key={i} className={`overview-mark ${m.kind}`} style={{ top: `${top}%`, height: `${height}%`, background: m.color }} onClick={() => jumpToLine(m.from)} />
        })}
      </div>
      {error && (
        <button className="code-error" onClick={jumpToError} title={error.line ? 'Jump to the error' : undefined}>
          {error.line ? `Line ${error.line}: ` : ''}
          {error.message}
          <span className="dim"> Fix it to edit from the preview and timeline.</span>
        </button>
      )}
      {!error && model?.warnings[0] && <div className="code-warning">{model.warnings[0].message}</div>}
      {!project && <div className="code-empty dim">Open a project to edit its scene.</div>}
    </div>
  )
}
