import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { openColorPicker } from './colorPicker'

/** A color string literal such as `'#4f8cff'`, with its channels. */
const COLOR_LITERAL = /^['"]#([0-9a-f]{3}|[0-9a-f]{6})['"]$/i

function sixDigits(hex: string): string {
  const h = hex.replace('#', '')
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`.toLowerCase()
}

/**
 * The open picker, tied to the literal's position rather than to the swatch: the swatch is
 * redrawn with every color change, but the picker stays until the literal goes away (D120).
 */
let active: { pos: number; close: () => void } | null = null

function openAt(view: EditorView, swatch: HTMLElement, color: string): void {
  if (active) {
    active.close()
    return
  }
  const pos = view.posAtDOM(swatch)
  const entry = {
    pos,
    close: openColorPicker(
      swatch,
      sixDigits(color),
      (hex) => {
        const node = syntaxTree(view.state).resolveInner(entry.pos + 1, 1)
        const text = view.state.sliceDoc(node.from, node.to)
        if (node.name !== 'String' || !COLOR_LITERAL.test(text)) {
          entry.close()
          return
        }
        if (text === `'${hex}'`) return
        view.dispatch({ changes: { from: node.from, to: node.to, insert: `'${hex}'` } })
      },
      () => {
        if (active === entry) active = null
      },
    ),
  }
  active = entry
}

/** A swatch before a color literal. Clicking it opens the inline picker, which rewrites the literal as it changes (D68, D120). */
class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super()
  }

  eq(other: SwatchWidget): boolean {
    return other.color === this.color
  }

  toDOM(view: EditorView): HTMLElement {
    const swatch = document.createElement('span')
    swatch.className = 'cm-color-swatch'
    swatch.style.background = this.color
    swatch.title = 'Pick a color'
    swatch.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openAt(view, swatch, this.color)
    })
    return swatch
  }

  ignoreEvent(): boolean {
    return true
  }
}

function swatches(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'String') return
        const text = view.state.sliceDoc(node.from, node.to)
        const match = COLOR_LITERAL.exec(text)
        if (match) builder.add(node.from, node.from, Decoration.widget({ widget: new SwatchWidget(`#${match[1]}`), side: -1 }))
      },
    })
  }
  return builder.finish()
}

/** Shows a clickable swatch before every color literal in view, and keeps the open picker on its literal. */
export const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = swatches(view)
    }
    update(update: ViewUpdate): void {
      if (active && update.docChanged) active.pos = update.changes.mapPos(active.pos)
      if (update.docChanged || update.viewportChanged) this.decorations = swatches(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
