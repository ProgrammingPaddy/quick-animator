/**
 * The hotkeys (D260): every key the app answers to, in one place, each with a name, the pane it
 * belongs to, and its default keys. The preferences rebind any that is not the editor's or the
 * pointer's own, and warn when a key is already taken in the same pane or everywhere. A key is
 * named by the physical key, as the keyboard event's code has it, with the modifiers in a fixed
 * order: `Ctrl+Shift+Z`, `Ctrl+ArrowLeft`, `Delete`.
 */

export type HotkeyScope = 'global' | 'preview' | 'timeline' | 'code'

export interface Hotkey {
  id: string
  label: string
  /** What it does, for the preferences and the help. */
  what: string
  scope: HotkeyScope
  defaults: readonly string[]
  /** Shift held with the key extends what it does rather than naming another key, so the binding matches with Shift too. */
  shiftExtends?: boolean
  /** A key the editor or the pointer owns, listed for the record and not rebindable. */
  fixed?: boolean
}

export const SCOPES: readonly HotkeyScope[] = ['global', 'preview', 'timeline', 'code']
export const SCOPE_LABEL: Record<HotkeyScope, string> = { global: 'Everywhere', preview: 'Preview', timeline: 'Timeline', code: 'Code' }

export const HOTKEYS: readonly Hotkey[] = [
  { id: 'undo', label: 'Undo', what: 'Undo, the selection included.', scope: 'global', defaults: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', what: 'Redo.', scope: 'global', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'play', label: 'Play or pause', what: 'Play or pause; pausing returns to where playback started.', scope: 'global', defaults: ['Space'] },
  { id: 'start', label: 'To the start', what: 'The playhead to the start.', scope: 'global', defaults: ['Home'] },
  { id: 'end', label: 'To the end', what: 'The playhead to the end of the content.', scope: 'global', defaults: ['End'] },
  { id: 'previousEdge', label: 'Previous edge', what: 'The playhead to the edge before it, whatever is selected: where an animation starts or ends, or an object begins or is removed.', scope: 'global', defaults: ['Ctrl+ArrowLeft'] },
  { id: 'nextEdge', label: 'Next edge', what: 'The playhead to the edge after it.', scope: 'global', defaults: ['Ctrl+ArrowRight'] },
  { id: 'left', label: 'Left', what: 'Nothing selected: the playhead back a frame, ten with Shift. Objects selected: in the preview, a pixel left; elsewhere, earlier in time. Animations selected: a frame earlier.', scope: 'global', defaults: ['ArrowLeft'], shiftExtends: true },
  { id: 'right', label: 'Right', what: 'As Left, the other way.', scope: 'global', defaults: ['ArrowRight'], shiftExtends: true },
  { id: 'up', label: 'Up', what: 'Objects selected in the preview: a pixel up, ten with Shift.', scope: 'global', defaults: ['ArrowUp'], shiftExtends: true },
  { id: 'down', label: 'Down', what: 'Objects selected in the preview: a pixel down, ten with Shift.', scope: 'global', defaults: ['ArrowDown'], shiftExtends: true },
  { id: 'delete', label: 'Delete', what: 'The selected animations, else the selected objects; with points picked, those points.', scope: 'global', defaults: ['Delete', 'Backspace'] },
  { id: 'escape', label: 'Escape', what: 'Put a tool away; else deselect the animations; else deselect everything. Also closes menus, dialogs, and the help.', scope: 'global', defaults: ['Escape'] },
  { id: 'rename', label: 'Rename', what: 'Rename the selected animation or object.', scope: 'global', defaults: ['F2'] },
  { id: 'copy', label: 'Copy', what: 'Copy the selected animation or object.', scope: 'global', defaults: ['Ctrl+C'] },
  { id: 'cut', label: 'Cut', what: 'Cut the selected animation or object.', scope: 'global', defaults: ['Ctrl+X'] },
  { id: 'paste', label: 'Paste', what: 'Paste an animation onto the selected object, or an object as a numbered copy.', scope: 'global', defaults: ['Ctrl+V'] },
  { id: 'duplicate', label: 'Duplicate', what: 'Duplicate the selected objects with their animations.', scope: 'global', defaults: ['Ctrl+D'] },
  { id: 'selectAll', label: 'Select all', what: 'Select every object.', scope: 'global', defaults: ['Ctrl+A'] },
  { id: 'preferences', label: 'Preferences', what: 'Open the preferences.', scope: 'global', defaults: ['Ctrl+Comma'] },
  { id: 'export', label: 'Export', what: 'Export the project as a video or an image sequence.', scope: 'global', defaults: ['Ctrl+E'] },
  { id: 'help', label: 'Help', what: 'Open or close the help.', scope: 'global', defaults: ['F1'] },
  { id: 'razor', label: 'Razor', what: "The timeline's razor, or back to the pointer: with the razor, a click on an animation slices it there.", scope: 'global', defaults: ['R'] },
  { id: 'closeShape', label: 'Close the shape', what: 'Close the shape being drawn, which fills it; Escape leaves it a line.', scope: 'preview', defaults: ['Enter'] },
  { id: 'animateDrag', label: 'Shift while dragging', what: 'Makes the drag an animation from the playhead; with an animation selected, previews and sets its other end; with a shape point, a morph.', scope: 'preview', defaults: ['Shift'], fixed: true },
  { id: 'proportions', label: 'Alt while dragging', what: 'Keeps the proportions of a resize; on a curve handle, moves that handle alone.', scope: 'preview', defaults: ['Alt'], fixed: true },
  { id: 'extendSelection', label: 'Ctrl with a click or a box', what: 'Adds to or removes from the selection, points included.', scope: 'preview', defaults: ['Ctrl'], fixed: true },
  { id: 'previewWheel', label: 'Wheel', what: 'Zoom at the cursor; Shift pans sideways, Alt up and down; over selected animations, Shift and the wheel change their length.', scope: 'preview', defaults: ['Wheel'], fixed: true },
  { id: 'timelineWheel', label: 'Wheel', what: 'Scroll time; Ctrl zooms at the cursor; Alt scrolls the lanes.', scope: 'timeline', defaults: ['Wheel'], fixed: true },
  { id: 'timelineShift', label: 'Shift', what: 'With an animation selected, previews the end the pin does not name; with the wheel, changes the selected animations\' length.', scope: 'timeline', defaults: ['Shift'], fixed: true },
  { id: 'completions', label: 'Completions', what: 'Open the completions; Tab accepts one, or indents.', scope: 'code', defaults: ['Ctrl+Space'], fixed: true },
  { id: 'search', label: 'Search', what: 'Search the code.', scope: 'code', defaults: ['Ctrl+F'], fixed: true },
  { id: 'moveLine', label: 'Move the line', what: 'Up or down; with Shift, copies it.', scope: 'code', defaults: ['Alt+ArrowUp', 'Alt+ArrowDown'], fixed: true },
  { id: 'comment', label: 'Comment the line', what: 'Comment the line, or uncomment it.', scope: 'code', defaults: ['Ctrl+Slash'], fixed: true },
  { id: 'deleteLine', label: 'Delete the line', what: 'Delete the line.', scope: 'code', defaults: ['Ctrl+Shift+K'], fixed: true },
  { id: 'nextMatch', label: 'Next match', what: 'Select the next match of the selection.', scope: 'code', defaults: ['Ctrl+D'], fixed: true },
  { id: 'dragNumber', label: 'Alt and drag a number', what: 'Changes it: one per 4 px, ten with Shift, a tenth with Ctrl; one undo step.', scope: 'code', defaults: ['Alt'], fixed: true },
]

/** The hotkeys a pane's keys answer to: its own, then the ones everywhere. */
export function hotkeysFor(scope: HotkeyScope | null): Hotkey[] {
  return [...HOTKEYS.filter((h) => scope !== null && h.scope === scope), ...HOTKEYS.filter((h) => h.scope === 'global')]
}

export type HotkeyOverrides = Readonly<Record<string, readonly string[]>>

/** No keys rebound: one object, so a selector that falls back to it never changes. */
export const NO_OVERRIDES: HotkeyOverrides = Object.freeze({})

/** The keys a hotkey answers to: the preferences' own, else its defaults. */
export function bindingsOf(hotkey: Hotkey, overrides: HotkeyOverrides): readonly string[] {
  return overrides[hotkey.id] ?? hotkey.defaults
}

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

/** The name of the key a keyboard event pressed, modifiers first in a fixed order, or null for a modifier alone. */
export function keyOf(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  const code = e.code
  if (!code || MODIFIER_CODES.has(code)) return null
  const key = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** The hotkey a keyboard event means in a pane, if any: the pane's own first, then those everywhere. */
export function matchHotkey(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, scope: HotkeyScope | null, overrides: HotkeyOverrides): Hotkey | null {
  const key = keyOf(e)
  if (!key) return null
  const unshifted = key.startsWith('Shift+') ? key.slice(6) : key.replace('+Shift+', '+')
  for (const hotkey of hotkeysFor(scope)) {
    if (hotkey.fixed) continue
    const bindings = bindingsOf(hotkey, overrides)
    if (bindings.includes(key) || (hotkey.shiftExtends && bindings.includes(unshifted))) return hotkey
  }
  return null
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Escape: 'Esc' }

/** A key's name as the preferences and the help show it, `Ctrl + Shift + Z`, `Ctrl + Left`; compact for a tooltip, `Ctrl+Shift+Z`. */
export function keyLabel(binding: string, compact = false): string {
  return binding
    .split('+')
    .map((part) => KEY_NAMES[part] ?? part)
    .join(compact ? '+' : ' + ')
}

/** The names of a hotkey's keys, joined, for a tooltip or the help. */
export function keysLabel(id: string, overrides: HotkeyOverrides, compact = false): string {
  const hotkey = HOTKEYS.find((h) => h.id === id)
  return hotkey ? bindingsOf(hotkey, overrides).map((b) => keyLabel(b, compact)).join(', ') : ''
}

/** The other hotkeys a key would also answer to from a pane: those of the same pane, and those everywhere, since a pane's key shadows them there (D260). */
export function conflictsOf(hotkey: Hotkey, binding: string, overrides: HotkeyOverrides): Hotkey[] {
  return HOTKEYS.filter((other) => other.id !== hotkey.id && (other.scope === hotkey.scope || other.scope === 'global' || hotkey.scope === 'global') && bindingsOf(other, overrides).includes(binding))
}
