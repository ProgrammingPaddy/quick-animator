/**
 * The morph of one outline into another (D257): both as cubics, piece by piece, their counts
 * made equal by splitting the longest segments, a closed pair set to run the same way round and
 * started where the anchors move least, then every anchor and control taken straight across. So
 * a shape keeps its corners and its curves all the way, two states of one shape tween point by
 * point, and the morph lands on the target exactly.
 */
import type { Point, Seg } from './pathData'

/** One cubic from an anchor to the next. */
interface Cubic {
  x1: number
  y1: number
  x2: number
  y2: number
  x: number
  y: number
}

/** A piece as cubics from a start; closed when its last cubic returns to the start. */
interface Ring {
  start: Point
  cubics: Cubic[]
  closed: boolean
}

export interface MorphPair {
  a: Ring
  b: Ring
}

/** The pieces of a path as rings of cubics: a line is a cubic with its controls a third of the way along, a quadratic is raised a degree, a close draws back to the start. */
function ringsOf(segs: Seg[]): Ring[] {
  const out: Ring[] = []
  let ring: Ring | null = null
  let x = 0
  let y = 0
  const third = (ax: number, ay: number, bx: number, by: number, k: number): Point => ({ x: ax + ((bx - ax) * k) / 3, y: ay + ((by - ay) * k) / 3 })
  const line = (bx: number, by: number): Cubic => {
    const c1 = third(x, y, bx, by, 1)
    const c2 = third(x, y, bx, by, 2)
    return { x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: bx, y: by }
  }
  for (const s of segs) {
    if (s.c === 'M') {
      ring = { start: { x: s.x, y: s.y }, cubics: [], closed: false }
      out.push(ring)
      x = s.x
      y = s.y
      continue
    }
    if (!ring) continue
    if (s.c === 'Z') {
      if (Math.hypot(x - ring.start.x, y - ring.start.y) > 1e-9) ring.cubics.push(line(ring.start.x, ring.start.y))
      ring.closed = true
      x = ring.start.x
      y = ring.start.y
      continue
    }
    if (s.c === 'L') ring.cubics.push(line(s.x, s.y))
    else if (s.c === 'C') ring.cubics.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, x: s.x, y: s.y })
    else {
      const c1 = third(x, y, s.x1, s.y1, 2)
      const c2 = third(s.x, s.y, s.x1, s.y1, 2)
      ring.cubics.push({ x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: s.x, y: s.y })
    }
    x = s.x
    y = s.y
  }
  return out.filter((r) => r.cubics.length > 0)
}

/** The anchors of a ring: its start and the end of every cubic but, when closed, the last, which is the start again. */
function anchorsOf(ring: Ring): Point[] {
  const ends = ring.cubics.map((c) => ({ x: c.x, y: c.y }))
  return [ring.start, ...(ring.closed ? ends.slice(0, -1) : ends)]
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** A cubic from `from` split in two at t, so the curve is unchanged. */
function splitCubic(from: Point, c: Cubic, t: number): [Cubic, Cubic] {
  const p1 = { x: c.x1, y: c.y1 }
  const p2 = { x: c.x2, y: c.y2 }
  const p3 = { x: c.x, y: c.y }
  const a = lerp(from, p1, t)
  const b = lerp(p1, p2, t)
  const d = lerp(p2, p3, t)
  const e = lerp(a, b, t)
  const f = lerp(b, d, t)
  const m = lerp(e, f, t)
  return [
    { x1: a.x, y1: a.y, x2: e.x, y2: e.y, x: m.x, y: m.y },
    { x1: f.x, y1: f.y, x2: d.x, y2: d.y, x: p3.x, y: p3.y },
  ]
}

/** About how long a cubic is: the length of its control polygon. */
function cubicLength(from: Point, c: Cubic): number {
  return Math.hypot(c.x1 - from.x, c.y1 - from.y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2)
}

/** The ring with one more cubic: its longest split in two. */
function grown(ring: Ring): Ring {
  let at = 0
  let longest = -1
  let from = ring.start
  ring.cubics.forEach((c, i) => {
    const length = cubicLength(from, c)
    if (length > longest) {
      longest = length
      at = i
    }
    from = { x: c.x, y: c.y }
  })
  const before = at === 0 ? ring.start : { x: ring.cubics[at - 1]!.x, y: ring.cubics[at - 1]!.y }
  const [first, second] = splitCubic(before, ring.cubics[at]!, 0.5)
  return { ...ring, cubics: [...ring.cubics.slice(0, at), first, second, ...ring.cubics.slice(at + 1)] }
}

/** The ring closed with a straight cubic back to its start, when it is open and goes anywhere. */
function closed(ring: Ring): Ring {
  if (ring.closed) return ring
  const last = ring.cubics[ring.cubics.length - 1]!
  if (Math.hypot(last.x - ring.start.x, last.y - ring.start.y) < 1e-9) return { ...ring, closed: true }
  const third = (k: number): Point => ({ x: last.x + ((ring.start.x - last.x) * k) / 3, y: last.y + ((ring.start.y - last.y) * k) / 3 })
  const c1 = third(1)
  const c2 = third(2)
  return { ...ring, closed: true, cubics: [...ring.cubics, { x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: ring.start.x, y: ring.start.y }] }
}

/** The ring run the other way round: its cubics in reverse order, each with its controls swapped; an open ring starts from its other end. */
function reversed(ring: Ring): Ring {
  const anchors = [ring.start, ...ring.cubics.map((c) => ({ x: c.x, y: c.y }))]
  const cubics: Cubic[] = []
  for (let i = ring.cubics.length - 1; i >= 0; i--) {
    const c = ring.cubics[i]!
    const end = anchors[i]!
    cubics.push({ x1: c.x2, y1: c.y2, x2: c.x1, y2: c.y1, x: end.x, y: end.y })
  }
  return { start: ring.closed ? ring.start : anchors[anchors.length - 1]!, cubics, closed: ring.closed }
}

/** A closed ring started at its k-th anchor. */
function rotated(ring: Ring, k: number): Ring {
  if (k === 0) return ring
  const anchors = anchorsOf(ring)
  return { start: anchors[k]!, cubics: [...ring.cubics.slice(k), ...ring.cubics.slice(0, k)], closed: true }
}

function signedArea(points: Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const q = points[(i + 1) % points.length]!
    area += p.x * q.y - q.x * p.y
  }
  return area / 2
}

/** A ring shrunk to the middle of its anchors: where a piece with no partner comes from or goes to. */
function collapsed(ring: Ring): Ring {
  const anchors = anchorsOf(ring)
  const m = anchors.reduce((s, p) => ({ x: s.x + p.x / anchors.length, y: s.y + p.y / anchors.length }), { x: 0, y: 0 })
  return { start: m, cubics: ring.cubics.map(() => ({ x1: m.x, y1: m.y, x2: m.x, y2: m.y, x: m.x, y: m.y })), closed: ring.closed }
}

/** The pairs a morph blends, once per morph (D257): the pieces of the two outlines matched in order, each pair as cubics of one count, the same way round, and started where the anchors move least. */
export function morphPairs(from: Seg[], to: Seg[]): MorphPair[] {
  const ringsA = ringsOf(from)
  const ringsB = ringsOf(to)
  const out: MorphPair[] = []
  const n = Math.max(ringsA.length, ringsB.length)
  for (let i = 0; i < n; i++) {
    let a = ringsA[i] ?? collapsed(ringsB[i]!)
    let b = ringsB[i] ?? collapsed(ringsA[i]!)
    if (a.closed !== b.closed) {
      a = closed(a)
      b = closed(b)
    }
    while (a.cubics.length < b.cubics.length) a = grown(a)
    while (b.cubics.length < a.cubics.length) b = grown(b)
    const anchorsA = anchorsOf(a)
    if (a.closed) {
      if (signedArea(anchorsA) * signedArea(anchorsOf(b)) < 0) b = reversed(b)
      const anchorsB = anchorsOf(b)
      const count = anchorsA.length
      let best = 0
      let bestCost = Infinity
      for (let k = 0; k < count; k++) {
        let cost = 0
        for (let j = 0; j < count && cost < bestCost; j++) {
          const p = anchorsA[j]!
          const q = anchorsB[(j + k) % count]!
          cost += (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)
        }
        if (cost < bestCost) {
          bestCost = cost
          best = k
        }
      }
      b = rotated(b, best)
    } else {
      const anchorsB = anchorsOf(b)
      const a0 = anchorsA[0]!
      const aN = anchorsA[anchorsA.length - 1]!
      const b0 = anchorsB[0]!
      const bN = anchorsB[anchorsB.length - 1]!
      const straight = Math.hypot(a0.x - b0.x, a0.y - b0.y) + Math.hypot(aN.x - bN.x, aN.y - bN.y)
      const swapped = Math.hypot(a0.x - bN.x, a0.y - bN.y) + Math.hypot(aN.x - b0.x, aN.y - b0.y)
      if (swapped < straight) b = reversed(b)
    }
    out.push({ a, b })
  }
  return out
}

/** The outline a morph draws at a progress: every anchor and control of each pair taken straight across, as path data. */
export function blendMorph(pairs: MorphPair[], p: number): Seg[] {
  const out: Seg[] = []
  for (const { a, b } of pairs) {
    const start = lerp(a.start, b.start, p)
    out.push({ c: 'M', x: start.x, y: start.y })
    a.cubics.forEach((ca, i) => {
      const cb = b.cubics[i]!
      out.push({ c: 'C', x1: ca.x1 + (cb.x1 - ca.x1) * p, y1: ca.y1 + (cb.y1 - ca.y1) * p, x2: ca.x2 + (cb.x2 - ca.x2) * p, y2: ca.y2 + (cb.y2 - ca.y2) * p, x: ca.x + (cb.x - ca.x) * p, y: ca.y + (cb.y - ca.y) * p })
    })
    if (a.closed) out.push({ c: 'Z' })
  }
  return out
}
