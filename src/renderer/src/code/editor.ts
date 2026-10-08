import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentSelection, redo, undo } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, drawSelection, gutterLineClass, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import type { TextEdit } from '../model/edits'
import type { Range } from '../model/types'
import { colorSwatches } from './colors'
import { sceneCompletions } from './completions'
import { editorHighlight, editorTheme } from './theme'

/**
 * One editor for the whole app. It outlives the code pane, so collapsing the pane keeps the
 * undo history, and GUI edits always have somewhere to go (decision D22).
 */

/** What to mark in the code: full-line tints for the thing selected, left bars for what relates to it. */
export interface HighlightSpec {
  full: { range: Range; color: string }[]
  bars: { range: Range; color: string }[]
}

/** Unset attributes of one object, shown as ghost lines before its closing brace (D35). */
export interface GhostBlock {
  name: string
  /** Position of the closing brace of the attribute block. */
  closePos: number
  indent: string
  missing: { key: string; value: string }[]
}

const setHighlights = StateEffect.define<HighlightSpec>()
const setErrorLine = StateEffect.define<number | null>()
const setGhosts = StateEffect.define<GhostBlock[]>()
const errorLine = Decoration.line({ class: 'cm-error-line' })

function linesIn(state: EditorState, range: Range): number[] {
  const from = Math.max(0, Math.min(range.from, state.doc.length))
  const to = Math.max(from, Math.min(range.to, state.doc.length))
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  const lines: number[] = []
  for (let n = first; n <= last; n++) lines.push(n)
  return lines
}

function highlightDecorations(state: EditorState, spec: HighlightSpec): DecorationSet {
  const entries: { from: number; deco: Decoration }[] = []
  for (const { range, color } of spec.full) {
    for (const n of linesIn(state, range)) entries.push({ from: state.doc.line(n).from, deco: Decoration.line({ class: 'cm-object-line', attributes: { style: `--hl: ${color}` } }) })
  }
  for (const { range, color } of spec.bars) {
    for (const n of linesIn(state, range)) entries.push({ from: state.doc.line(n).from, deco: Decoration.line({ class: 'cm-bar-line', attributes: { style: `--bar: ${color}` } }) })
  }
  entries.sort((a, b) => a.from - b.from)
  const builder = new RangeSetBuilder<Decoration>()
  for (const entry of entries) builder.add(entry.from, entry.from, entry.deco)
  return builder.finish()
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setHighlights)) next = highlightDecorations(tr.state, effect.value)
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue
      if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) next = Decoration.none
      else {
        const line = tr.state.doc.line(effect.value)
        const builder = new RangeSetBuilder<Decoration>()
        builder.add(line.from, line.from, errorLine)
        next = builder.finish()
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** A red mark in the gutter on the error line. */
const errorGutterMarker = new (class extends GutterMarker {
  elementClass = 'cm-error-gutter'
})()

const errorGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    let next = markers.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue
      if (effect.value === null || effect.value < 1 || effect.value > tr.state.doc.lines) next = RangeSet.empty
      else next = RangeSet.of(errorGutterMarker.range(tr.state.doc.line(effect.value).from))
    }
    return next
  },
  provide: (field) => gutterLineClass.from(field),
})

let onGhostClick: ((name: string, key: string) => void) | null = null

/** The unset attributes of an object, dimmed. Clicking one writes it into the file. */
class GhostWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly indent: string,
    readonly missing: { key: string; value: string }[],
  ) {
    super()
  }

  eq(other: GhostWidget): boolean {
    return other.name === this.name && other.indent === this.indent && JSON.stringify(other.missing) === JSON.stringify(this.missing)
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-ghost-lines'
    for (const { key, value } of this.missing) {
      const line = document.createElement('div')
      line.className = 'cm-ghost-line'
      line.textContent = `${this.indent}${key}: ${value},`
      line.title = 'Default. Click to set it.'
      line.addEventListener('mousedown', (e) => e.preventDefault())
      line.addEventListener('click', (e) => {
        e.preventDefault()
        onGhostClick?.(this.name, key)
      })
      wrap.appendChild(line)
    }
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

const ghostField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setGhosts)) continue
      const entries = effect.value
        .filter((g) => g.missing.length > 0 && g.closePos >= 0 && g.closePos <= tr.state.doc.length)
        .map((g) => ({ pos: tr.state.doc.lineAt(g.closePos).from, g }))
        .sort((a, b) => a.pos - b.pos)
      const builder = new RangeSetBuilder<Decoration>()
      for (const { pos, g } of entries) builder.add(pos, pos, Decoration.widget({ widget: new GhostWidget(g.name, g.indent, g.missing), block: true, side: -1 }))
      next = builder.finish()
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

let view: EditorView | null = null
let suppress = false
let onChange: ((doc: string) => void) | null = null

function extensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    history(),
    indentUnit.of('  '),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    autocompletion({ override: [sceneCompletions], icons: false }),
    colorSwatches,
    EditorView.lineWrapping,
    javascript(),
    syntaxHighlighting(editorHighlight),
    editorTheme,
    highlightField,
    errorField,
    errorGutterField,
    ghostField,
    keymap.of([
      // Tab accepts a completion when one is open, otherwise indents the line to where it belongs.
      { key: 'Tab', run: acceptCompletion },
      { key: 'Tab', run: indentSelection },
      { key: 'Shift-Tab', run: indentLess },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppress) onChange?.(update.state.doc.toString())
    }),
  ]
}

/** Create the editor once. Later calls only update the change callback. */
export function createEditor(handleChange: (doc: string) => void): EditorView {
  onChange = handleChange
  if (!view) view = new EditorView({ state: EditorState.create({ doc: '', extensions: extensions() }) })
  return view
}

export function getEditor(): EditorView | null {
  return view
}

/** Replace the whole text without recording an undo step, for a freshly loaded file. */
export function resetEditorDoc(text: string): void {
  if (!view) return
  suppress = true
  try {
    view.setState(EditorState.create({ doc: text, extensions: extensions() }))
  } finally {
    suppress = false
  }
}

/**
 * Make the text match an outside edit, changing only the span that differs so the cursor and
 * the scroll position stay where they are. Recorded in history so it can be undone.
 */
export function setEditorDoc(text: string): void {
  if (!view) return
  const current = view.state.doc.toString()
  if (current === text) return
  const max = Math.min(current.length, text.length)
  let prefix = 0
  while (prefix < max && current.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (suffix < max - prefix && current.charCodeAt(current.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++
  suppress = true
  try {
    view.dispatch({ changes: { from: prefix, to: current.length - suffix, insert: text.slice(prefix, text.length - suffix) } })
  } finally {
    suppress = false
  }
}

/** Apply GUI edits as one editor transaction, so the change callback and the history see them. */
export function applyEdits(edits: TextEdit[]): void {
  if (!view || edits.length === 0) return
  view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })) })
}

export function highlightRanges(spec: HighlightSpec): void {
  view?.dispatch({ effects: setHighlights.of(spec) })
}

export function markErrorLine(line: number | null): void {
  view?.dispatch({ effects: setErrorLine.of(line) })
}

export function setGhostLines(blocks: GhostBlock[]): void {
  view?.dispatch({ effects: setGhosts.of(blocks) })
}

export function setGhostClickHandler(handler: ((name: string, key: string) => void) | null): void {
  onGhostClick = handler
}

export function scrollToPos(pos: number): void {
  if (!view) return
  const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
  view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'start', yMargin: 24 }) })
}

/** Put the cursor somewhere, optionally selecting a span, scroll to it, and focus the editor. */
export function placeCursor(from: number, to = from): void {
  if (!view) return
  const length = view.state.doc.length
  const anchor = Math.max(0, Math.min(from, length))
  const head = Math.max(0, Math.min(to, length))
  view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
  view.focus()
}

export function editorUndo(): void {
  if (view) undo(view)
}

export function editorRedo(): void {
  if (view) redo(view)
}
