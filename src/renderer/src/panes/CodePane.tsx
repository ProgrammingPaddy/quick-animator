import { useEffect, useRef, useState } from 'react'
import { applyEdits, createEditor, getEditor, highlightRanges, markErrorLine, placeCursor, scrollToPos, setGhostClickHandler, setGhostLines, type GhostBlock, type HighlightSpec } from '../code/editor'
import { DEFAULT_EASE_FRACTION } from '../model/easing'
import { formatNumber, formatValue, setProp } from '../model/edits'
import { classes, OBJECT_COLOR, VERB_COLORS } from '../model/registry'
import type { Action } from '../model/types'
import { commitSource } from '../project/controller'
import { useStore } from '../state/store'

interface Mark {
  from: number
  to: number
  color: string
  kind: 'full' | 'bar' | 'error'
}

/** The timing an action runs with but does not say: its start, delay, length, easing, and relativity (D114); an orbit's unsaid parameters too. */
function timingDefaults(action: Action): { key: string; value: string }[] {
  const present = new Set(action.stmt?.props.map((p) => p.key) ?? [])
  const duration = action.end - action.start
  const out: { key: string; value: string }[] = []
  if (action.verb === 'orbit') for (const key of ['dx', 'dy', 'angle']) if (!present.has(key)) out.push({ key, value: '0' })
  if (!present.has('at')) out.push({ key: 'at', value: formatNumber(action.start - (action.timing.delay ?? 0)) })
  if (!present.has('delay')) out.push({ key: 'delay', value: '0' })
  if (!present.has('duration') && !present.has('until')) out.push({ key: 'duration', value: formatNumber(duration) })
  if (!present.has('ease')) {
    if (!present.has('easeIn')) out.push({ key: 'easeIn', value: formatNumber(duration * DEFAULT_EASE_FRACTION) })
    if (!present.has('easeOut')) out.push({ key: 'easeOut', value: formatNumber(duration * DEFAULT_EASE_FRACTION) })
  }
  if (!present.has('relative')) out.push({ key: 'relative', value: 'false' })
  return out
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
  const selectedActions = useStore((s) => s.selectedActions)
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
      if (selectedActions.length > 0) {
        for (const ref of selectedActions) {
          const obj = model.objects.find((o) => o.name === ref.object)
          const action = obj?.actions[ref.index]
          if (action?.stmt) spec.full.push({ range: action.stmt.range, color: VERB_COLORS[action.verb] })
          if (obj?.decl) spec.bars.push({ range: obj.decl.range, color: OBJECT_COLOR })
        }
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
  }, [selection, selectedActions, model, error, source])

  // Selecting something scrolls the code to it.
  useEffect(() => {
    if (!model) return
    const primary = selectedActions[0]
    if (primary) {
      const action = model.objects.find((o) => o.name === primary.object)?.actions[primary.index]
      if (action?.stmt) scrollToPos(action.stmt.range.from)
      return
    }
    const obj = selection[0] ? model.objects.find((o) => o.name === selection[0]) : undefined
    if (obj?.decl) scrollToPos(obj.decl.range.from)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, selectedActions])

  useEffect(() => {
    markErrorLine(error?.line ?? null)
  }, [error])

  // Ghost lines for unset attributes and unset timing, only while the model describes the current text.
  useEffect(() => {
    const blocks: GhostBlock[] = []
    if (showDefaults && model && model.source === source) {
      for (const obj of model.objects) {
        if (obj.decl) {
          const schema = classes[obj.className]
          if (schema) {
            const present = new Set(obj.decl.props.map((p) => p.key))
            // Derived attributes, such as a circle's width from its radius, stay out of the file unless set.
            const missing = schema.attrs.filter((a) => !present.has(a.name) && !a.derive).map((a) => ({ key: a.name, value: formatValue(a.default) }))
            blocks.push({ name: obj.name, closePos: obj.decl.propsClose, indent: obj.decl.indent, missing })
          }
        }
        obj.actions.forEach((action, index) => {
          if (!action.stmt || action.classAction) return
          const missing = timingDefaults(action)
          if (missing.length > 0) blocks.push({ name: obj.name, index, closePos: action.stmt.propsClose, indent: action.stmt.indent, missing })
        })
      }
    }
    setGhostLines(blocks)
  }, [model, source, showDefaults])

  useEffect(() => {
    setGhostClickHandler((name, key, index) => {
      const s = useStore.getState()
      const obj = s.model && s.model.source === s.source ? s.model.objects.find((o) => o.name === name) : undefined
      if (!obj) return
      let edit
      if (index !== undefined) {
        // A timing line of an action: write the value it has had all along (D114).
        const action = obj.actions[index]
        const ghost = action ? timingDefaults(action).find((g) => g.key === key) : undefined
        if (!action?.stmt || !ghost) return
        edit = setProp(s.source, action.stmt, key, key === 'relative' ? false : Number(ghost.value))
        applyEdits([edit])
        s.selectAction(name, index)
      } else {
        const attr = classes[obj.className]?.attrs.find((a) => a.name === key)
        if (!obj.decl || !attr) return
        edit = setProp(s.source, obj.decl, key, attr.default)
        applyEdits([edit])
        s.select([name])
      }
      const valueStart = edit.from + edit.insert.indexOf(`${key}: `) + key.length + 2
      const valueText = edit.insert.slice(edit.insert.indexOf(`${key}: `) + key.length + 2).replace(/,?\s*$/, '')
      placeCursor(valueStart, valueStart + valueText.length)
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
