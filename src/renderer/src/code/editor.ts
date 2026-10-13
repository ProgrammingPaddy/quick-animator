import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, indentLess, indentSelection, invertedEffects, redo, undo } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, drawSelection, gutterLineClass, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import type { TextEdit } from '../model/edits'
import type { Range } from '../model/types'
import type { SelectionState } from '../state/store'
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

/** Unset attributes of one object, or unset timing of one action, shown as ghost lines before the closing brace (D35, D114). */
export interface GhostBlock {
  name: string
  /** The action's index on the object, for an action block. */
  index?: number
  /** Position of the closing brace of the attribute block. */
  closePos: number
  indent: string
  missing: { key: string; value: string }[]
}

const setHighlights = StateEffect.define<HighlightSpec>()
/**
 * A change of what is selected in the panes, carried by a transaction so the history can undo
 * and redo it with the edits around it (D90). Undoing applies the inverse.
 */
const selectionEffect = StateEffect.define<{ before: SelectionState; after: SelectionState }>()
const selectionHistory = invertedEffects.of((tr) => {
  const inverted: StateEffect<unknown>[] = []
  for (const effect of tr.effects) if (effect.is(selectionEffect)) inverted.push(selectionEffect.of({ before: effect.value.after, after: effect.value.before }))
  return inverted
})
/** The lines with problems: the error's, in red, and the warnings', in amber (D149). */
const setProblemLines = StateEffect.define<{ errors: number[]; warnings: number[] }>()
const setGhosts = StateEffect.define<GhostBlock[]>()
const errorLine = Decoration.line({ class: 'cm-error-line' })
const warningLine = Decoration.line({ class: 'cm-warning-line' })

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

/** Each problem line once, errors first, within the document. */
function problemLines(state: EditorState, value: { errors: number[]; warnings: number[] }): { line: number; kind: 'error' | 'warning' }[] {
  const seen = new Set<number>()
  const out: { line: number; kind: 'error' | 'warning' }[] = []
  for (const kind of ['error', 'warning'] as const) {
    for (const line of kind === 'error' ? value.errors : value.warnings) {
      if (line < 1 || line > state.doc.lines || seen.has(line)) continue
      seen.add(line)
      out.push({ line, kind })
    }
  }
  return out.sort((a, b) => a.line - b.line)
}

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setProblemLines)) continue
      const builder = new RangeSetBuilder<Decoration>()
      for (const { line, kind } of problemLines(tr.state, effect.value)) {
        const from = tr.state.doc.line(line).from
        builder.add(from, from, kind === 'error' ? errorLine : warningLine)
      }
      next = builder.finish()
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** A red mark in the gutter on the error line, an amber one on a warning's. */
const errorGutterMarker = new (class extends GutterMarker {
  elementClass = 'cm-error-gutter'
})()
const warningGutterMarker = new (class extends GutterMarker {
  elementClass = 'cm-warning-gutter'
})()

const errorGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    let next = markers.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setProblemLines)) continue
      next = RangeSet.of(
        problemLines(tr.state, effect.value).map(({ line, kind }) => (kind === 'error' ? errorGutterMarker : warningGutterMarker).range(tr.state.doc.line(line).from)),
        true,
      )
    }
    return next
  },
  provide: (field) => gutterLineClass.from(field),
})

let onGhostClick: ((name: string, key: string, index?: number) => void) | null = null

/** The unset attributes of an object, dimmed. Clicking one writes it into the file. */
class GhostWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly indent: string,
    readonly missing: { key: string; value: string }[],
    readonly index?: number,
  ) {
    super()
  }

  eq(other: GhostWidget): boolean {
    return other.name === this.name && other.index === this.index && other.indent === this.indent && JSON.stringify(other.missing) === JSON.stringify(this.missing)
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
        onGhostClick?.(this.name, key, this.index)
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
      for (const { pos, g } of entries) builder.add(pos, pos, Decoration.widget({ widget: new GhostWidget(g.name, g.indent, g.missing, g.index), block: true, side: -1 }))
      next = builder.finish()
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

let view: EditorView | null = null
let suppress = false
let onChange: ((doc: string) => void) | null = null
let onSelection: ((state: SelectionState) => void) | null = null
let getSelection: (() => SelectionState) | null = null

/** Undo text edits; selection-only steps along the way are undone too but do not count. */
function undoText(v: EditorView): boolean {
  for (let i = 0; i < 100; i++) {
    const doc = v.state.doc
    if (!undo(v)) return i > 0
    if (v.state.doc !== doc) return true
  }
  return true
}

function redoText(v: EditorView): boolean {
  for (let i = 0; i < 100; i++) {
    const doc = v.state.doc
    if (!redo(v)) return i > 0
    if (v.state.doc !== doc) return true
  }
  return true
}

function extensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    history({
      // Every edit of one gesture joins one undo step, whatever it touches, so a drag that pushes other things undoes as one (D22, D136).
      joinToEvent: (tr, adjacent) => adjacent || (tr.annotation(gestureAnnotation) !== undefined && tr.annotation(gestureAnnotation) === lastGesture),
    }),
    selectionHistory,
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
      // Inside the editor, undo skips over selection-only steps so Ctrl+Z always changes text.
      { key: 'Mod-z', run: undoText, preventDefault: true },
      { key: 'Mod-y', mac: 'Mod-Shift-z', run: redoText, preventDefault: true },
      { key: 'Mod-Shift-z', run: redoText, preventDefault: true },
      ...foldKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppress) onChange?.(update.state.doc.toString())
      for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(selectionEffect)) onSelection?.(effect.value.after)
    }),
  ]
}

/** Create the editor once. Later calls only update the callbacks. */
export function createEditor(handleChange: (doc: string) => void, selection?: { onSelection: (state: SelectionState) => void; getSelection: () => SelectionState }): EditorView {
  onChange = handleChange
  if (selection) {
    onSelection = selection.onSelection
    getSelection = selection.getSelection
  }
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

/** Which gesture a transaction belongs to, so the history joins a gesture's edits (D22). */
const gestureAnnotation = Annotation.define<number>()
let gestureCount = 0
let openGesture: number | null = null
let lastGesture: number | null = null
let gestureTime = 0

/** Start a gesture: every edit until `endGesture` joins one undo step, whatever it touches. */
export function beginGesture(): void {
  openGesture = ++gestureCount
  gestureTime = Date.now()
}

export function endGesture(): void {
  openGesture = null
}

/**
 * Apply GUI edits as one editor transaction, so the change callback and the history see them.
 * With `select`, the selection changes in the same step, so undo restores both together.
 */
export function applyEdits(edits: TextEdit[], select?: SelectionState): void {
  if (!view || edits.length === 0) return
  const effects = select && getSelection ? [selectionEffect.of({ before: getSelection(), after: select })] : []
  // A gesture's edits carry its number and one time, so the history's pause between groups never splits a long drag.
  const annotations = openGesture !== null ? [gestureAnnotation.of(openGesture), Transaction.time.of(gestureTime)] : []
  view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })), effects, annotations })
  lastGesture = openGesture
}

/** Record a selection change from the panes as a step of the history (D90). */
export function recordSelection(before: SelectionState, after: SelectionState): void {
  if (!view) return
  view.dispatch({ effects: selectionEffect.of({ before, after }) })
}

export function highlightRanges(spec: HighlightSpec): void {
  view?.dispatch({ effects: setHighlights.of(spec) })
}

/** Mark the error's line and the warnings' lines (D149). */
export function markProblemLines(errors: number[], warnings: number[]): void {
  view?.dispatch({ effects: setProblemLines.of({ errors, warnings }) })
}

export function setGhostLines(blocks: GhostBlock[]): void {
  view?.dispatch({ effects: setGhosts.of(blocks) })
}

export function setGhostClickHandler(handler: ((name: string, key: string, index?: number) => void) | null): void {
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
  // Placing the cursor is not an edit, and must not split the undo step of a gesture that selected something.
  view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }), annotations: Transaction.addToHistory.of(false) })
  view.focus()
}

export function editorUndo(): void {
  if (view) undo(view)
}

export function editorRedo(): void {
  if (view) redo(view)
}
