import { RangeSetBuilder, StateEffect } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Every time in the code with its frames beside it, and frames with their seconds (D276): a
 * dim note at the end of a timing line, `at: 0.5` with `30 f`, `duration: frames(60)` with
 * `1 s`, at the project's rate. The app sets the rate and whether the notes show.
 */

const TIMING_LINE = /^\s*(?:at|delay|duration|until|easeIn|easeOut|stagger):\s*(.+?)\s*,?\s*$/
const NUMBER = /^-?\d+(?:\.\d+)?$/
const FRAMES = /^frames\(\s*(-?\d+(?:\.\d+)?)\s*\)$/

const config = { fps: 60, enabled: true }
const refresh = StateEffect.define<null>()

/** Set the rate and whether the notes show; the open editor, if any, redraws them. */
export function setTimeHints(fps: number, enabled: boolean, view: EditorView | null): void {
  if (config.fps === fps && config.enabled === enabled) return
  config.fps = fps
  config.enabled = enabled
  if (view) queueMicrotask(() => view.dispatch({ effects: refresh.of(null) }))
}

function fmt(n: number, decimals: number): string {
  const rounded = Math.round(n * 10 ** decimals) / 10 ** decimals
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

class HintWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: HintWidget): boolean {
    return other.text === this.text
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-time-hint'
    span.textContent = this.text
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

function hints(view: EditorView): DecorationSet {
  if (!config.enabled) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const seen = new Set<number>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        const m = TIMING_LINE.exec(line.text)
        if (m) {
          const value = m[1]!
          let text: string | null = null
          if (NUMBER.test(value)) text = `${fmt(Number(value) * config.fps, 2)} f`
          else {
            const frames = FRAMES.exec(value)
            if (frames) text = `${fmt(Number(frames[1]) / config.fps, 4)} s`
          }
          if (text) builder.add(line.to, line.to, Decoration.widget({ widget: new HintWidget(text), side: 1 }))
        }
      }
      if (line.to >= view.state.doc.length) break
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export const timeHints = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = hints(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) this.decorations = hints(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
