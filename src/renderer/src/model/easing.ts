/** Maps progress in [0, 1] to eased progress in [0, 1]. */
export type Easing = (progress: number) => number

/**
 * Ease by durations (decision D39): speed ramps up over `easeIn` seconds, holds, and ramps down
 * over `easeOut` seconds. The two ramps shrink proportionally when they do not fit the duration.
 */
export function trapezoid(easeIn: number, easeOut: number, duration: number): Easing {
  if (duration <= 0) return () => 1
  let a = Math.max(0, easeIn) / duration
  let b = Math.max(0, easeOut) / duration
  const sum = a + b
  if (sum > 1) {
    a /= sum
    b /= sum
  }
  const vmax = 1 / (1 - (a + b) / 2)
  return (s) => {
    if (s <= 0) return 0
    if (s >= 1) return 1
    if (a > 0 && s < a) return (vmax * s * s) / (2 * a)
    if (b > 0 && s > 1 - b) {
      const r = 1 - s
      return 1 - (vmax * r * r) / (2 * b)
    }
    return vmax * (s - a / 2)
  }
}

const c1 = 1.70158
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3

export const namedEasings: Record<string, Easing> = {
  linear: (p) => p,
  snap: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  back: (p) => 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2),
  elastic: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1),
  bounce: (p) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (p < 1 / d1) return n1 * p * p
    if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75
    if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375
    return n1 * (p -= 2.625 / d1) * p + 0.984375
  },
}

/** Default ease at each end, as a fraction of the duration. */
export const DEFAULT_EASE_FRACTION = 0.3

export function easingFor(timing: { ease?: string; easeIn?: number; easeOut?: number }, duration: number): Easing {
  if (timing.ease && namedEasings[timing.ease]) return namedEasings[timing.ease]!
  const easeIn = timing.easeIn ?? duration * DEFAULT_EASE_FRACTION
  const easeOut = timing.easeOut ?? duration * DEFAULT_EASE_FRACTION
  return trapezoid(easeIn, easeOut, duration)
}
