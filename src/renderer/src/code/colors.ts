import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** A color string literal such as `'#4f8cff'`, with its channels. */
const COLOR_LITERAL = /^['"]#([0-9a-f]{3}|[0-9a-f]{6})['"]$/i

function sixDigits(hex: string): string {
  const h = hex.replace('#', '')
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`.toLowerCase()
}

/** A swatch before a color literal. Clicking it opens the system color picker, which rewrites the literal. */
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
    const input = document.createElement('input')
    input.type = 'color'
    input.className = 'cm-color-input'
    input.value = sixDigits(this.color)
    swatch.appendChild(input)
    swatch.addEventListener('mousedown', (e) => {
      e.preventDefault()
      input.click()
    })
    input.addEventListener('input', () => {
      // The literal follows the swatch. Positions may have moved since the swatch was drawn.
      const pos = view.posAtDOM(swatch)
      const node = syntaxTree(view.state).resolveInner(pos + 1, 1)
      if (node.name !== 'String') return
      view.dispatch({ changes: { from: node.from, to: node.to, insert: `'${input.value}'` } })
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

/** Shows a clickable swatch before every color literal in view. */
export const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = swatches(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = swatches(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
