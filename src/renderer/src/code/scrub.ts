import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'

/**
 * Alt and a drag on a number changes it (D216): one per 4 px, ten with Shift, a tenth with
 * Ctrl; the number keeps its decimals, and the whole drag is one undo step, through the gesture
 * handed in.
 */
export function numberScrub(gesture: { begin: () => void; end: () => void }) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.altKey || event.button !== 0) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      let node = syntaxTree(view.state).resolveInner(pos, 1)
      if (node.name !== 'Number') node = syntaxTree(view.state).resolveInner(pos, -1)
      if (node.name !== 'Number') return false
      let from = node.from
      const to = node.to
      // A minus sign in front belongs to the value.
      if (from > 0 && view.state.sliceDoc(from - 1, from) === '-') from--
      const text = view.state.sliceDoc(from, to)
      const start = Number(text)
      if (!Number.isFinite(start)) return false
      event.preventDefault()
      const decimals = (text.split('.')[1] ?? '').length
      const x0 = event.clientX
      let range = { from, to }
      let last = text
      let begun = false
      const onMove = (ev: MouseEvent) => {
        const stepSize = ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1
        const places = ev.ctrlKey ? Math.max(decimals, 1) : decimals
        const value = start + Math.round((ev.clientX - x0) / 4) * stepSize
        const next = String(Math.round(value * 10 ** places) / 10 ** places)
        if (next === last) return
        if (!begun) {
          begun = true
          gesture.begin()
        }
        view.dispatch({ changes: { from: range.from, to: range.to, insert: next } })
        range = { from: range.from, to: range.from + next.length }
        last = next
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (begun) gesture.end()
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return true
    },
  })
}
