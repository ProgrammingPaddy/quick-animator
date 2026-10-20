import { ellipsePathData, flipPathData, isPolyline, parsePathData, pathDataBounds, polygonPathData, rectPathData, scalePathData, serializePathData, transformPathData, translatePathData, type Matrix, type Point, type Seg } from '../model/pathData'
import type { AttrValue } from '../model/registry'
import { nameProblem } from '../model/rename'

/**
 * An SVG file read as objects (D241): its elements become Rects, Circles, Texts, and Shapes,
 * its groups Groups, with every transform folded into positions, rotations, and geometry,
 * fills and strokes kept, and ids as names. The browser's own SVG engine does the reading: the
 * document is mounted out of sight, so computed styles, matrices, and text boxes come from it.
 * What SVG has and this has not is dropped and named.
 */

export interface ImportedObject {
  kind: 'object'
  name: string
  className: 'Rect' | 'Circle' | 'Text' | 'Shape'
  /** The attributes to write; `x` and `y` are against the drawing's center, in the scene's coordinates, y up. */
  attrs: Record<string, AttrValue>
}

export interface ImportedGroup {
  kind: 'group'
  name: string
  members: ImportedItem[]
}

export type ImportedItem = ImportedObject | ImportedGroup

export interface SvgImport {
  /** The file's content in drawing order, centered on the origin: one group when it holds several things. */
  items: ImportedItem[]
  /** What SVG has and this has not, dropped: a word for each kind. */
  dropped: string[]
  /** The drawing's size in its own units, one unit a pixel. */
  width: number
  height: number
}

/** Imported things scaled about the drawing's center by a factor: places, sizes, strokes, text, points, and curves alike. */
export function scaleImported(items: ImportedItem[], k: number): ImportedItem[] {
  const num = (v: AttrValue | undefined): v is number => typeof v === 'number'
  return items.map((item) => {
    if (item.kind === 'group') return { ...item, members: scaleImported(item.members, k) }
    const attrs = { ...item.attrs }
    for (const key of ['x', 'y', 'width', 'height', 'radius', 'fontSize', 'strokeWidth']) {
      const v = attrs[key]
      if (num(v)) attrs[key] = round2(v * k)
    }
    if (Array.isArray(attrs['points'])) attrs['points'] = attrs['points'].map((p) => p.map((n) => round2(n * k)))
    if (typeof attrs['curves'] === 'string') attrs['curves'] = serializePathData(scalePathData(parsePathData(attrs['curves']), { x: 0, y: 0 }, k, k))
    return { ...item, attrs }
  })
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Elements that draw nothing themselves and are never walked into. */
const SKIPPED = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'script', 'symbol', 'marker', 'pattern', 'mask', 'clippath', 'lineargradient', 'radialgradient', 'filter', 'font', 'font-face', 'view', 'cursor', 'tspan', 'textpath'])
/** Elements this cannot draw, named when dropped. */
const UNSUPPORTED = new Set(['image', 'foreignobject', 'video', 'audio', 'iframe', 'canvas'])

const round2 = (n: number): number => Math.round(n * 100) / 100

/** A length attribute as a number of user units; units other than pixels are converted at 96 dpi, and a percentage gives nothing. */
function lengthOf(text: string | null): number | null {
  if (!text) return null
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const units: Record<string, number> = { '': 1, px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 }
  const k = units[m[2]!.toLowerCase()]
  return k === undefined ? null : n * k
}

function toMatrix(m: DOMMatrix): Matrix {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f }
}

function apply(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

/** A computed paint: its color as #rrggbb with its alpha, none, or a paint server, whose first stop stands in for it. */
function paintOf(value: string, root: SVGSVGElement, dropped: Set<string>): { color: string | null; alpha: number } {
  const text = value.trim()
  if (!text || text === 'none' || text === 'transparent') return { color: null, alpha: 1 }
  const url = /^url\(["']?#([^"')]+)["']?\)/.exec(text)
  if (url) {
    const server = root.querySelector(`[id="${CSS.escape(url[1]!)}"]`)
    const stop = server?.querySelector('stop')
    const kind = server?.localName.toLowerCase().includes('gradient') ? 'gradients' : server ? server.localName.toLowerCase() : 'paint'
    dropped.add(kind)
    if (stop) {
      const color = paintOf(getComputedStyle(stop).stopColor, root, dropped)
      if (color.color) return { color: color.color, alpha: color.alpha * (Number(getComputedStyle(stop).stopOpacity) || 1) }
    }
    const rest = text.slice(url[0].length).trim()
    return rest ? paintOf(rest, root, dropped) : { color: '#888888', alpha: 1 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(text)
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]].map((c) => Math.max(0, Math.min(255, Math.round(Number(c)))).toString(16).padStart(2, '0')).join('')
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
    return { color: `#${hex}`, alpha: Number.isFinite(a) ? a : 1 }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split('').map((c) => c + c).join('') : hex[1]!
    return { color: `#${h.toLowerCase()}`, alpha: 1 }
  }
  return { color: '#888888', alpha: 1 }
}

/** An element's `points`, as a polygon or a polyline writes them. */
function pointsAttr(el: Element): Point[] {
  const numbers = (el.getAttribute('points') ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? []
  const out: Point[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push({ x: numbers[i]!, y: numbers[i + 1]! })
  return out
}

/** A valid, free name: the one wanted, an id or a file name, made a name, or else the base with a number. */
function namer(taken: ReadonlySet<string>): (wanted: string | null | undefined, base: string) => string {
  const used = new Set(taken)
  const counters = new Map<string, number>()
  return (wanted, base) => {
    const id = wanted?.trim()
    if (id) {
      let candidate = id.replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
      if (/^\d/.test(candidate)) candidate = `_${candidate}`
      if (candidate && !nameProblem(candidate, used)) {
        used.add(candidate)
        return candidate
      }
    }
    let n = counters.get(base) ?? 1
    while (used.has(`${base}${n}`) || nameProblem(`${base}${n}`, used)) n++
    counters.set(base, n + 1)
    used.add(`${base}${n}`)
    return `${base}${n}`
  }
}

/** A file name as a name: `my logo-2` is `myLogo2`; one that starts with a digit gets `svg` in front. */
function prefixOf(fileName: string): string {
  const words = fileName.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const name = words.map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1))).join('')
  if (!name) return 'drawing'
  return /^\d/.test(name) ? `svg${name}` : name
}

/**
 * Read an SVG's text as objects. `taken` is every name the scene has, so the new ones are free;
 * `fileName` names the group when the file holds several things, and prefixes every object's
 * name, `logoRect1`, so what came from where is read at a glance (D241).
 */
export function readSvg(text: string, fileName: string, taken: ReadonlySet<string>): SvgImport | { error: string } {
  const prefix = prefixOf(fileName)
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName.toLowerCase() !== 'svg') return { error: 'Not an SVG file.' }
  // Mounted out of sight, in a shadow root so the file's own styles reach nothing else: the engine resolves styles, units, transforms, and text boxes.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1'
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement
  host.attachShadow({ mode: 'open' }).appendChild(svg)
  document.body.appendChild(host)
  try {
    const vb = svg.viewBox.baseVal
    let width = vb && vb.width > 0 ? vb.width : (lengthOf(svg.getAttribute('width')) ?? 0)
    let height = vb && vb.height > 0 ? vb.height : (lengthOf(svg.getAttribute('height')) ?? 0)
    let left = vb && vb.width > 0 ? vb.x : 0
    let top = vb && vb.height > 0 ? vb.y : 0
    if (!(width > 0 && height > 0)) {
      // No size given: the box around the content is the drawing.
      svg.setAttribute('width', '4096')
      svg.setAttribute('height', '4096')
      svg.removeAttribute('viewBox')
      const box = svg.getBBox()
      width = box.width
      height = box.height
      left = box.x
      top = box.y
      if (!(width > 0 && height > 0)) return { error: 'The SVG draws nothing.' }
    }
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    const rootScreen = svg.getScreenCTM()
    if (!rootScreen) return { error: 'The SVG could not be laid out.' }
    const rootInverse = toMatrix(rootScreen.inverse())
    const origin = { x: left + width / 2, y: top + height / 2 }
    // The scene's y is up and its origin is the drawing's middle.
    const toScene = (p: Point): Point => ({ x: p.x - origin.x, y: -(p.y - origin.y) })
    const dropped = new Set<string>()
    const name = namer(taken)

    const leaf = (el: Element, tag: string, opacity: number): ImportedObject | null => {
      const screen = (el as SVGGraphicsElement).getScreenCTM()
      if (!screen) return null
      const m = multiply(rootInverse, toMatrix(screen))
      const det = m.a * m.d - m.b * m.c
      // A turn and one scale, nothing else: the object keeps a rotation of its own; anything more is folded into its geometry.
      const similar = Math.abs(m.a - m.d) < 1e-6 && Math.abs(m.b + m.c) < 1e-6 && det > 0
      const scale = similar ? Math.hypot(m.a, m.b) : Math.sqrt(Math.abs(det)) || 1
      const theta = similar ? Math.atan2(m.b, m.a) : 0
      const rotation = round2(-(theta * 180) / Math.PI * 10) / 10
      const cs = getComputedStyle(el)
      const fill = paintOf(cs.fill, svg, dropped)
      const stroke = paintOf(cs.stroke, svg, dropped)
      const strokeWidth = (Number.parseFloat(cs.strokeWidth) || 0) * scale
      const hasFill = fill.color !== null
      const hasStroke = stroke.color !== null && strokeWidth > 0
      const own = opacity * (hasFill ? (Number(cs.fillOpacity) || 1) * fill.alpha : (Number(cs.strokeOpacity) || 1) * stroke.alpha)
      const common = (): Record<string, AttrValue> => {
        const attrs: Record<string, AttrValue> = {}
        if (Math.abs(own - 1) > 0.005) attrs['opacity'] = round2(Math.max(0, Math.min(1, own)))
        if (rotation !== 0) attrs['rotation'] = rotation
        return attrs
      }
      const placed = (center: Point): { x: number; y: number } => {
        const p = toScene(center)
        return { x: Math.round(p.x), y: Math.round(p.y) }
      }
      const num = (key: string): number => {
        const length = (el as unknown as Record<string, { baseVal: { value: number } }>)[key]
        return length && typeof length.baseVal?.value === 'number' ? length.baseVal.value : (lengthOf(el.getAttribute(key)) ?? 0)
      }
      if (tag === 'text') {
        const content = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (!content || !hasFill) return null
        if (el.querySelectorAll('tspan').length > 1) dropped.add('text lines')
        const box = (el as SVGGraphicsElement).getBBox()
        const center = apply(m, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
        const font = cs.fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
        const attrs: Record<string, AttrValue> = { ...placed(center), text: content, fontSize: round2((Number.parseFloat(cs.fontSize) || 16) * scale), fill: fill.color!, ...common() }
        if (font && font !== 'Segoe UI') attrs['font'] = font
        return { kind: 'object', name: name(el.getAttribute('id'), `${prefix}Text`), className: 'Text', attrs }
      }
      if (!hasFill && !hasStroke) return null
      // A rectangle's corner radii: one given stands for both.
      const rx = el.hasAttribute('rx') ? num('rx') : el.hasAttribute('ry') ? num('ry') : 0
      const ry = el.hasAttribute('ry') ? num('ry') : rx
      // The kinds, when the element is one as they are: a turned, scaled rectangle or oval with a fill and no stroke.
      if (tag === 'rect' && similar && hasFill && !hasStroke && rx === 0 && ry === 0) {
        const w = num('width')
        const h = num('height')
        const center = apply(m, { x: num('x') + w / 2, y: num('y') + h / 2 })
        return { kind: 'object', name: name(el.getAttribute('id'), `${prefix}Rect`), className: 'Rect', attrs: { ...placed(center), width: round2(w * scale), height: round2(h * scale), fill: fill.color!, ...common() } }
      }
      if ((tag === 'circle' || tag === 'ellipse') && similar && hasFill && !hasStroke) {
        const center = apply(m, { x: num('cx'), y: num('cy') })
        const attrs: Record<string, AttrValue> = { ...placed(center) }
        if (tag === 'circle') Object.assign(attrs, { radius: round2(num('r') * scale) })
        else Object.assign(attrs, { width: round2(num('rx') * 2 * scale), height: round2(num('ry') * 2 * scale) })
        Object.assign(attrs, { fill: fill.color!, ...common() })
        if (tag === 'circle') delete attrs['rotation']
        return { kind: 'object', name: name(el.getAttribute('id'), `${prefix}Circle`), className: 'Circle', attrs }
      }
      // Everything else is a Shape: its geometry in its own units, then under the element's matrix.
      let segs: Seg[]
      if (tag === 'rect') segs = translatePathData(rectPathData(num('width'), num('height'), rx, ry), num('x') + num('width') / 2, num('y') + num('height') / 2)
      else if (tag === 'circle') segs = translatePathData(ellipsePathData(num('r'), num('r')), num('cx'), num('cy'))
      else if (tag === 'ellipse') segs = translatePathData(ellipsePathData(num('rx'), num('ry')), num('cx'), num('cy'))
      else if (tag === 'line') segs = polygonPathData([{ x: num('x1'), y: num('y1') }, { x: num('x2'), y: num('y2') }], false)
      else if (tag === 'polyline' || tag === 'polygon') segs = polygonPathData(pointsAttr(el), tag === 'polygon')
      else if (tag === 'path') segs = parsePathData(el.getAttribute('d') ?? '')
      else return null
      if (segs.length === 0) return null
      // Under a turn and a scale the scale goes into the geometry and the turn stays an attribute; under anything else the whole matrix goes in.
      const transformed = similar ? transformPathData(segs, { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }) : transformPathData(segs, m)
      const c = pathDataBounds(transformed)
      const ownSegs = flipPathData(translatePathData(transformed, -c.x, -c.y))
      const center = similar ? { x: m.e + Math.cos(theta) * c.x - Math.sin(theta) * c.y, y: m.f + Math.sin(theta) * c.x + Math.cos(theta) * c.y } : { x: c.x, y: c.y }
      const attrs: Record<string, AttrValue> = { ...placed(center) }
      const closed = ownSegs[ownSegs.length - 1]!.c === 'Z'
      // Straight lines are written as points, SVG's polygon; an open line with a fill stays a path, which fills it as SVG does.
      if (isPolyline(ownSegs) && (closed || !hasFill)) {
        const points: number[][] = []
        for (const s of ownSegs) if (s.c === 'M' || s.c === 'L') points.push([round2(s.x), round2(s.y)])
        attrs['points'] = points
        if (!closed) attrs['closed'] = false
      } else attrs['curves'] = serializePathData(ownSegs)
      attrs['fill'] = hasFill ? fill.color! : 'none'
      if (hasStroke) Object.assign(attrs, { stroke: stroke.color!, strokeWidth: round2(strokeWidth) })
      Object.assign(attrs, common())
      return { kind: 'object', name: name(el.getAttribute('id'), `${prefix}Shape`), className: 'Shape', attrs }
    }

    /** The items an element gives: a group's members, a leaf's object, a use's target in the use's place. */
    const visit = (el: Element, inherited: number): ImportedItem[] => {
      // Only SVG's own drawing elements are read: an editor's private elements and animation sit beside them and are left alone.
      if (el.namespaceURI !== SVG_NS || typeof (el as SVGGraphicsElement).getScreenCTM !== 'function') return []
      const tag = el.localName.toLowerCase()
      if (SKIPPED.has(tag)) return []
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') return []
      const opacity = inherited * (Number(cs.opacity) || 1)
      if (tag === 'g' || tag === 'a' || tag === 'svg' || tag === 'switch') {
        const members = Array.from(el.children).flatMap((child) => visit(child, opacity))
        if (members.length >= 2) return [{ kind: 'group', name: name(el.getAttribute('id'), `${prefix}Group`), members }]
        return members
      }
      if (tag === 'use') {
        const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        const target = href?.startsWith('#') ? svg.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) : null
        if (!target || (target.localName.toLowerCase() === 'symbol' && target.hasAttribute('viewBox'))) {
          dropped.add('use')
          return []
        }
        // The target drawn where the use is: a copy in a group with the use's transform, offset, and styles.
        const g = document.createElementNS(SVG_NS, 'g')
        for (const attr of Array.from(el.attributes)) if (!['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id', 'transform'].includes(attr.name)) g.setAttribute(attr.name, attr.value)
        g.setAttribute('transform', `${el.getAttribute('transform') ?? ''} translate(${lengthOf(el.getAttribute('x')) ?? 0} ${lengthOf(el.getAttribute('y')) ?? 0})`)
        const copy = target.cloneNode(true) as Element
        copy.removeAttribute('id')
        if (target.localName.toLowerCase() === 'symbol') {
          const inner = document.createElementNS(SVG_NS, 'g')
          for (const child of Array.from(copy.childNodes)) inner.appendChild(child)
          g.appendChild(inner)
        } else g.appendChild(copy)
        el.parentNode!.insertBefore(g, el)
        try {
          const items = visit(g, inherited)
          const only = items.length === 1 && items[0]!.kind === 'group' ? items[0]!.members : items
          return only.length >= 2 ? [{ kind: 'group', name: name(el.getAttribute('id'), `${prefix}Group`), members: only }] : only
        } finally {
          g.remove()
        }
      }
      if (UNSUPPORTED.has(tag)) {
        dropped.add(tag === 'foreignobject' ? 'foreign objects' : `${tag}s`)
        return []
      }
      try {
        const object = leaf(el, tag, opacity)
        return object ? [object] : []
      } catch {
        dropped.add(`a ${tag} that could not be read`)
        return []
      }
    }

    for (const key of ['filter', 'clipPath', 'mask']) if (svg.querySelector(`[${key}]`) || svg.querySelector(`[style*="${key}"]`)) dropped.add(key === 'clipPath' ? 'clipping' : key === 'mask' ? 'masks' : 'filters')
    const items = Array.from(svg.children).flatMap((child) => visit(child, Number(getComputedStyle(svg).opacity) || 1))
    const grouped = items.length >= 2 ? [{ kind: 'group' as const, name: name(prefix, prefix), members: items }] : items
    return { items: grouped, dropped: [...dropped], width, height }
  } finally {
    host.remove()
  }
}
