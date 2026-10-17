import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { EASE_NAMES } from '../model/registry'

/** The open menu, if any; one at a time. */
let closeOpen: (() => void) | null = null

/** A menu of the ease names by an element; picking one calls back and closes. */
function openEaseMenu(anchor: HTMLElement, current: string, onPick: (name: string) => void): void {
  closeOpen?.()
  const root = document.createElement('div')
  root.className = 'cm-ease-menu'
  for (const name of EASE_NAMES) {
    const button = document.createElement('button')
    button.textContent = name
    if (name === current) button.className = 'on'
    button.addEventListener('mousedown', (e) => {
      e.preventDefault()
      onPick(name)
      close()
    })
    root.appendChild(button)
  }
  document.body.appendChild(root)
  const a = anchor.getBoundingClientRect()
  const r = root.getBoundingClientRect()
  let top = a.bottom + 4
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, a.top - r.height - 4)
  root.style.top = `${top}px`
  root.style.left = `${Math.min(Math.max(8, a.left), window.innerWidth - r.width - 8)}px`
  const onDown = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const close = () => {
    root.remove()
    window.removeEventListener('mousedown', onDown, true)
    window.removeEventListener('keydown', onKey, true)
    if (closeOpen === close) closeOpen = null
  }
  window.addEventListener('mousedown', onDown, true)
  window.addEventListener('keydown', onKey, true)
  closeOpen = close
}

/** A small arrow after an ease name; clicking it opens the menu of names, which rewrites the literal (D216). */
class EaseWidget extends WidgetType {
  constructor(
    readonly current: string,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(other: EaseWidget): boolean {
    return other.current === this.current && other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-ease-widget'
    el.textContent = '▾'
    el.title = 'Pick an ease'
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = view.posAtDOM(el)
      openEaseMenu(el, this.current, (name) => {
        // The literal just before the arrow, as it stands now.
        const node = syntaxTree(view.state).resolveInner(pos - 1, -1)
        if (node.name !== 'String') return
        view.dispatch({ changes: { from: node.from, to: node.to, insert: `'${name}'` } })
      })
    })
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

/** The `ease: 'name'` strings in view: a String whose property key is ease and whose value is one of the names. */
function easeWidgets(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'String') return
        const property = node.node.parent
        if (!property || property.name !== 'Property') return
        const key = property.firstChild
        if (!key || view.state.sliceDoc(key.from, key.to).replace(/^['"]|['"]$/g, '') !== 'ease') return
        const text = view.state.sliceDoc(node.from, node.to)
        const name = text.slice(1, -1)
        if (!/^['"]/.test(text) || !(EASE_NAMES as readonly string[]).includes(name)) return
        builder.add(node.to, node.to, Decoration.widget({ widget: new EaseWidget(name, node.from, node.to), side: 1 }))
      },
    })
  }
  return builder.finish()
}

export const easePicks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = easeWidgets(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = easeWidgets(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
