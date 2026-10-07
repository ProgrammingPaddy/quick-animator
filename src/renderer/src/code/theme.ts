import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Editor chrome, matched to the app palette in styles.css. */
export const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg-pane)', color: 'var(--fg)', height: '100%', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--fg)', padding: '8px 0' },
    '.cm-gutters': { backgroundColor: 'var(--bg-pane)', color: 'var(--fg-faint)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(59, 130, 246, 0.3)' },
    '.cm-cursor': { borderLeftColor: 'var(--fg)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(59, 130, 246, 0.25)', outline: 'none' },
    '.cm-foldGutter .cm-gutterElement': { color: 'var(--fg-faint)' },
  },
  { dark: true },
)

/** Syntax colors. */
export const editorHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c586c0' },
  { tag: [t.string, t.special(t.string)], color: '#ce9178' },
  { tag: t.number, color: '#b5cea8' },
  { tag: t.bool, color: '#569cd6' },
  { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
  { tag: t.propertyName, color: '#9cdcfe' },
  { tag: t.variableName, color: '#d4d4d4' },
  { tag: t.typeName, color: '#4ec9b0' },
  { tag: t.operator, color: '#d4d4d4' },
  { tag: t.punctuation, color: '#a0a0a0' },
])
