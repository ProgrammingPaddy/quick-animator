/**
 * The hotkeys (D260): every key the app answers to, in one place, each with a name, the pane it
 * belongs to, and its default keys. The preferences rebind any that is not the editor's or the
 * pointer's own, and warn when a key is already taken in the same pane or everywhere. A key is
 * named by the physical key, as the keyboard event's code has it, with the modifiers in a fixed
 * order: `Ctrl+Shift+Z`, `Ctrl+ArrowLeft`, `Delete`. What the pointer does is written the same
 * way, its last word the gesture: `Alt+LeftDrag`, `Ctrl+Click`, `Wheel`. One hotkey is held and
 * not pressed: the key that animates (D425), Shift unless the preferences name another, and always
 * a key that types nothing, Shift, Ctrl, or Alt (D431). Where a text names that key it writes
 * `[animate]`, which `sayKey` puts the key's name in for.
 */

export type HotkeyScope = 'global' | 'preview' | 'timeline' | 'code'

export interface Hotkey {
  id: string
  /** What it does, in a word or three: never the key it is on. */
  label: string
  /** What it does, for the preferences and the help. */
  what: string
  scope: HotkeyScope
  defaults: readonly string[]
  /** Shift held with the key extends what it does rather than naming another key, so the binding matches with Shift too. */
  shiftExtends?: boolean
  /** A key the editor or the pointer owns, listed for the record and not rebindable. */
  fixed?: boolean
  /** A key held while the pointer or the wheel acts, not one pressed: Shift, Ctrl, or Alt alone (D425, D431). */
  held?: boolean
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
  { id: 'left', label: 'Frame back, or nudge left', what: 'Nothing selected: the playhead back a frame, ten with Shift. Objects selected: in the preview, a pixel left; elsewhere, earlier in time. Animations selected: a frame earlier.', scope: 'global', defaults: ['ArrowLeft'], shiftExtends: true },
  { id: 'right', label: 'Frame forward, or nudge right', what: 'Nothing selected: the playhead forward a frame, ten with Shift. Objects selected: in the preview, a pixel right; elsewhere, later in time. Animations selected: a frame later.', scope: 'global', defaults: ['ArrowRight'], shiftExtends: true },
  { id: 'up', label: 'Nudge up', what: 'Objects selected in the preview: a pixel up, ten with Shift.', scope: 'global', defaults: ['ArrowUp'], shiftExtends: true },
  { id: 'down', label: 'Nudge down', what: 'Objects selected in the preview: a pixel down, ten with Shift.', scope: 'global', defaults: ['ArrowDown'], shiftExtends: true },
  { id: 'delete', label: 'Delete', what: 'The selected animations, else the selected objects; with points picked, those points.', scope: 'global', defaults: ['Delete', 'Backspace'] },
  { id: 'escape', label: 'Put away, or deselect', what: 'Put a tool away; else deselect the animations; else deselect everything. Also closes menus, dialogs, and the help.', scope: 'global', defaults: ['Escape'] },
  { id: 'rename', label: 'Rename', what: 'Rename the selected animation or object.', scope: 'global', defaults: ['F2'] },
  { id: 'copy', label: 'Copy', what: 'Copy the selected animation or object.', scope: 'global', defaults: ['Ctrl+C'] },
  { id: 'cut', label: 'Cut', what: 'Cut the selected animation or object.', scope: 'global', defaults: ['Ctrl+X'] },
  { id: 'paste', label: 'Paste', what: 'Paste an animation onto the selected object, or an object as a numbered copy.', scope: 'global', defaults: ['Ctrl+V'] },
  { id: 'duplicate', label: 'Duplicate', what: 'Duplicate the selected objects with their animations.', scope: 'global', defaults: ['Ctrl+D'] },
  { id: 'selectAll', label: 'Select all', what: 'Select every object.', scope: 'global', defaults: ['Ctrl+A'] },
  { id: 'preferences', label: 'Preferences', what: 'Open the preferences.', scope: 'global', defaults: ['Ctrl+Comma'] },
  { id: 'export', label: 'Export', what: 'Export the project as a video or an image sequence.', scope: 'global', defaults: ['Ctrl+E'] },
  { id: 'help', label: 'Help', what: 'Open or close the help.', scope: 'global', defaults: ['F1'] },
  { id: 'marker', label: 'Marker', what: 'A marker at the playhead.', scope: 'global', defaults: ['M'] },
  { id: 'markerNamed', label: 'Named marker', what: 'A marker at the playhead, its text typed at once. No key until one is given here.', scope: 'global', defaults: [] },
  { id: 'previewView', label: 'Next preview view', what: 'What the preview shows, in turn: Preview, Camera, Side by side.', scope: 'global', defaults: ['C'] },
  { id: 'record', label: 'Record', what: 'Start or stop recording: while the playhead runs, what is done is written as it was done.', scope: 'global', defaults: ['T'] },
  { id: 'animate', label: 'Hold to animate', what: 'Held over the preview, the playhead looks ahead and a drag, a click of Paint, a stroke of the pencil, or a move of the camera is an animation from the playhead; with an animation selected, shows and sets the end the pin does not name; with a shape point, a morph. Held with the wheel, there or over the timeline, changes the selected animations\' length. Shift, Ctrl, or Alt.', scope: 'global', defaults: ['Shift'], held: true },
  { id: 'razor', label: 'Razor', what: "The timeline's razor, or back to the pointer: with the razor, a click on an animation slices it there.", scope: 'global', defaults: ['R'] },
  { id: 'closeShape', label: 'Close shape', what: 'Close the shape being drawn, which fills it; Escape leaves it a line.', scope: 'preview', defaults: ['Enter'] },
  { id: 'extendSelection', label: 'Add to the selection', what: 'A click adds a thing to the selection or takes it out, points included; a box adds what it touches.', scope: 'preview', defaults: ['Ctrl+Click'], fixed: true },
  { id: 'proportions', label: 'Keep proportions', what: 'Held as a corner or an edge is pressed, the resize keeps its proportions. Held while a curve\'s handle is dragged, that handle moves alone.', scope: 'preview', defaults: ['Alt+HandleDrag'], fixed: true },
  { id: 'takeColor', label: 'Take a color', what: 'With Paint: the color of what is clicked becomes the color painted with.', scope: 'preview', defaults: ['Alt+Click'], fixed: true },
  { id: 'previewWheel', label: 'Zoom', what: 'In the Preview view, zooms at the cursor, and a sideways wheel slides the view. In the Camera view, zooms the camera\'s lens, the camera staying where it is.', scope: 'preview', defaults: ['Wheel'], fixed: true },
  { id: 'across', label: 'Move across', what: 'In the Preview view, slides the view. In the Camera view, moves the camera across and up: what is pressed stays under the pointer.', scope: 'preview', defaults: ['MiddleDrag', 'Alt+MiddleDrag'], fixed: true },
  { id: 'round', label: 'Go round', what: 'In the Preview view, turns the view about what is at its middle. In the Camera view, the camera goes round what is at the middle of its picture.', scope: 'preview', defaults: ['Alt+LeftDrag', 'Ctrl+MiddleDrag'], fixed: true },
  { id: 'closer', label: 'Move closer', what: 'In the Preview view, zooms the view. In the Camera view, moves the camera closer or farther along its line of sight, which the wheel does there with Alt too.', scope: 'preview', defaults: ['Alt+RightDrag', 'Alt+Wheel'], fixed: true },
  { id: 'timelineWheel', label: 'Scroll time', what: 'Scrolls the timeline along time.', scope: 'timeline', defaults: ['Wheel'], fixed: true },
  { id: 'timelineZoom', label: 'Zoom time', what: 'Zooms the timeline at the cursor.', scope: 'timeline', defaults: ['Ctrl+Wheel'], fixed: true },
  { id: 'timelineRows', label: 'Scroll rows', what: 'Scrolls the timeline\'s rows up and down.', scope: 'timeline', defaults: ['Alt+Wheel'], fixed: true },
  { id: 'completions', label: 'Completions', what: 'Open the completions; Tab accepts one, or indents.', scope: 'code', defaults: ['Ctrl+Space'], fixed: true },
  { id: 'search', label: 'Search', what: 'Search the code.', scope: 'code', defaults: ['Ctrl+F'], fixed: true },
  { id: 'moveLine', label: 'Move line', what: 'Up or down; with Shift, copies it.', scope: 'code', defaults: ['Alt+ArrowUp', 'Alt+ArrowDown'], fixed: true },
  { id: 'comment', label: 'Comment line', what: 'Comment the line, or uncomment it.', scope: 'code', defaults: ['Ctrl+Slash'], fixed: true },
  { id: 'deleteLine', label: 'Delete line', what: 'Delete the line.', scope: 'code', defaults: ['Ctrl+Shift+K'], fixed: true },
  { id: 'nextMatch', label: 'Next match', what: 'Select the next match of the selection.', scope: 'code', defaults: ['Ctrl+D'], fixed: true },
  { id: 'dragNumber', label: 'Change a number', what: 'Drag a number sideways: one per 4 px, ten with Shift, a tenth with Ctrl; one undo step.', scope: 'code', defaults: ['Alt+Drag'], fixed: true },
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

/** The keys that can be held to animate (D431): the three that type nothing, wherever the keyboard's focus is. */
export const HELD_KEYS: readonly string[] = ['Shift', 'Ctrl', 'Alt']

/** What the pointer does, as the last word of a binding. */
const GESTURES: ReadonlySet<string> = new Set(['Click', 'Drag', 'HandleDrag', 'LeftDrag', 'MiddleDrag', 'RightDrag', 'Wheel'])

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

/** The key a keyboard event holds down, for the hotkey that is held (D425, D431): Shift, Ctrl, or Alt by its own name; null for any other, which could not be held without typing where the keyboard's focus is. */
export function heldKeyOf(e: { key: string }): string | null {
  if (e.key === 'Shift') return 'Shift'
  if (e.key === 'Control') return 'Ctrl'
  if (e.key === 'Alt') return 'Alt'
  return null
}

/** The hotkey a keyboard event means in a pane, if any: the pane's own first, then those everywhere. A key that is held is none of them. */
export function matchHotkey(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, scope: HotkeyScope | null, overrides: HotkeyOverrides): Hotkey | null {
  const key = keyOf(e)
  if (!key) return null
  const unshifted = key.startsWith('Shift+') ? key.slice(6) : key.replace('+Shift+', '+')
  for (const hotkey of hotkeysFor(scope)) {
    if (hotkey.fixed || hotkey.held) continue
    const bindings = bindingsOf(hotkey, overrides)
    if (bindings.includes(key) || (hotkey.shiftExtends && bindings.includes(unshifted))) return hotkey
  }
  return null
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Escape: 'Esc',
  Click: 'click',
  Drag: 'drag',
  HandleDrag: 'drag a handle',
  LeftDrag: 'left drag',
  MiddleDrag: 'middle drag',
  RightDrag: 'right drag',
  Wheel: 'wheel',
}

/** A key's name as the preferences and the help show it, `Ctrl + Shift + Z`, `Ctrl + Left`, `Alt + left drag`; compact for a tooltip, `Ctrl+Shift+Z`. A gesture alone begins with a capital: `Wheel`. */
export function keyLabel(binding: string, compact = false): string {
  const parts = binding.split('+').map((part) => KEY_NAMES[part] ?? part)
  const first = parts[0] ?? ''
  if (parts.length === 1 && first.length > 1 && GESTURES.has(binding)) parts[0] = first[0]!.toUpperCase() + first.slice(1)
  return parts.join(compact ? '+' : ' + ')
}

/** The names of a hotkey's keys, joined, for a tooltip or the help. */
export function keysLabel(id: string, overrides: HotkeyOverrides, compact = false): string {
  const hotkey = HOTKEYS.find((h) => h.id === id)
  return hotkey ? bindingsOf(hotkey, overrides).map((b) => keyLabel(b, compact)).join(', ') : ''
}

/** A text that names the key held to animate as `[animate]`, with the key's name in its place (D425). */
export function sayKey(text: string, key: string): string {
  return text.includes('[animate]') ? text.replaceAll('[animate]', key) : text
}

/** The key held to animate, as the preferences have it: Shift unless Ctrl or Alt is named (D425, D431). Anything else kept from before counts as Shift. */
export function animateBinding(overrides: HotkeyOverrides): string {
  const key = overrides['animate']?.[0]
  return key !== undefined && HELD_KEYS.includes(key) ? key : 'Shift'
}

/**
 * The other hotkeys a key would also answer to from a pane: those of the same pane, and those
 * everywhere, since a pane's key shadows them there (D260). For the key that is held, they are
 * what the pointer already does with that key down, in whatever pane: a click, a drag, the wheel.
 */
export function conflictsOf(hotkey: Hotkey, binding: string, overrides: HotkeyOverrides): Hotkey[] {
  if (hotkey.held) {
    return HOTKEYS.filter((other) => {
      if (other.id === hotkey.id) return false
      return bindingsOf(other, overrides).some((b) => {
        const parts = b.split('+')
        return parts.length > 1 && parts.slice(0, -1).includes(binding) && GESTURES.has(parts[parts.length - 1]!)
      })
    })
  }
  return HOTKEYS.filter((other) => other.id !== hotkey.id && (other.scope === hotkey.scope || other.scope === 'global' || hotkey.scope === 'global') && bindingsOf(other, overrides).includes(binding))
}
