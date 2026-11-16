import { PIVOT_PARAMS } from './registry'
import type { Action } from './types'

/** What an animation is called in a list: its verb, or for a `to` the attributes it changes; with a note when it adds to what is there. */
export function actionLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).filter((k) => !(PIVOT_PARAMS as readonly string[]).includes(k)).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}
