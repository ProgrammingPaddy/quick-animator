import { useEffect, useRef } from 'react'
import { createEditor, highlightRanges, markErrorLine } from '../code/editor'
import type { Range } from '../model/types'
import { commitSource } from '../project/controller'
import { useStore } from '../state/store'

/**
 * The code pane hosts the app's one editor. Selecting an object highlights its declaration and
 * all of its actions (decision D12). Errors show at their line and below the text.
 */
export function CodePane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const error = useStore((s) => s.error)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
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
    const ranges: Range[] = []
    if (model) {
      for (const name of selection) {
        const obj = model.objects.find((o) => o.name === name)
        if (!obj) continue
        if (obj.decl) ranges.push(obj.decl.range)
        for (const action of obj.actions) if (action.stmt) ranges.push(action.stmt.range)
      }
    }
    highlightRanges(ranges)
  }, [selection, model])

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
