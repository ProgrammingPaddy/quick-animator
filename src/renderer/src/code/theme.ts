import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
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
    '.cm-selectionMatch': { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(245, 158, 11, 0.35)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(245, 158, 11, 0.7)' },
    '.cm-snippetField': { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
    '.cm-panels': { backgroundColor: 'var(--bg-header)', color: 'var(--fg)', borderBottom: '1px solid var(--border)' },
    '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--font-ui)', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      background: 'var(--bg-raised)',
      color: 'var(--fg)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      font: 'inherit',
      padding: '2px 6px',
      margin: '0 2px',
    },
    '.cm-panel.cm-search label': { color: 'var(--fg-dim)', marginLeft: '6px' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: '6px', fontFamily: 'var(--font-ui)', fontSize: '12px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12px', maxHeight: '240px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px', lineHeight: '1.5' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#ffffff' },
    '.cm-completionDetail': { color: 'var(--fg-dim)', fontStyle: 'normal', marginLeft: '10px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': { color: 'rgba(255,255,255,0.75)' },
    '.cm-completionInfo': { padding: '6px 10px', maxWidth: '320px', fontFamily: 'var(--font-ui)' },
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
