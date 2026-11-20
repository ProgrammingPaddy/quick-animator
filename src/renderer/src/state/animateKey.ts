/**
 * The key held to animate (D425): held over the preview it looks ahead and makes what is done an
 * animation, and held with the wheel it changes a length. It is Shift unless the preferences name
 * Ctrl or Alt, and everything that asked for Shift asks here instead, so the one setting moves all
 * of it. It is always a key that types nothing (D431): held while the code pane has the keyboard,
 * it writes nothing there, and it is read from the event at hand, as Shift always was, so nothing
 * has to remember what the keyboard last said.
 */
import { animateBinding, heldKeyOf, NO_OVERRIDES } from './hotkeys'
import { useStore } from './store'

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

/** The key held to animate, as the preferences name it: `Shift`, `Ctrl`, or `Alt`. */
export function animateKey(): string {
  return animateBinding(useStore.getState().prefs.hotkeys ?? NO_OVERRIDES)
}

/** Whether the key held to animate is down as a pointer, wheel, or key event arrives. */
export function animateHeld(e: Modifiers): boolean {
  const key = animateKey()
  if (key === 'Ctrl') return e.ctrlKey || e.metaKey
  if (key === 'Alt') return e.altKey
  return e.shiftKey
}

/** Whether a keyboard event is the key held to animate, going down or coming up. */
export function isAnimateKey(e: { key: string }): boolean {
  const key = animateKey()
  if (key === 'Ctrl') return e.key === 'Control' || e.key === 'Meta'
  return heldKeyOf(e) === key
}

/** The name of the key held to animate, for a hint or a tooltip, following the preferences. */
export function useAnimateKey(): string {
  return useStore((s) => animateBinding(s.prefs.hotkeys ?? NO_OVERRIDES))
}
