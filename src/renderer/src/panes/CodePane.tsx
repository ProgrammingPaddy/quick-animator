import { useEffect, useRef } from 'react'
import { createEditor, highlightRanges, markErrorLine, type HighlightSpec } from '../code/editor'
import { OBJECT_COLOR, VERB_COLORS } from '../model/registry'
import { commitSource } from '../project/controller'
import { useStore } from '../state/store'

/**
 * The code pane hosts the app's one editor. The selected object or action is tinted across its
 * lines; everything related to it gets a left bar in the color of its kind (decision D12).
 * Errors show at their line and below the text.
 */
export function CodePane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const error = useStore((s) => s.error)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const model = useStore((s) => s.model)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = createEditor((doc) => commitSource(doc, 'editor'))
    host.appendChild(view.dom)
    return () => {
      view.dom.remove()
    }
  }, [])

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
  }, [selection, selectedAction, model])

  useEffect(() => {
    markErrorLine(error?.line ?? null)
  }, [error])

  return (
    <div className="code-pane">
      <div className="code" ref={hostRef} />
      {error && (
        <div className="code-error" role="alert">
          {error.line ? `Line ${error.line}: ` : ''}
          {error.message}
          <span className="dim"> Fix it to edit from the preview and timeline.</span>
        </div>
      )}
      {!project && <div className="code-empty dim">Open a project to edit its scene.</div>}
    </div>
  )
}
