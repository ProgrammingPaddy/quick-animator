import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { editorHighlight, editorTheme } from './theme'
import type { TextEdit } from '../model/edits'
import type { Range } from '../model/types'

/**
 * One editor for the whole app. It outlives the code pane, so collapsing the pane keeps the
 * undo history, and GUI edits always have somewhere to go (decision D22).
 */

const setHighlights = StateEffect.define<Range[]>()
const setErrorLine = StateEffect.define<number | null>()
const objectLine = Decoration.line({ class: 'cm-object-line' })
const errorLine = Decoration.line({ class: 'cm-error-line' })

function lineDecorations(state: EditorState, ranges: Range[], decoration: Decoration): DecorationSet {
  const lines = new Set<number>()
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, state.doc.length))
    const to = Math.max(from, Math.min(range.to, state.doc.length))
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  const builder = new RangeSetBuilder<Decoration>()
  for (const n of [...lines].sort((a, b) => a - b)) {
    const line = state.doc.line(n)
    builder.add(line.from, line.from, decoration)
  }
  return builder.finish()
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) if (effect.is(setHighlights)) next = lineDecorations(tr.state, effect.value, objectLine)
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
        next = lineDecorations(tr.state, [{ from: line.from, to: line.from }], errorLine)
      }
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
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    javascript(),
    syntaxHighlighting(editorHighlight),
    editorTheme,
    highlightField,
    errorField,
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
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

/** Replace the text to match an outside edit. Recorded in history so it can be undone. */
export function setEditorDoc(text: string): void {
  if (!view) return
  const current = view.state.doc.toString()
  if (current === text) return
  suppress = true
  try {
    view.dispatch({ changes: { from: 0, to: current.length, insert: text } })
  } finally {
    suppress = false
  }
}

/** Apply GUI edits as one editor transaction, so the change callback and the history see them. */
export function applyEdits(edits: TextEdit[]): void {
  if (!view || edits.length === 0) return
  view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })) })
}

export function highlightRanges(ranges: Range[]): void {
  view?.dispatch({ effects: setHighlights.of(ranges) })
}

export function markErrorLine(line: number | null): void {
  view?.dispatch({ effects: setErrorLine.of(line) })
}

export function scrollToPos(pos: number): void {
  if (!view) return
  const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
  view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'start', yMargin: 24 }) })
}

export function editorUndo(): void {
  if (view) undo(view)
}

export function editorRedo(): void {
  if (view) redo(view)
}
