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

/** The progress at which an easing has come a fraction of the way: its inverse, by bisection, since an easing only climbs. */
export function unease(ease: Easing, fraction: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ease(mid) < fraction) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** The curves the app itself made, `Ease.part` and the rest (D264): taken as they are, beyond 0 and 1 included, as the named curves they come from are. */
const trusted = new WeakSet<Easing>()

function trust(ease: Easing): Easing {
  trusted.add(ease)
  return ease
}

/** A curve written in the code, `ease: (p) => p * p`: whatever it returns, within 0 to 1; a throw holds the ends. */
function customEase(custom: (progress: number) => number): Easing {
  if (trusted.has(custom)) return custom
  return (p) => {
    // The ends go through the curve too, so one that falls back ends where it fell back to, and the action holds that (D220).
    const at = Math.max(0, Math.min(1, p))
    try {
      const v = Number(custom(at))
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : at
    } catch {
      return at
    }
  }
}

export function easingFor(timing: { ease?: string | Easing; easeIn?: number; easeOut?: number }, duration: number): Easing {
  if (typeof timing.ease === 'function') return customEase(timing.ease)
  if (timing.ease && namedEasings[timing.ease]) return namedEasings[timing.ease]!
  const easeIn = timing.easeIn ?? duration * DEFAULT_EASE_FRACTION
  const easeOut = timing.easeOut ?? duration * DEFAULT_EASE_FRACTION
  return trapezoid(easeIn, easeOut, duration)
}

/** An ease as code names one (D264): a named curve, a function of the progress as the sampler takes it, anything else linear. */
export function easeFrom(ease: unknown): Easing {
  if (typeof ease === 'function') return customEase(ease as (progress: number) => number)
  if (typeof ease === 'string' && namedEasings[ease]) return namedEasings[ease]!
  return namedEasings['linear']!
}

/** The ramps as an ease of their own (D264): what an action `duration` seconds long runs on with `easeIn` and `easeOut`. */
export function ramps(easeIn: number, easeOut: number, duration: number): Easing {
  return trust(trapezoid(easeIn, easeOut, duration))
}

/** The part of an ease between two points of its progress, stretched to an ease of its own, 0 to 1 (D264): what a sliced animation runs on, the bounces and overshoots of the whole kept. A part that covers no change is done at once. */
export function easePart(ease: Easing, from: number, to: number): Easing {
  const a = ease(from)
  const span = ease(to) - a
  if (Math.abs(span) < 1e-9) return trust(() => 1)
  return trust((p) => (ease(from + (to - from) * Math.max(0, Math.min(1, p))) - a) / span)
}

/** The share of the change an ease covers between two points of its progress, from nothing (D264): what a sliced animation keeps of a change that stays a function, so that it stops part of the way, where the cut was. */
export function easeShare(ease: Easing, from: number, to: number): Easing {
  const a = ease(from)
  return trust((p) => ease(from + (to - from) * Math.max(0, Math.min(1, p))) - a)
}
