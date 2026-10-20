/**
 * SVG path data, the `d` of an SVG path, as a Shape's full form (D238): read in with every
 * command SVG has and kept as absolute moves, lines, cubic and quadratic curves, and closes, so
 * the rest of the app sees one small vocabulary. Arcs become cubics; H, V, S, and T become L,
 * C, and Q. Nothing here knows about objects: these are functions on lists of segments.
 */

export interface Point {
  x: number
  y: number
}

export type Seg = { c: 'M'; x: number; y: number } | { c: 'L'; x: number; y: number } | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { c: 'Q'; x1: number; y1: number; x: number; y: number } | { c: 'Z' }

/** One continuous piece of a path, drawn as a polyline: its points, whether it closes, and for each point the segment and the place along it, so a point can be put in where a click lands. A closed piece ends with its start point again. */
export interface Subpath {
  points: Point[]
  closed: boolean
  at: { seg: number; t: number }[]
}

/** An affine matrix as SVG writes it: x' = a x + c y + e, y' = b x + d y + f. */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y

/** A number as the app writes it: up to four decimals, no minus zero. */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 10000) / 10000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** The commands and their numbers, as written; an arc's two flags are read as single digits, since they may be run together. */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = []
  let current: { cmd: string; args: number[] } | null = null
  let i = 0
  while (i < d.length) {
    const ch = d[i]!
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      current = { cmd: ch, args: [] }
      out.push(current)
      i++
      continue
    }
    if (/[\s,]/.test(ch)) {
      i++
      continue
    }
    if (current && (current.cmd === 'A' || current.cmd === 'a') && (current.args.length % 7 === 3 || current.args.length % 7 === 4) && (ch === '0' || ch === '1')) {
      current.args.push(Number(ch))
      i++
      continue
    }
    NUMBER.lastIndex = i
    const m = NUMBER.exec(d)
    if (m) {
      if (current) current.args.push(Number(m[0]))
      i += m[0].length
      continue
    }
    i++
  }
  return out
}

/** How many numbers each command takes; a command may repeat with more. */
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** An elliptical arc as cubic curves, by the SVG endpoint rules, each piece a quarter turn at most. */
function arcToCubics(x0: number, y0: number, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, x: number, y: number): Seg[] {
  if (x0 === x && y0 === y) return []
  if (rx === 0 || ry === 0) return [{ c: 'L', x, y }]
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (rotation * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x0 - x) / 2
  const dy = (y0 - y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    lambda = Math.sqrt(lambda)
    rx *= lambda
    ry *= lambda
  }
  const sign = large === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den))
  const cx1 = (k * rx * y1) / ry
  const cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const step = delta / pieces
  const out: Seg[] = []
  let a0 = theta
  const point = (a: number): Point => ({ x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos })
  const tangent = (a: number): Point => ({ x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos })
  for (let i = 0; i < pieces; i++) {
    const a1 = a0 + step
    const alpha = (4 / 3) * Math.tan((a1 - a0) / 4)
    const p0 = point(a0)
    const p3 = point(a1)
    const t0 = tangent(a0)
    const t1 = tangent(a1)
    const last = i === pieces - 1
    out.push({ c: 'C', x1: p0.x + alpha * t0.x, y1: p0.y + alpha * t0.y, x2: p3.x - alpha * t1.x, y2: p3.y - alpha * t1.y, x: last ? x : p3.x, y: last ? y : p3.y })
    a0 = a1
  }
  return out
}

/** Path data read in: absolute M, L, C, Q, and Z, whatever was written. Bad data gives what could be read. */
export function parsePathData(d: string): Seg[] {
  const segs: Seg[] = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let lastControl: Point | null = null
  let lastCommand = ''
  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase()
    const relative = cmd !== upper
    const arity = ARITY[upper] ?? 0
    const count = arity === 0 ? 1 : Math.floor(args.length / arity)
    for (let i = 0; i < count; i++) {
      const a = args.slice(i * arity, (i + 1) * arity)
      const ox = relative ? x : 0
      const oy = relative ? y : 0
      // After a move, further pairs are lines.
      const command = upper === 'M' && i > 0 ? 'L' : upper
      switch (command) {
        case 'M':
          x = a[0]! + ox
          y = a[1]! + oy
          startX = x
          startY = y
          segs.push({ c: 'M', x, y })
          lastControl = null
          break
        case 'L':
          x = a[0]! + ox
          y = a[1]! + oy
          segs.push({ c: 'L', x, y })
          lastControl = null
          break
        case 'H':
          x = a[0]! + ox
          segs.push({ c: 'L', x, y })
          lastControl = null
          break
        case 'V':
          y = a[0]! + oy
          segs.push({ c: 'L', x, y })
          lastControl = null
          break
        case 'C': {
          const seg: Seg = { c: 'C', x1: a[0]! + ox, y1: a[1]! + oy, x2: a[2]! + ox, y2: a[3]! + oy, x: a[4]! + ox, y: a[5]! + oy }
          segs.push(seg)
          lastControl = { x: seg.x2, y: seg.y2 }
          x = seg.x
          y = seg.y
          break
        }
        case 'S': {
          const reflect: Point = lastControl && (lastCommand === 'C' || lastCommand === 'S') ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y } : { x, y }
          const seg: Seg = { c: 'C', x1: reflect.x, y1: reflect.y, x2: a[0]! + ox, y2: a[1]! + oy, x: a[2]! + ox, y: a[3]! + oy }
          segs.push(seg)
          lastControl = { x: seg.x2, y: seg.y2 }
          x = seg.x
          y = seg.y
          break
        }
        case 'Q': {
          const seg: Seg = { c: 'Q', x1: a[0]! + ox, y1: a[1]! + oy, x: a[2]! + ox, y: a[3]! + oy }
          segs.push(seg)
          lastControl = { x: seg.x1, y: seg.y1 }
          x = seg.x
          y = seg.y
          break
        }
        case 'T': {
          const reflect: Point = lastControl && (lastCommand === 'Q' || lastCommand === 'T') ? { x: 2 * x - lastControl.x, y: 2 * y - lastControl.y } : { x, y }
          const seg: Seg = { c: 'Q', x1: reflect.x, y1: reflect.y, x: a[0]! + ox, y: a[1]! + oy }
          segs.push(seg)
          lastControl = { x: seg.x1, y: seg.y1 }
          x = seg.x
          y = seg.y
          break
        }
        case 'A': {
          const ex = a[5]! + ox
          const ey = a[6]! + oy
          segs.push(...arcToCubics(x, y, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, ex, ey))
          x = ex
          y = ey
          lastControl = null
          break
        }
        case 'Z':
          segs.push({ c: 'Z' })
          x = startX
          y = startY
          lastControl = null
          break
      }
      lastCommand = command
    }
  }
  return segs
}

/** Path data written out, one command per line: absolute commands, numbers to a hundredth of a pixel. */
export function serializePathLines(segs: Seg[], decimals = 2): string[] {
  const k = 10 ** decimals
  const f = (n: number): string => formatNumber(Math.round(n * k) / k)
  return segs.map((s) => {
    switch (s.c) {
      case 'M':
      case 'L':
        return `${s.c} ${f(s.x)} ${f(s.y)}`
      case 'C':
        return `C ${f(s.x1)} ${f(s.y1)} ${f(s.x2)} ${f(s.y2)} ${f(s.x)} ${f(s.y)}`
      case 'Q':
        return `Q ${f(s.x1)} ${f(s.y1)} ${f(s.x)} ${f(s.y)}`
      case 'Z':
        return 'Z'
    }
  })
}

/** Path data written out on one line, one space between commands. */
export function serializePathData(segs: Seg[], decimals = 2): string {
  return serializePathLines(segs, decimals).join(' ')
}

/**
 * Curves as the code writes them (D244): a template string with one command per line, which
 * folds like a list of points and keeps the code pane quick, since a long line costs it dearly.
 * `indent` is that of the block's properties; the commands sit one step further in, the
 * closing backtick level with the properties, as a list of points is written.
 */
export function formatCurves(d: string, indent: string): string {
  const lines = serializePathLines(parsePathData(d))
  if (lines.length === 0) return "''"
  return `\`\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}\``
}

/** The point a cubic curve reaches at t. */
function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y }
}

function quadAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }
}

/** How many pieces a curve is drawn in: by the length of its control polygon, so a long or tight curve gets more. */
function stepsFor(points: Point[], tolerance: number): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  return Math.max(4, Math.min(64, Math.ceil(Math.sqrt(length / Math.max(0.05, tolerance)) * 1.5)))
}

/** The path drawn as polylines, one per subpath, each point tagged with where it came from (D238). */
export function flattenPathData(segs: Seg[], tolerance = 0.5): Subpath[] {
  const out: Subpath[] = []
  let current: Subpath | null = null
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  const push = (p: Point, seg: number, t: number) => {
    if (!current) {
      current = { points: [], closed: false, at: [] }
      out.push(current)
    }
    current.points.push(p)
    current.at.push({ seg, t })
  }
  segs.forEach((s, index) => {
    switch (s.c) {
      case 'M':
        current = null
        x = s.x
        y = s.y
        startX = x
        startY = y
        push({ x, y }, index, 0)
        break
      case 'L':
        if (!current) push({ x, y }, index, 0)
        x = s.x
        y = s.y
        push({ x, y }, index, 1)
        break
      case 'C': {
        if (!current) push({ x, y }, index, 0)
        const p0 = { x, y }
        const p1 = { x: s.x1, y: s.y1 }
        const p2 = { x: s.x2, y: s.y2 }
        const p3 = { x: s.x, y: s.y }
        const n = stepsFor([p0, p1, p2, p3], tolerance)
        for (let k = 1; k <= n; k++) push(cubicAt(p0, p1, p2, p3, k / n), index, k / n)
        x = s.x
        y = s.y
        break
      }
      case 'Q': {
        if (!current) push({ x, y }, index, 0)
        const p0 = { x, y }
        const p1 = { x: s.x1, y: s.y1 }
        const p2 = { x: s.x, y: s.y }
        const n = stepsFor([p0, p1, p2], tolerance)
        for (let k = 1; k <= n; k++) push(quadAt(p0, p1, p2, k / n), index, k / n)
        x = s.x
        y = s.y
        break
      }
      case 'Z':
        if (current) {
          const piece: Subpath = current
          piece.closed = true
          // The closing line, back to the start, is drawn too; a point put in on it goes before the Z.
          const last = piece.points[piece.points.length - 1]!
          if (Math.hypot(last.x - startX, last.y - startY) > 1e-9) push({ x: startX, y: startY }, index, 1)
        }
        current = null
        x = startX
        y = startY
        break
    }
  })
  return out.filter((sp) => sp.points.length > 0)
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** The box around drawn points: its center and size; the origin and nothing when there are none. */
export function boundsOf(points: Point[]): Bounds {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const p of points) {
    left = Math.min(left, p.x)
    right = Math.max(right, p.x)
    bottom = Math.min(bottom, p.y)
    top = Math.max(top, p.y)
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom }
}

/** The box around the drawn path, by its flattened points. */
export function pathDataBounds(segs: Seg[]): Bounds {
  return boundsOf(flattenPathData(segs).flatMap((sp) => sp.points))
}

/** Every coordinate of the path put through a function. */
function mapPoints(segs: Seg[], fn: (p: Point) => Point): Seg[] {
  return segs.map((s) => {
    switch (s.c) {
      case 'M':
      case 'L': {
        const p = fn({ x: s.x, y: s.y })
        return { c: s.c, x: p.x, y: p.y }
      }
      case 'C': {
        const a = fn({ x: s.x1, y: s.y1 })
        const b = fn({ x: s.x2, y: s.y2 })
        const p = fn({ x: s.x, y: s.y })
        return { c: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: p.x, y: p.y }
      }
      case 'Q': {
        const a = fn({ x: s.x1, y: s.y1 })
        const p = fn({ x: s.x, y: s.y })
        return { c: 'Q', x1: a.x, y1: a.y, x: p.x, y: p.y }
      }
      case 'Z':
        return s
    }
  })
}

export function translatePathData(segs: Seg[], dx: number, dy: number): Seg[] {
  return dx === 0 && dy === 0 ? segs : mapPoints(segs, (p) => ({ x: p.x + dx, y: p.y + dy }))
}

/** The path under an affine matrix, as SVG applies one. */
export function transformPathData(segs: Seg[], m: Matrix): Seg[] {
  return mapPoints(segs, (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }))
}

/** The path scaled about a point, each axis by its factor. */
export function scalePathData(segs: Seg[], anchor: Point, fx: number, fy: number): Seg[] {
  return mapPoints(segs, (p) => ({ x: anchor.x + (p.x - anchor.x) * fx, y: anchor.y + (p.y - anchor.y) * fy }))
}

/** The path with y turned over, for SVG's y down against the scene's y up. */
export function flipPathData(segs: Seg[]): Seg[] {
  return mapPoints(segs, (p) => ({ x: p.x, y: -p.y }))
}

/**
 * One anchor of a path: the end of a segment, with the control before it and the control after
 * it when those are curves (D240). The first anchor of a closed piece whose last segment comes
 * back to it stands for both ends: `twin` is that last segment, which moves with it.
 */
export interface Anchor {
  seg: number
  x: number
  y: number
  in: Point | null
  out: Point | null
  twin?: number
}

/** A control drawn in onto its anchor is no control: it is not shown and not a handle (D245). */
function awayFrom(control: Point, anchor: Point): Point | null {
  return Math.hypot(control.x - anchor.x, control.y - anchor.y) < 1e-6 ? null : control
}

function controlBefore(s: Seg | undefined): Point | null {
  if (!s) return null
  const control = s.c === 'C' ? { x: s.x2, y: s.y2 } : s.c === 'Q' ? { x: s.x1, y: s.y1 } : null
  return control && s.c !== 'Z' && s.c !== 'M' ? awayFrom(control, { x: s.x, y: s.y }) : null
}

function controlAfter(s: Seg | undefined, anchor: Point): Point | null {
  return s && (s.c === 'C' || s.c === 'Q') ? awayFrom({ x: s.x1, y: s.y1 }, anchor) : null
}

/** The anchors of a path, in order: every move, line, and curve end, a closed piece's start counted once. */
export function pathAnchors(segs: Seg[]): Anchor[] {
  const out: Anchor[] = []
  let startAnchor = -1
  segs.forEach((s, i) => {
    if (s.c === 'Z') {
      const first = out[startAnchor]
      const last = out[out.length - 1]
      if (first && last && last !== first && last.seg === i - 1 && Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) {
        first.in = last.in
        first.twin = last.seg
        out.pop()
      }
      return
    }
    if (s.c === 'M') startAnchor = out.length
    out.push({ seg: i, x: s.x, y: s.y, in: controlBefore(s), out: controlAfter(segs[i + 1], { x: s.x, y: s.y }) })
  })
  return out
}

/** The path with one anchor moved, its controls with it, so the curve keeps its shape around it. */
export function moveAnchor(segs: Seg[], index: number, x: number, y: number): Seg[] {
  const anchor = pathAnchors(segs)[index]
  if (!anchor) return segs
  const dx = x - anchor.x
  const dy = y - anchor.y
  return segs.map((s, i) => {
    if (i === anchor.seg || i === anchor.twin) {
      if (s.c === 'C') return { ...s, x2: s.x2 + dx, y2: s.y2 + dy, x, y }
      if (s.c === 'Q') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x, y }
      if (s.c === 'M' || s.c === 'L') return { ...s, x, y }
      return s
    }
    if (i === anchor.seg + 1 && (s.c === 'C' || s.c === 'Q')) return { ...s, x1: s.x1 + dx, y1: s.y1 + dy }
    return s
  })
}

/** The path with one control of an anchor moved: `in`, the control before it, or `out`, the one after. */
export function setAnchorHandle(segs: Seg[], index: number, which: 'in' | 'out', x: number, y: number): Seg[] {
  const anchor = pathAnchors(segs)[index]
  if (!anchor) return segs
  const at = which === 'in' ? (anchor.twin ?? anchor.seg) : anchor.seg + 1
  return segs.map((s, i) => {
    if (i !== at) return s
    if (which === 'in') {
      if (s.c === 'C') return { ...s, x2: x, y2: y }
      if (s.c === 'Q') return { ...s, x1: x, y1: y }
      return s
    }
    if (s.c === 'C' || s.c === 'Q') return { ...s, x1: x, y1: y }
    return s
  })
}

/** Where a segment begins, the end of the one before it, and where its subpath began. */
function before(segs: Seg[], index: number): { point: Point; start: Point } {
  let start: Point = { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (let i = 0; i < index; i++) {
    const s = segs[i]!
    if (s.c === 'Z') {
      x = start.x
      y = start.y
    } else {
      x = s.x
      y = s.y
      if (s.c === 'M') start = { x, y }
    }
  }
  return { point: { x, y }, start }
}

/**
 * The path with a new anchor put in on a segment at t, the curve kept as it was (de Casteljau);
 * on a close, a line point before it. Returns the path and the new anchor's index.
 */
export function splitSegment(segs: Seg[], index: number, t: number): { segs: Seg[]; anchor: number } {
  const s = segs[index]
  if (!s || s.c === 'M') return { segs, anchor: Math.max(0, pathAnchors(segs).findIndex((a) => a.seg >= index)) }
  const { point: p0, start } = before(segs, index)
  const lerp = (a: Point, b: Point): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const out = [...segs]
  if (s.c === 'Z') {
    const p = lerp(p0, start)
    out.splice(index, 0, { c: 'L', x: p.x, y: p.y })
  } else if (s.c === 'L') {
    const p = lerp(p0, { x: s.x, y: s.y })
    out.splice(index, 1, { c: 'L', x: p.x, y: p.y }, { c: 'L', x: s.x, y: s.y })
  } else if (s.c === 'Q') {
    const p1 = { x: s.x1, y: s.y1 }
    const p2 = { x: s.x, y: s.y }
    const a = lerp(p0, p1)
    const b = lerp(p1, p2)
    const p = lerp(a, b)
    out.splice(index, 1, { c: 'Q', x1: a.x, y1: a.y, x: p.x, y: p.y }, { c: 'Q', x1: b.x, y1: b.y, x: p2.x, y: p2.y })
  } else {
    const p1 = { x: s.x1, y: s.y1 }
    const p2 = { x: s.x2, y: s.y2 }
    const p3 = { x: s.x, y: s.y }
    const a = lerp(p0, p1)
    const b = lerp(p1, p2)
    const c = lerp(p2, p3)
    const d = lerp(a, b)
    const e = lerp(b, c)
    const p = lerp(d, e)
    out.splice(index, 1, { c: 'C', x1: a.x, y1: a.y, x2: d.x, y2: d.y, x: p.x, y: p.y }, { c: 'C', x1: e.x, y1: e.y, x2: c.x, y2: c.y, x: p3.x, y: p3.y })
  }
  return { segs: out, anchor: pathAnchors(out).findIndex((a) => a.seg === index) }
}

/** The path without one anchor: the segments on either side become one, a curve when either was, a line otherwise; a piece's first anchor hands its start to the next, a closed piece's closing segment coming back to it. */
export function removeAnchor(segs: Seg[], index: number): Seg[] {
  const anchor = pathAnchors(segs)[index]
  if (!anchor) return segs
  const s = segs[anchor.seg]!
  const next = segs[anchor.seg + 1]
  const out = [...segs]
  if (s.c === 'M') {
    if (anchor.twin !== undefined && next && anchor.twin !== anchor.seg + 1 && next.c !== 'Z' && next.c !== 'M') {
      const start = { x: next.x, y: next.y }
      const twin = out[anchor.twin]!
      if (twin.c !== 'Z' && twin.c !== 'M') out[anchor.twin] = { ...twin, x: start.x, y: start.y }
      out.splice(anchor.seg, 2, { c: 'M', x: start.x, y: start.y })
      return out
    }
    if (!next || next.c === 'Z' || next.c === 'M' || anchor.twin === anchor.seg + 1) {
      // A piece of one anchor goes whole: the move, a segment back to it, and the close.
      out.splice(anchor.seg, !next || next.c === 'M' ? 1 : next.c === 'Z' ? 2 : 3)
      return out
    }
    out.splice(anchor.seg, 2, { c: 'M', x: next.x, y: next.y })
    return out
  }
  if (!next || next.c === 'Z' || next.c === 'M') {
    out.splice(anchor.seg, 1)
    return out
  }
  const { point: start } = before(segs, anchor.seg)
  if (s.c === 'L' && next.c === 'L') out.splice(anchor.seg, 2, { c: 'L', x: next.x, y: next.y })
  else {
    const c1 = s.c === 'C' ? { x: s.x1, y: s.y1 } : s.c === 'Q' ? { x: s.x1, y: s.y1 } : start
    const c2 = next.c === 'C' ? { x: next.x2, y: next.y2 } : next.c === 'Q' ? { x: next.x1, y: next.y1 } : { x: next.x, y: next.y }
    out.splice(anchor.seg, 2, { c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: next.x, y: next.y })
  }
  return out
}

/** Whether an anchor is smooth: a control on each side, in one line through it within a degree. Anything else is a corner (D245). */
/** Whether an anchor is smooth: a control on each side, the two in one line through it (D245). */
export function anchorIsSmooth(a: { x: number; y: number; in: Point | null; out: Point | null }): boolean {
  if (!a.in || !a.out) return false
  const u = { x: a.x - a.in.x, y: a.y - a.in.y }
  const v = { x: a.out.x - a.x, y: a.out.y - a.y }
  const l = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)
  return l > 1e-12 && (u.x * v.x + u.y * v.y) / l > 0.9998
}

export function isSmoothAnchor(segs: Seg[], index: number): boolean {
  const a = pathAnchors(segs)[index]
  return !!a && anchorIsSmooth(a)
}

/** What an anchor is, by its controls alone (D252): smooth, a control on each side in one line; straight, no control, both sides lines; else a corner, with a control on one side or on both that move alone; an end of an open piece has one side, so it is none of these. */
export type AnchorKind = 'smooth' | 'corner' | 'straight' | 'end'

export function anchorKind(segs: Seg[], index: number): AnchorKind {
  const a = pathAnchors(segs)[index]
  if (!a) return 'straight'
  const { prev, next } = neighbours(segs, a)
  if (!prev || !next) return 'end'
  if (!a.in && !a.out) return 'straight'
  return anchorIsSmooth(a) ? 'smooth' : 'corner'
}

/** Whether a segment on either side of an anchor is a curve. */
export function anchorCurved(segs: Seg[], index: number): boolean {
  const a = pathAnchors(segs)[index]
  if (!a) return false
  const segIn = segs[a.twin ?? a.seg]
  const segOut = segs[a.seg + 1]
  return (!!segIn && (segIn.c === 'C' || segIn.c === 'Q')) || (!!segOut && (segOut.c === 'C' || segOut.c === 'Q'))
}

/** Whether a segment is a curve or a line; a move counts as a line. */
export function segmentKind(segs: Seg[], index: number): 'curve' | 'line' {
  const s = segs[index]
  return s && (s.c === 'C' || s.c === 'Q') ? 'curve' : 'line'
}

/** The index of the close that ends the piece a move starts, or -1 when the piece is open. */
function pieceClose(segs: Seg[], move: number): number {
  for (let i = move + 1; i < segs.length; i++) {
    const c = segs[i]!.c
    if (c === 'Z') return i
    if (c === 'M') break
  }
  return -1
}

/** The anchor before and the anchor after one, as points: around the piece when it is closed, none past an open end. */
function neighbours(segs: Seg[], a: Anchor): { prev: Point | null; next: Point | null } {
  let prev: Point | null = null
  if (a.twin !== undefined) prev = before(segs, a.twin).point
  else if (segs[a.seg]!.c !== 'M') prev = before(segs, a.seg).point
  else {
    const z = pieceClose(segs, a.seg)
    if (z > a.seg + 1) prev = before(segs, z).point
  }
  let next: Point | null = null
  const segOut = segs[a.seg + 1]
  if (segOut && (segOut.c === 'L' || segOut.c === 'C' || segOut.c === 'Q')) next = { x: segOut.x, y: segOut.y }
  else if (segOut?.c === 'Z') {
    const start = before(segs, a.seg + 1).start
    if (Math.hypot(start.x - a.x, start.y - a.y) > 1e-6) next = start
  }
  return { prev, next }
}

/** The path with a control moved; with `smooth`, the control on the other side turns to stay in line through the anchor, its length kept (D245). */
export function dragAnchorHandle(segs: Seg[], index: number, which: 'in' | 'out', x: number, y: number, smooth: boolean): Seg[] {
  const out = setAnchorHandle(segs, index, which, x, y)
  const a = pathAnchors(out)[index]
  const other = a ? (which === 'in' ? a.out : a.in) : null
  if (!smooth || !a || !other) return out
  const dx = x - a.x
  const dy = y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return out
  const keep = Math.hypot(other.x - a.x, other.y - a.y)
  return setAnchorHandle(out, index, which === 'in' ? 'out' : 'in', a.x - (dx / len) * keep, a.y - (dy / len) * keep)
}

/** The segment at an index as a cubic: a line's controls a third of the way along it, a quadratic's raised a degree; a close with a way still to go gets a cubic put in before it (D245). */
export function cubicSegment(segs: Seg[], index: number): Seg[] {
  const s = segs[index]
  if (!s || s.c === 'M' || s.c === 'C') return segs
  const { point: p0, start } = before(segs, index)
  const out = [...segs]
  const third = (a: Point, b: Point, k: number): Point => ({ x: a.x + ((b.x - a.x) * k) / 3, y: a.y + ((b.y - a.y) * k) / 3 })
  if (s.c === 'Z') {
    if (Math.hypot(p0.x - start.x, p0.y - start.y) < 1e-6) return segs
    const c1 = third(p0, start, 1)
    const c2 = third(p0, start, 2)
    out.splice(index, 0, { c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: start.x, y: start.y })
    return out
  }
  if (s.c === 'L') {
    const c1 = third(p0, s, 1)
    const c2 = third(p0, s, 2)
    out[index] = { c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: s.x, y: s.y }
  } else {
    const q = { x: s.x1, y: s.y1 }
    const c1 = third(p0, q, 2)
    const c2 = third({ x: s.x, y: s.y }, q, 2)
    out[index] = { c: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: s.x, y: s.y }
  }
  return out
}

/** The segment at an index as a line (D252): a curve becomes the line to its end; one that ends where its closed piece began, right before the close, goes, since the close is that line. */
export function straightenSegment(segs: Seg[], index: number): Seg[] {
  const s = segs[index]
  if (!s || (s.c !== 'C' && s.c !== 'Q')) return segs
  const { start } = before(segs, index)
  const out = [...segs]
  if (segs[index + 1]?.c === 'Z' && Math.hypot(s.x - start.x, s.y - start.y) < 1e-6) out.splice(index, 1)
  else out[index] = { c: 'L', x: s.x, y: s.y }
  return out
}

/** Every segment a line: a polygon or a polyline with the same corners. */
export function straightenAll(segs: Seg[]): Seg[] {
  let out = segs
  for (let i = out.length - 1; i >= 0; i--) out = straightenSegment(out, i)
  return out
}

/** The path closed: a close on its end when it has none. */
export function closePath(segs: Seg[]): Seg[] {
  return segs.length > 0 && segs[segs.length - 1]!.c === 'Z' ? segs : [...segs, { c: 'Z' }]
}

/** The path opened: its close taken off, and the segment that drew back to its start with it, so the ends part (D253). */
export function openPath(segs: Seg[]): Seg[] {
  if (segs.length === 0 || segs[segs.length - 1]!.c !== 'Z') return segs
  const out = segs.slice(0, -1)
  const last = out[out.length - 1]
  if (last && (last.c === 'L' || last.c === 'C' || last.c === 'Q')) {
    const { start } = before(out, out.length - 1)
    if (Math.hypot(last.x - start.x, last.y - start.y) < 1e-6) out.pop()
  }
  return out
}

/** The path with these anchors made straight (D252): the segment on each side a line, so no control is left on them. */
export function straightenAnchors(segs: Seg[], indices: number[]): Seg[] {
  let out = segs
  for (const index of indices) {
    let a = pathAnchors(out)[index]
    if (!a) continue
    out = straightenSegment(out, a.seg + 1)
    a = pathAnchors(out)[index]!
    out = straightenSegment(out, a.twin ?? a.seg)
  }
  return out
}

/** The segment on one side of an anchor as a cubic, the close of its piece included, so the anchor has a control there. */
function curveSide(segs: Seg[], a: Anchor, which: 'in' | 'out'): Seg[] {
  if (which === 'out') return cubicSegment(segs, a.seg + 1)
  if (a.twin !== undefined) return cubicSegment(segs, a.twin)
  if (segs[a.seg]!.c !== 'M') return cubicSegment(segs, a.seg)
  const z = pieceClose(segs, a.seg)
  return z > 0 ? cubicSegment(segs, z) : segs
}

/**
 * The path with these anchors made corners (D252): each control turned to point at the anchor
 * on its side, its length kept, so both sides leave the point as straight lines would and bend
 * further on; a side with no control stays a line. Controls of a corner move alone.
 */
export function cornerAnchors(segs: Seg[], indices: number[]): Seg[] {
  let out = segs
  for (const index of indices) {
    const a = pathAnchors(out)[index]
    if (!a) continue
    const { prev, next } = neighbours(out, a)
    const aim = (which: 'in' | 'out', control: Point, at: Point): void => {
      const dx = at.x - a.x
      const dy = at.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) return
      const reach = Math.hypot(control.x - a.x, control.y - a.y)
      out = setAnchorHandle(out, index, which, a.x + (dx / len) * reach, a.y + (dy / len) * reach)
    }
    if (a.in && prev) aim('in', a.in, prev)
    if (a.out && next) aim('out', a.out, next)
  }
  return out
}

/**
 * The path with these anchors made smooth (D245, D252): a line on either side becomes a curve,
 * the close of the piece included, and the controls go in one line along the way from the
 * anchor before to the one after, each keeping its reach, a new one a third of the way to its
 * neighbour. Every side is curved before any anchor is aligned, so the close is a curve by the
 * time its start is set.
 */
export function smoothAnchors(segs: Seg[], indices: number[]): Seg[] {
  let out = segs
  for (const index of indices) {
    const a = pathAnchors(out)[index]
    if (!a) continue
    out = curveSide(out, a, 'out')
    out = curveSide(out, pathAnchors(out)[index]!, 'in')
  }
  for (const index of indices) {
    const a = pathAnchors(out)[index]
    if (!a) continue
    const { prev, next } = neighbours(out, a)
    if (!prev && !next) continue
    const from = prev ?? a
    const to = next ?? a
    let dx = to.x - from.x
    let dy = to.y - from.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    dx /= len
    dy /= len
    const reach = (control: Point | null, neighbour: Point): number => (control ? Math.hypot(control.x - a.x, control.y - a.y) : Math.hypot(neighbour.x - a.x, neighbour.y - a.y) / 3)
    const segIn = out[a.twin ?? a.seg]
    const segOut = out[a.seg + 1]
    if (prev && segIn && (segIn.c === 'C' || segIn.c === 'Q')) {
      const l = reach(a.in, prev)
      out = setAnchorHandle(out, index, 'in', a.x - dx * l, a.y - dy * l)
    }
    if (next && segOut && (segOut.c === 'C' || segOut.c === 'Q')) {
      const l = reach(a.out, next)
      out = setAnchorHandle(out, index, 'out', a.x + dx * l, a.y + dy * l)
    }
  }
  return out
}

/** The anchors of the piece a segment belongs to, in order, each once, and which span among them the segment is: the k-th runs from the k-th anchor to the next, the last around to the first when the piece is closed. */
function pieceSpans(segs: Seg[], index: number): { pts: Point[]; k: number; closed: boolean } | null {
  let m = index
  while (m >= 0 && segs[m]!.c !== 'M') m--
  if (m < 0) return null
  const first = segs[m] as { x: number; y: number }
  const pts: Point[] = [{ x: first.x, y: first.y }]
  let closed = false
  for (let i = m + 1; i < segs.length; i++) {
    const s = segs[i]!
    if (s.c === 'M') break
    if (s.c === 'Z') {
      closed = true
      break
    }
    pts.push({ x: s.x, y: s.y })
  }
  // A closed piece drawn back to its start holds that point once.
  let back = false
  if (closed && pts.length > 1 && Math.hypot(pts[pts.length - 1]!.x - pts[0]!.x, pts[pts.length - 1]!.y - pts[0]!.y) < 1e-6) {
    pts.pop()
    back = true
  }
  const n = pts.length
  if (n < 2) return null
  const s = segs[index]!
  let k: number
  if (s.c === 'Z') {
    if (back) return null
    k = n - 1
  } else {
    const j = index - m
    k = back && j === n ? n - 1 : j - 1
  }
  return { pts, k, closed }
}

/**
 * The segment at an index as a curve (D252): a line becomes the cubic of the spline through the
 * anchors around it, so it bows as Smooth would have it, with controls to pull; a quadratic is
 * raised a degree; a close with a way still to go gets the cubic put in before it.
 */
export function curveSegment(segs: Seg[], index: number): Seg[] {
  const s = segs[index]
  if (!s || s.c === 'M' || s.c === 'C') return segs
  if (s.c === 'Q') return cubicSegment(segs, index)
  const piece = pieceSpans(segs, index)
  if (!piece) return segs
  const { pts, k, closed } = piece
  const n = pts.length
  const p1 = pts[k]!
  const p2 = closed ? pts[(k + 1) % n]! : pts[k + 1]
  if (!p2 || Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) return segs
  const reflect = (a: Point, b: Point): Point => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y })
  const p0 = closed ? pts[(k - 1 + n) % n]! : k > 0 ? pts[k - 1]! : reflect(p1, p2)
  const p3 = closed ? pts[(k + 2) % n]! : k + 2 < n ? pts[k + 2]! : reflect(p2, p1)
  const c = splineCubic(p0, p1, p2, p3)
  const seg: Seg = { c: 'C', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: p2.x, y: p2.y }
  const out = [...segs]
  if (s.c === 'Z') out.splice(index, 0, seg)
  else out[index] = seg
  return out
}

/** Where a press between two drawn points of a flattened path lands in it: the second point's segment and the place along it, from the fraction `f` of the way between them (D240). */
export function placeBetween(from: { seg: number; t: number } | undefined, to: { seg: number; t: number } | undefined, f: number): { seg: number; t: number } | null {
  if (!to) return null
  const t0 = from && from.seg === to.seg ? from.t : 0
  return { seg: to.seg, t: t0 + (to.t - t0) * Math.max(0, Math.min(1, f)) }
}

/** Whether every segment is a line: a polygon or a polyline, which `points` can hold. */
export function isPolyline(segs: Seg[]): boolean {
  return segs.every((s, i) => (i === 0 ? s.c === 'M' : s.c === 'L' || (s.c === 'Z' && i === segs.length - 1)))
}

/** Points as path data: lines between them, closed or not. */
export function polygonPathData(points: Point[], closed: boolean): Seg[] {
  if (points.length === 0) return []
  const out: Seg[] = [{ c: 'M', x: points[0]!.x, y: points[0]!.y }]
  for (let i = 1; i < points.length; i++) out.push({ c: 'L', x: points[i]!.x, y: points[i]!.y })
  if (closed) out.push({ c: 'Z' })
  return out
}

/**
 * The smooth curve through points, the centripetal Catmull-Rom spline paths and shapes use
 * (D199), as cubic curves, exactly: each span between two points is one cubic whose controls
 * come from the neighbours and the square-root spacing. Open curves mirror their ends.
 */
export function smoothPathData(points: Point[], closed: boolean): Seg[] {
  const n = points.length
  if (n < 3) return polygonPathData(points, closed)
  const at = (i: number): Point => {
    if (closed) return points[((i % n) + n) % n]!
    if (i < 0) return { x: 2 * points[0]!.x - points[1]!.x, y: 2 * points[0]!.y - points[1]!.y }
    if (i >= n) return { x: 2 * points[n - 1]!.x - points[n - 2]!.x, y: 2 * points[n - 1]!.y - points[n - 2]!.y }
    return points[i]!
  }
  const out: Seg[] = [{ c: 'M', x: points[0]!.x, y: points[0]!.y }]
  const spans = closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const p2 = at(i + 1)
    const c = splineCubic(at(i - 1), at(i), p2, at(i + 2))
    out.push({ c: 'C', x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, x: p2.x, y: p2.y })
  }
  if (closed) out.push({ c: 'Z' })
  return out
}

/** The controls of the cubic that is the centripetal spline from p1 to p2, with p0 before and p3 after. */
function splineCubic(p0: Point, p1: Point, p2: Point, p3: Point): { x1: number; y1: number; x2: number; y2: number } {
  const dist = (a: Point, b: Point): number => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
  const d1 = dist(p0, p1)
  const d2 = dist(p1, p2)
  const d3 = dist(p2, p3)
  return {
    x1: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / (3 * d1 * (d1 + d2)),
    y1: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / (3 * d1 * (d1 + d2)),
    x2: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / (3 * d3 * (d3 + d2)),
    y2: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / (3 * d3 * (d3 + d2)),
  }
}

/** The factor that makes four cubics a circle. */
const KAPPA = 0.5522847498

/** An ellipse as path data: four cubics around the origin. */
export function ellipsePathData(rx: number, ry: number): Seg[] {
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return [
    { c: 'M', x: rx, y: 0 },
    { c: 'C', x1: rx, y1: ky, x2: kx, y2: ry, x: 0, y: ry },
    { c: 'C', x1: -kx, y1: ry, x2: -rx, y2: ky, x: -rx, y: 0 },
    { c: 'C', x1: -rx, y1: -ky, x2: -kx, y2: -ry, x: 0, y: -ry },
    { c: 'C', x1: kx, y1: -ry, x2: rx, y2: -ky, x: rx, y: 0 },
    { c: 'Z' },
  ]
}

/** A rectangle as path data, around the origin, with rounded corners when a radius is given. */
export function rectPathData(width: number, height: number, rx = 0, ry = rx): Seg[] {
  const w = width / 2
  const h = height / 2
  rx = Math.min(Math.abs(rx), w)
  ry = Math.min(Math.abs(ry), h)
  if (rx === 0 || ry === 0) return polygonPathData([{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }], true)
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return [
    { c: 'M', x: -w + rx, y: -h },
    { c: 'L', x: w - rx, y: -h },
    { c: 'C', x1: w - rx + kx, y1: -h, x2: w, y2: -h + ry - ky, x: w, y: -h + ry },
    { c: 'L', x: w, y: h - ry },
    { c: 'C', x1: w, y1: h - ry + ky, x2: w - rx + kx, y2: h, x: w - rx, y: h },
    { c: 'L', x: -w + rx, y: h },
    { c: 'C', x1: -w + rx - kx, y1: h, x2: -w, y2: h - ry + ky, x: -w, y: h - ry },
    { c: 'L', x: -w, y: -h + ry },
    { c: 'C', x1: -w, y1: -h + ry - ky, x2: -w + rx - kx, y2: -h, x: -w + rx, y: -h },
    { c: 'Z' },
  ]
}

/** Whether a value is path data with something in it: a string with a command and a number. */
export function hasPathData(d: unknown): d is string {
  return typeof d === 'string' && /[MmLlCcQqAaHhVvSsTt]/.test(d) && /\d/.test(d)
}
