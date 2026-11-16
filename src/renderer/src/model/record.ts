import type { Point } from './sample'

/**
 * What a recording keeps of a gesture (D397): the scene's time, and what the thing dragged shows
 * then, one take for each frame the playhead came to while it was dragged.
 */
export interface Take {
  time: number
  values: Record<string, number>
}

/**
 * The takes of a gesture as one for each frame, from the frame of the first to the frame of the
 * last: a frame the playhead passed over is filled in from its neighbours, and a frame taken
 * twice keeps the later take.
 */
export function perFrame(takes: Take[], fps: number): Record<string, number>[] {
  if (takes.length === 0) return []
  const frameOf = (time: number): number => Math.round(time * fps)
  const first = frameOf(takes[0]!.time)
  const last = frameOf(takes[takes.length - 1]!.time)
  const byFrame = new Map<number, Record<string, number>>()
  let carried: Record<string, number> = {}
  for (const take of takes) {
    // A value a take does not name is where the take before left it.
    carried = { ...carried, ...take.values }
    byFrame.set(frameOf(take.time), carried)
  }
  const out: Record<string, number>[] = []
  for (let f = first; f <= last; f++) {
    const exact = byFrame.get(f)
    if (exact) {
      out.push(exact)
      continue
    }
    let before = f - 1
    while (before > first && !byFrame.has(before)) before--
    let after = f + 1
    while (after < last && !byFrame.has(after)) after++
    const a = byFrame.get(before) ?? takes[0]!.values
    const b = byFrame.get(after) ?? a
    const t = after > before ? (f - before) / (after - before) : 0
    const mixed: Record<string, number> = {}
    for (const key of Object.keys(b)) mixed[key] = (a[key] ?? b[key]!) + (b[key]! - (a[key] ?? b[key]!)) * t
    out.push(mixed)
  }
  return out
}

/**
 * How far along a line each place lies, as a share of the line's length (D397): each place is
 * taken to the nearest point of the line that is not behind the one before it nor far ahead of
 * where the pointer could have gone, so a line that crosses itself is followed the way it was
 * drawn, and a hand held still stays where it is on the line. The first is at nothing and the
 * last at the whole.
 */
export function sharesAlong(places: Point[], line: Point[]): number[] {
  if (places.length === 0) return []
  const lengths: number[] = [0]
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y))
  const total = lengths[lengths.length - 1] ?? 0
  if (line.length < 2 || total <= 0) return places.map((_, i) => (places.length > 1 ? i / (places.length - 1) : 1))
  const out: number[] = []
  let arc = 0
  let segment = 0
  for (let k = 0; k < places.length; k++) {
    const p = places[k]!
    const stride = k > 0 ? Math.hypot(p.x - places[k - 1]!.x, p.y - places[k - 1]!.y) : 0
    // As far ahead as the pointer went since the place before, with room for the line's rounding of what was drawn.
    const reach = arc + stride * 2 + 12
    let best = arc
    let bestDistance = Infinity
    for (let i = segment; i < line.length - 1 && lengths[i]! <= reach; i++) {
      const a = line[i]!
      const b = line[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const span = dx * dx + dy * dy
      const t = span > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span)) : 0
      const at = Math.max(arc, lengths[i]! + Math.sqrt(span) * t)
      if (at > reach) continue
      const distance = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
      if (distance < bestDistance - 1e-9) {
        bestDistance = distance
        best = at
      }
    }
    arc = best
    while (segment < line.length - 2 && lengths[segment + 1]! <= arc) segment++
    out.push(arc / total)
  }
  out[0] = 0
  out[out.length - 1] = 1
  return out
}

/** A value part of the way through evenly spaced values, straight between them. */
function between(values: readonly number[], share: number): number {
  const last = values.length - 1
  if (last <= 0) return values[0] ?? 0
  const at = Math.max(0, Math.min(1, share)) * last
  const i = Math.min(last - 1, Math.floor(at))
  return values[i]! + (values[i + 1]! - values[i]!) * (at - i)
}

/** How many values a curve is tried with, fewest first. */
const COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256]

/**
 * The fewest values, evenly spaced, whose straight lines between them stay within `tolerance` of
 * every value given (D397): a recording is taken once a frame, and written with no more than it
 * needs. The first and the last are kept as they are.
 */
export function thinned(values: readonly number[], tolerance: number): number[] {
  const last = values.length - 1
  if (last <= 0) return [...values]
  for (const count of COUNTS) {
    if (count >= last) break
    const fewer = Array.from({ length: count + 1 }, (_, j) => between(values, j / count))
    let fits = true
    for (let i = 0; i <= last && fits; i++) if (Math.abs(between(fewer, i / last) - values[i]!) > tolerance) fits = false
    if (fits) return fewer
  }
  return [...values]
}

/**
 * How far a gesture on several values at once has come at each take, as a share of the way from
 * its first take to where it ended (D397): each take laid on the straight line between the two,
 * which is the way the animation written for it goes. A gesture that ends where it began is
 * measured to the take farthest from the start instead, and `to` says which take that was.
 */
export function sharesToward(takes: Record<string, number>[], keys: string[]): { shares: number[]; to: number } {
  if (takes.length === 0) return { shares: [], to: 0 }
  const first = takes[0]!
  const gap = (take: Record<string, number>): number => keys.reduce((sum, key) => sum + ((take[key] ?? first[key] ?? 0) - (first[key] ?? 0)) ** 2, 0)
  let to = takes.length - 1
  let farthest = takes.length - 1
  for (let i = 0; i < takes.length; i++) if (gap(takes[i]!) > gap(takes[farthest]!)) farthest = i
  // Back where it began, within a hundredth of how far it went: the way is measured to the farthest take.
  if (gap(takes[to]!) < gap(takes[farthest]!) * 1e-4) to = farthest
  const target = takes[to]!
  const whole = gap(target)
  if (whole <= 0) return { shares: takes.map(() => 0), to }
  const shares = takes.map((take) => keys.reduce((sum, key) => sum + ((take[key] ?? first[key] ?? 0) - (first[key] ?? 0)) * ((target[key] ?? first[key] ?? 0) - (first[key] ?? 0)), 0) / whole)
  return { shares, to }
}

/** A share as code: to a thousandth, with no zeros it does not need. */
function shareText(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** How many values of a curve stand on one row of the code: few enough for a row to fit a narrow code pane. */
const ROW = 5

/**
 * The ease a recorded gesture runs on, as code (D397): `Ease.curve([...])` with the values as
 * they are, or `'linear'` when a straight line says the same. A few values stay on the line;
 * more stand in rows under it, a step further in than the block's properties, which are at
 * `indent`, with the closing bracket level with them, as a list of points is written (D402): so
 * they fold away, and opened, read as rows.
 */
export function curveCode(values: readonly number[], indent = '  '): string {
  if (values.length <= 2 && Math.abs((values[0] ?? 0) - 0) < 5e-4 && Math.abs((values[values.length - 1] ?? 1) - 1) < 5e-4) return "'linear'"
  const texts = values.map(shareText)
  if (texts.length <= ROW) return `Ease.curve([${texts.join(', ')}])`
  const rows: string[] = []
  for (let i = 0; i < texts.length; i += ROW) rows.push(`${indent}  ${texts.slice(i, i + ROW).join(', ')},`)
  return `Ease.curve([\n${rows.join('\n')}\n${indent}])`
}
