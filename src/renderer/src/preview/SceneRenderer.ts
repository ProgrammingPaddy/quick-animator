import * as THREE from 'three'
import { groupMembers } from '../model/groups'
import { CAMERA, GROUP } from '../model/registry'
import { maskDrawnBy, maskFor, masksOn } from '../model/masks'
import { hasPathData } from '../model/pathData'
import { cameraAt, camerasOf, containers, existsAt, groupBox, isAttached, opacityAt, parseColor, shapePieces, textPadding, textStyleAt, textUnitStates, valueAt, viewAt, viewOf, worldPose, type Pose, type ShapePiece } from '../model/sample'
import { SHAPE } from '../model/registry'
import { drawText, estimateMeasure, fontSpec, layoutOf, sameUnitStates, textMeasure, unitOverflow, type TextMeasure, type TextStyle, type UnitState } from '../model/text'
import { fontsVersion } from '../project/fonts'
import type { Mask, SceneModel, SceneObject } from '../model/types'
import type { TransformMode } from '../state/store'

interface Item {
  mesh: THREE.Mesh
  className: string
  /** Unscaled size in world pixels, for the selection box. */
  width: number
  height: number
  textKey?: string
  /** A Text's canvas, kept and redrawn, and how much of the world its picture covers, which grows past the block as animated characters reach out (D268). */
  textCanvas?: HTMLCanvasElement
  drawn?: { width: number; height: number }
  /** The characters' states the canvas was last drawn in, so a frame that leaves them as they are draws nothing. */
  drawnStates?: UnitState[] | null
  /** A Shape's stroke, its own mesh; the box around its line in its own space, its center offset from the object's x and y; and what its geometry was built from (D232). */
  stroke?: THREE.Mesh
  bounds?: { x: number; y: number; width: number; height: number }
  shapeKey?: string
}

/** A grab point of the selection gizmo: a corner or edge that resizes, or the handle that rotates (D86). */
export type Handle = { kind: 'resize'; sx: -1 | 0 | 1; sy: -1 | 0 | 1 } | { kind: 'rotate' }

/** Where something is drawn right now: center, rotation in degrees, and drawn size in world pixels. */
export interface Frame {
  x: number
  y: number
  rotation: number
  width: number
  height: number
}

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}


const unitPlane = new THREE.PlaneGeometry(1, 1)
// Both unit shapes are one world pixel across, so an object's drawn size is its scale.
const unitCircle = new THREE.CircleGeometry(0.5, 96)
/** Canvas pixels per world pixel for text, so it stays crisp when zoomed in. */
const TEXT_SCALE = 2
/** The most a Text is drawn closer for a camera that zooms in on it, and the longest side its canvas may have, in pixels (D357). */
const TEXT_SHARP_MAX = 8
const TEXT_CANVAS_MAX = 8192

/** One white pixel: what a material multiplies by while no mask hides its object. */
const UNMASKED = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
UNMASKED.needsUpdate = true

/**
 * An object's material, made to multiply its alpha by a mask picture read at the pixel being
 * drawn (D337): one white pixel while nothing hides the object, else the picture of the masks
 * that do. `size` is the size of what is drawn into, in pixels, shared by a renderer's materials.
 */
function maskable(material: THREE.MeshBasicMaterial, size: { value: THREE.Vector2 }): THREE.MeshBasicMaterial {
  const picture = { value: UNMASKED as THREE.Texture }
  material.userData['mask'] = picture
  material.onBeforeCompile = (shader) => {
    shader.uniforms['maskPicture'] = picture
    shader.uniforms['maskSize'] = size
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform sampler2D maskPicture;\nuniform vec2 maskSize;\nvoid main() {')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.a *= texture2D( maskPicture, gl_FragCoord.xy / maskSize ).a;')
  }
  return material
}

/** The mask picture a mesh's material reads. */
function pictureOf(mesh: THREE.Mesh): { value: THREE.Texture } {
  return (mesh.material as THREE.Material).userData['mask'] as { value: THREE.Texture }
}

/** The meshes of an item that draw right now. */
function drawing(item: Item): THREE.Mesh[] {
  return [...(item.mesh.visible ? [item.mesh] : []), ...(item.stroke?.visible ? [item.stroke] : [])]
}

const screenQuad = new THREE.PlaneGeometry(2, 2)
const SCREEN_VERTEX = 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }'

/** Multiplies what is drawn so far by a mask's picture, or by what the picture leaves out when the mask is inverted: several masks on one object become one picture (D332). */
const joinMaterial = new THREE.ShaderMaterial({
  uniforms: { map: { value: null as THREE.Texture | null }, size: { value: new THREE.Vector2(1, 1) }, inverted: { value: 0 } },
  vertexShader: SCREEN_VERTEX,
  fragmentShader: 'uniform sampler2D map; uniform vec2 size; uniform float inverted; void main() { float a = texture2D( map, gl_FragCoord.xy / size ).a; gl_FragColor = vec4( mix( a, 1.0 - a, inverted ) ); }',
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.SrcColorFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.SrcAlphaFactor,
  depthTest: false,
  depthWrite: false,
})
const joinQuad = new THREE.Mesh(screenQuad, joinMaterial)
joinQuad.frustumCulled = false
const screenCamera = new THREE.Camera()

/** The color of a mask's edge in the view, and of its marks in the panes (D334). */
const MASK_EDGE = 0x22d3ee
/** How far past a mask's box its edge is drawn, in pixels of the drawing: the line and its rim. */
const EDGE_MARGIN = 5

/** A line where a mask's picture begins and ends, with a dark rim so it shows on any color: drawn over the mask's box, read from the picture at each pixel. */
const EDGE_FRAGMENT = `uniform sampler2D map; uniform vec2 size; uniform float ratio; uniform float strength; uniform vec3 color;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  float lo = 1.0; float hi = 0.0; float lo2 = 1.0; float hi2 = 0.0;
  for ( int i = 0; i < 8; i ++ ) {
    float t = float( i ) * 0.7853981634;
    vec2 d = vec2( cos( t ), sin( t ) ) * ratio / size;
    float a = texture2D( map, uv + d ).a;
    float b = texture2D( map, uv + d * 2.5 ).a;
    lo = min( lo, a ); hi = max( hi, a ); lo2 = min( lo2, b ); hi2 = max( hi2, b );
  }
  float line = smoothstep( 0.02, 0.25, hi - lo );
  float rim = smoothstep( 0.02, 0.25, hi2 - lo2 );
  if ( max( line, rim ) <= 0.0 ) discard;
  gl_FragColor = vec4( mix( vec3( 0.067 ), color, line ), max( line, rim * 0.85 ) * strength );
}`

let measuringContext: CanvasRenderingContext2D | null = null

/** A run of text measured on a canvas with the style's font (D267): its advance, with the letter spacing, and the font's ascent and descent at the size. The sampler, the preset card, and the drawing all go by this. */
function canvasMeasure(text: string, style: TextStyle): TextMeasure {
  if (!measuringContext) measuringContext = document.createElement('canvas').getContext('2d')
  const estimate = estimateMeasure(text, style)
  if (!measuringContext) return estimate
  const ctx = measuringContext as CanvasRenderingContext2D & { letterSpacing?: string }
  ctx.font = fontSpec(style)
  ctx.fontKerning = 'normal'
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${style.letterSpacing}px`
  const m = ctx.measureText(text)
  // The font's own ascent and descent, so every line of a text has one height whatever it says.
  return { width: m.width, ascent: m.fontBoundingBoxAscent || estimate.ascent, descent: m.fontBoundingBoxDescent || estimate.descent }
}
textMeasure.current = canvasMeasure
const RESIZE_HANDLES: { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }[] = [
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: -1, sy: 1 },
  { sx: 1, sy: 1 },
  { sx: 0, sy: -1 },
  { sx: 0, sy: 1 },
  { sx: -1, sy: 0 },
  { sx: 1, sy: 0 },
]
/** Distance of the rotate handle above the top edge, in screen pixels. */
const ROTATE_OFFSET = 24
const CORNER_PX = 9
const EDGE_PX = 7
const ROTATE_PX = 11
const PIVOT_PX = 14
/** The diamond on an anchored object (D161). */
const ANCHOR_PX = 8
/** The selection is drawn in white with a dark rim, so it shows on any color (D94). */
const LIGHT = 0xffffff
const DARK = 0x111111
/** Gizmo render order: after every object, which are all drawn in the transparent pass. */
const ORDER = 1_000_000
/** Screen pixels: the white line, and the dark rim added on each side. */
const LINE_PX = 1.5
const RIM_PX = 1

// The gizmo materials are transparent so Three.js draws them with, and after, the objects: an
// opaque material would be drawn first and then painted over by any object (D94).
const lightMaterial = new THREE.MeshBasicMaterial({ color: LIGHT, depthTest: false, transparent: true })
const darkMaterial = new THREE.MeshBasicMaterial({ color: DARK, depthTest: false, transparent: true })
const ringMaterial = new THREE.LineBasicMaterial({ color: LIGHT, depthTest: false, transparent: true })

/** A rectangle outline of eight thin quads: four dark beneath, four white on top, in a group that carries position and rotation. */
class Outline {
  readonly group = new THREE.Group()
  private readonly dark: THREE.Mesh[] = []
  private readonly light: THREE.Mesh[] = []

  constructor() {
    for (let i = 0; i < 4; i++) {
      const dark = new THREE.Mesh(unitPlane, darkMaterial)
      dark.renderOrder = ORDER
      const light = new THREE.Mesh(unitPlane, lightMaterial)
      light.renderOrder = ORDER + 1
      this.dark.push(dark)
      this.light.push(light)
      this.group.add(dark, light)
    }
    this.group.visible = false
  }

  set(frame: Frame, pixel: number): void {
    this.group.visible = true
    this.group.position.set(frame.x, frame.y, 0)
    this.group.rotation.z = (frame.rotation * Math.PI) / 180
    const w = frame.width
    const h = frame.height
    const line = LINE_PX * pixel
    const rim = line + RIM_PX * 2 * pixel
    const sides: [number, number, number, number][] = [
      [0, h / 2, w, 0],
      [0, -h / 2, w, 0],
      [-w / 2, 0, 0, h],
      [w / 2, 0, 0, h],
    ]
    sides.forEach(([x, y, lengthX, lengthY], i) => {
      const dark = this.dark[i]!
      const light = this.light[i]!
      dark.position.set(x, y, 0.5)
      light.position.set(x, y, 0.6)
      dark.scale.set(lengthX > 0 ? lengthX + rim : rim, lengthY > 0 ? lengthY + rim : rim, 1)
      light.scale.set(lengthX > 0 ? lengthX + line : line, lengthY > 0 ? lengthY + line : line, 1)
    })
  }

  hide(): void {
    this.group.visible = false
  }
}

/** A handle: a white shape over a slightly larger dark one. */
class Marker {
  readonly group = new THREE.Group()
  private readonly dark: THREE.Mesh
  private readonly light: THREE.Mesh

  constructor(geometry: THREE.BufferGeometry) {
    this.dark = new THREE.Mesh(geometry, darkMaterial)
    this.dark.renderOrder = ORDER + 2
    this.light = new THREE.Mesh(geometry, lightMaterial)
    this.light.renderOrder = ORDER + 3
    this.group.add(this.dark, this.light)
    this.group.visible = false
  }

  set(x: number, y: number, rotation: number, size: number, pixel: number): void {
    this.group.visible = true
    this.group.position.set(x, y, 0.7)
    this.group.rotation.z = rotation
    this.dark.scale.set(size + RIM_PX * 2 * pixel, size + RIM_PX * 2 * pixel, 1)
    this.light.scale.set(size, size, 1)
  }

  hide(): void {
    this.group.visible = false
  }
}

/** A thin x of two strokes, white with a dark rim: the mark of a group's anchor (D124). */
class Cross {
  readonly group = new THREE.Group()
  private readonly dark: THREE.Mesh[] = []
  private readonly light: THREE.Mesh[] = []

  constructor() {
    for (let i = 0; i < 2; i++) {
      const dark = new THREE.Mesh(unitPlane, darkMaterial)
      dark.renderOrder = ORDER + 4
      dark.rotation.z = (Math.PI / 4) * (i === 0 ? 1 : -1)
      const light = new THREE.Mesh(unitPlane, lightMaterial)
      light.renderOrder = ORDER + 5
      light.rotation.z = dark.rotation.z
      this.dark.push(dark)
      this.light.push(light)
      this.group.add(dark, light)
    }
    this.group.visible = false
  }

  set(x: number, y: number, length: number, pixel: number): void {
    this.group.visible = true
    this.group.position.set(x, y, 0.8)
    const line = LINE_PX * pixel
    const rim = line + RIM_PX * 2 * pixel
    for (let i = 0; i < 2; i++) {
      this.dark[i]!.scale.set(length + rim, rim, 1)
      this.light[i]!.scale.set(length, line, 1)
    }
  }

  hide(): void {
    this.group.visible = false
  }
}

const guideMaterial = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true })
const pathMaterial = new THREE.MeshBasicMaterial({ color: 0x86efac, depthTest: false, transparent: true, opacity: 0.9 })

/** A handle on each point of an editable path, the one last placed or picked a little larger (D194). */
const POINT_PX = 7
const ACTIVE_POINT_PX = 10
/** A curve's control, a small round handle (D240). */
const CONTROL_PX = 7

/** How long a dash and a gap are, in pixels, on the line of a path whose shape is code (D226). */
const DASH_PX = 9
const GAP_PX = 5

/** A polyline cut into dashes by distance along it: the pieces to draw. */
function dashes(points: { x: number; y: number }[], on: number, off: number): [{ x: number; y: number }, { x: number; y: number }][] {
  const out: [{ x: number; y: number }, { x: number; y: number }][] = []
  let drawing = true
  let phase = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    const at = (t: number) => ({ x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length })
    let t = 0
    while (t < length) {
      const span = drawing ? on : off
      const step = Math.min(span - phase, length - t)
      if (drawing) out.push([at(t), at(t + step)])
      t += step
      phase += step
      if (phase >= span - 1e-9) {
        drawing = !drawing
        phase = 0
      }
    }
  }
  return out
}

/** A share, 0 to 1, from a value that may be anything; 1 when it is not a number. */
function unitOpacity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
}

/** The first share of a line, by length across its pieces (D298): what is drawn of it so far. */
function drawnCurves(curves: { x: number; y: number }[][], fraction: number): { x: number; y: number }[][] {
  let total = 0
  for (const curve of curves) for (let i = 0; i + 1 < curve.length; i++) total += Math.hypot(curve[i + 1]!.x - curve[i]!.x, curve[i + 1]!.y - curve[i]!.y)
  // A dot has no length to draw along (D311): it is there as soon as any of it is.
  if (total < 1e-9) return fraction > 0 ? curves : []
  let left = total * fraction
  const out: { x: number; y: number }[][] = []
  for (const curve of curves) {
    if (left <= 0 || curve.length < 2) break
    const piece = [curve[0]!]
    for (let i = 0; i + 1 < curve.length; i++) {
      const a = curve[i]!
      const b = curve[i + 1]!
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length <= left) {
        piece.push(b)
        left -= length
        continue
      }
      const t = length > 1e-9 ? left / length : 0
      piece.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      left = 0
      break
    }
    out.push(piece)
  }
  return out
}

/**
 * A Shape's stroke as triangles (D232, D317): a band along the line with nothing covered twice,
 * so a see-through line is even and its edge has no notch. At a turn the inner edges meet in one
 * point and the outer edge goes round the line's own point; an open line ends in half circles; a
 * line of no length is a dot (D311). A turn too sharp for its pieces to meet within them keeps
 * square ends and a round over the gap.
 */
function strokeGeometry(curves: { x: number; y: number }[][], width: number): THREE.BufferGeometry {
  type P = { x: number; y: number }
  const positions: number[] = []
  const half = width / 2
  const tri = (a: P, b: P, c: P) => positions.push(a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0)
  const on = (p: P, angle: number, r = half): P => ({ x: p.x + r * Math.cos(angle), y: p.y + r * Math.sin(angle) })
  /** A fan from `hub` over the arc around `p`, from an angle through a sweep, in steps fine enough to look round. */
  const fan = (hub: P, p: P, from: number, sweep: number) => {
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 18)))
    for (let k = 0; k < steps; k++) tri(hub, on(p, from + (sweep * k) / steps), on(p, from + (sweep * (k + 1)) / steps))
  }
  for (const curve of curves) {
    if (curve.length < 2) continue
    // A point that repeats the one before adds nothing to the line.
    const pts = curve.filter((p, i) => i === 0 || Math.hypot(p.x - curve[i - 1]!.x, p.y - curve[i - 1]!.y) > 1e-9)
    if (pts.length < 2) {
      fan(pts[0]!, pts[0]!, 0, 2 * Math.PI)
      continue
    }
    const closed = pts.length > 3 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) <= 1e-9
    const ring = closed ? pts.slice(0, -1) : pts
    const n = ring.length
    const count = closed ? n : n - 1
    const angle: number[] = []
    const length: number[] = []
    for (let s = 0; s < count; s++) {
      const a = ring[s]!
      const b = ring[(s + 1) % n]!
      angle.push(Math.atan2(b.y - a.y, b.x - a.x))
      length.push(Math.hypot(b.x - a.x, b.y - a.y))
    }
    // The band's two edges at each point: where the piece arriving ends, and where the piece leaving begins.
    const ends: { lin: P; rin: P; lout: P; rout: P }[] = []
    for (let i = 0; i < n; i++) {
      const p = ring[i]!
      const sIn = closed ? (i - 1 + n) % n : i - 1
      const sOut = closed || i < count ? i : -1
      const aIn = angle[sIn >= 0 ? sIn : sOut]!
      const aOut = sOut >= 0 ? angle[sOut]! : aIn
      const square = { lin: on(p, aIn + Math.PI / 2), rin: on(p, aIn - Math.PI / 2), lout: on(p, aOut + Math.PI / 2), rout: on(p, aOut - Math.PI / 2) }
      ends.push(square)
      // An open line's ends: a half circle behind the first piece and one ahead of the last.
      if (sIn < 0) {
        fan(p, p, aOut + Math.PI / 2, Math.PI)
        continue
      }
      if (sOut < 0) {
        fan(p, p, aIn - Math.PI / 2, Math.PI)
        continue
      }
      let turn = aOut - aIn
      while (turn > Math.PI) turn -= 2 * Math.PI
      while (turn <= -Math.PI) turn += 2 * Math.PI
      if (Math.abs(turn) < 1e-9) continue
      // A left turn opens on the line's right and closes on its left; a right turn the other way.
      const outer = turn > 0 ? -Math.PI / 2 : Math.PI / 2
      if (half * Math.tan(Math.abs(turn) / 2) > Math.min(length[sIn]!, length[sOut]!) / 2) {
        fan(p, p, aIn + outer, turn)
        continue
      }
      const inner = on(p, aIn - outer + turn / 2, half / Math.cos(turn / 2))
      fan(inner, p, aIn + outer, turn)
      ends[i] = turn > 0 ? { lin: inner, lout: inner, rin: square.rin, rout: square.rout } : { rin: inner, rout: inner, lin: square.lin, lout: square.lout }
    }
    for (let s = 0; s < count; s++) {
      const a = ends[s]!
      const b = ends[(s + 1) % n]!
      tri(a.lout, a.rout, b.rin)
      tri(a.lout, b.rin, b.lin)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

/** A Shape's fill as triangles: every filled piece, one inside another cut out as a hole, as SVG fills a path (D238). */
function fillGeometry(pieces: ShapePiece[]): THREE.BufferGeometry {
  const path = new THREE.ShapePath()
  let any = false
  for (const piece of pieces) {
    if (!piece.filled) continue
    const ring = piece.closed ? piece.curve.slice(0, -1) : piece.curve
    if (ring.length < 3) continue
    path.moveTo(ring[0]!.x, ring[0]!.y)
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i]!.x, ring[i]!.y)
    any = true
  }
  if (!any) return new THREE.BufferGeometry()
  return new THREE.ShapeGeometry(path.toShapes())
}

/** A control of a curve's anchor, shown as a handle: where the anchor is and where the control is (D240). */
export interface ControlHandle {
  anchor: { x: number; y: number }
  point: { x: number; y: number }
}

/** The controls of picked anchors, each a small round handle on a thin stem from its anchor (D240, D246). */
class Controls {
  readonly group = new THREE.Group()
  private readonly marks: Marker[] = []
  private readonly stems: THREE.Mesh[] = []

  set(handles: ControlHandle[], pixel: number): void {
    this.group.visible = handles.length > 0
    while (this.marks.length < handles.length) {
      const mark = new Marker(unitCircle)
      this.group.add(mark.group)
      this.marks.push(mark)
      const stem = new THREE.Mesh(unitPlane, lightMaterial)
      stem.renderOrder = ORDER + 1
      this.group.add(stem)
      this.stems.push(stem)
    }
    this.marks.forEach((mark, i) => {
      const h = handles[i]
      const stem = this.stems[i]!
      stem.visible = !!h
      if (!h) {
        mark.hide()
        return
      }
      mark.set(h.point.x, h.point.y, 0, CONTROL_PX * pixel, pixel)
      const length = Math.hypot(h.point.x - h.anchor.x, h.point.y - h.anchor.y)
      stem.position.set((h.anchor.x + h.point.x) / 2, (h.anchor.y + h.point.y) / 2, 0.65)
      stem.rotation.z = Math.atan2(h.point.y - h.anchor.y, h.point.x - h.anchor.x)
      stem.scale.set(length, LINE_PX * pixel, 1)
    })
  }

  count(): number {
    return this.marks.filter((m) => m.group.visible).length
  }
}

/** The marks of a path's anchors: a square for a corner or a straight point, a round one for a smooth point, whose controls move together (D252); the picked ones larger. */
class AnchorMarks {
  readonly group = new THREE.Group()
  private readonly squares: Marker[] = []
  private readonly rounds: Marker[] = []

  set(points: { x: number; y: number }[], pixel: number, active: number[], round: boolean[]): void {
    while (this.squares.length < points.length) {
      const square = new Marker(unitPlane)
      const circle = new Marker(unitCircle)
      this.group.add(square.group, circle.group)
      this.squares.push(square)
      this.rounds.push(circle)
    }
    this.squares.forEach((square, i) => {
      const p = points[i]
      const circle = this.rounds[i]!
      if (!p) {
        square.hide()
        circle.hide()
        return
      }
      const size = (active.includes(i) ? ACTIVE_POINT_PX : POINT_PX) * pixel
      if (round[i]) {
        circle.set(p.x, p.y, 0, size * 1.15, pixel)
        square.hide()
      } else {
        square.set(p.x, p.y, 0, size, pixel)
        circle.hide()
      }
    })
  }

  count(): number {
    return this.squares.filter((m) => m.group.visible).length + this.rounds.filter((m) => m.group.visible).length
  }

  roundCount(): number {
    return this.rounds.filter((m) => m.group.visible).length
  }
}

/** The points of a selected Shape as handles, the picked ones larger (D233), and the controls of the picked anchors of a path shape (D240). */
class ShapeHandles {
  readonly group = new THREE.Group()
  private readonly marks = new AnchorMarks()
  private readonly controls = new Controls()

  constructor() {
    this.group.add(this.marks.group, this.controls.group)
  }

  set(points: { x: number; y: number }[], pixel: number, active: number[], handles: ControlHandle[] = [], round: boolean[] = []): void {
    this.group.visible = true
    this.marks.set(points, pixel, active, round)
    this.controls.set(handles, pixel)
  }

  count(): number {
    return this.group.visible ? this.marks.count() : 0
  }

  roundCount(): number {
    return this.group.visible ? this.marks.roundCount() : 0
  }

  controlCount(): number {
    return this.group.visible ? this.controls.count() : 0
  }

  hide(): void {
    this.group.visible = false
  }
}

/** The line of a selected path, its start as a dot and its end as a diamond (D192), and a handle on each point when the points can be edited (D194); dashed when the shape is code and has no points to edit (D226). */
class PathLine {
  readonly group = new THREE.Group()
  private readonly segments: THREE.Mesh[] = []
  private readonly start = new THREE.Mesh(unitCircle, pathMaterial)
  private readonly end = new THREE.Mesh(unitPlane, pathMaterial)
  private readonly anchors = new AnchorMarks()
  private readonly controls = new Controls()

  constructor() {
    this.start.renderOrder = ORDER + 7
    this.end.renderOrder = ORDER + 7
    this.end.rotation.z = Math.PI / 4
    this.group.add(this.start, this.end, this.anchors.group, this.controls.group)
    this.group.visible = false
  }

  set(points: { x: number; y: number }[], pixel: number, anchors: { x: number; y: number }[] | null = null, active: number[] = [], dashed = false, handles: ControlHandle[] = [], round: boolean[] = []): void {
    if (points.length === 0) {
      this.group.visible = false
      return
    }
    this.group.visible = true
    // The controls of the picked anchors of a curves path (D246), and a round mark on each smooth anchor (D252).
    this.controls.set(handles, pixel)
    this.anchors.set(anchors ?? [], pixel, active, round)
    const pieces = dashed ? dashes(points, DASH_PX * pixel, GAP_PX * pixel) : points.slice(1).map((b, i) => [points[i]!, b] as [{ x: number; y: number }, { x: number; y: number }])
    while (this.segments.length < pieces.length) {
      const mesh = new THREE.Mesh(unitPlane, pathMaterial)
      mesh.renderOrder = ORDER + 6
      this.group.add(mesh)
      this.segments.push(mesh)
    }
    this.segments.forEach((mesh, i) => {
      const piece = pieces[i]
      mesh.visible = !!piece
      if (!piece) return
      const [a, b] = piece
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.85)
      mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x)
      mesh.scale.set(length, LINE_PX * 1.5 * pixel, 1)
    })
    const first = points[0]!
    const last = points[points.length - 1]!
    this.start.position.set(first.x, first.y, 0.86)
    this.start.scale.set(8 * pixel, 8 * pixel, 1)
    this.end.position.set(last.x, last.y, 0.86)
    this.end.scale.set(8 * pixel, 8 * pixel, 1)
  }

  count(): number {
    return this.group.visible ? this.segments.filter((m) => m.visible).length : 0
  }

  controlCount(): number {
    return this.group.visible ? this.controls.count() : 0
  }

  hide(): void {
    this.group.visible = false
  }
}

/** Thin lines across the view where a dragged box has snapped to an edge or a center (D135). */
class Guides {
  readonly group = new THREE.Group()
  private readonly meshes: THREE.Mesh[] = []

  set(lines: GuideLine[], view: { left: number; right: number; top: number; bottom: number }, pixel: number): void {
    while (this.meshes.length < lines.length) {
      const mesh = new THREE.Mesh(unitPlane, guideMaterial)
      mesh.renderOrder = ORDER + 6
      this.group.add(mesh)
      this.meshes.push(mesh)
    }
    this.meshes.forEach((mesh, i) => {
      const line = lines[i]
      mesh.visible = !!line
      if (!line) return
      if (line.x !== undefined) {
        mesh.position.set(line.x, (view.top + view.bottom) / 2, 0.9)
        mesh.scale.set(LINE_PX * pixel, view.top - view.bottom, 1)
      } else {
        mesh.position.set((view.left + view.right) / 2, line.y ?? 0, 0.9)
        mesh.scale.set(view.right - view.left, LINE_PX * pixel, 1)
      }
    })
  }

  count(): number {
    return this.meshes.filter((m) => m.visible).length
  }

  hide(): void {
    for (const mesh of this.meshes) mesh.visible = false
  }
}

/** A vertical line at x, or a horizontal one at y, in world coordinates. */
export interface GuideLine {
  x?: number
  y?: number
}

function ringGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

const cameraLineMaterial = new THREE.MeshBasicMaterial({ color: 0x9a9a9a, depthTest: false, transparent: true, opacity: 0.85 })
/** The color of the camera that has the picture, wherever it is marked (D358). */
const cameraLiveMaterial = new THREE.MeshBasicMaterial({ color: 0xeab308, depthTest: false, transparent: true, opacity: 0.95 })

/** The frame of a camera that is alive, over the scene, so it shows whatever is drawn under it (D361): a solid lit line for the one that has the picture, a dashed one for the others. */
class FrameLine {
  readonly group = new THREE.Group()
  private readonly segments: THREE.Mesh[] = []

  set(frame: Frame, pixel: number, live: boolean): void {
    this.group.visible = true
    this.group.position.set(frame.x, frame.y, 0)
    this.group.rotation.z = (frame.rotation * Math.PI) / 180
    const w = frame.width / 2
    const h = frame.height / 2
    const corners = [
      { x: -w, y: h },
      { x: w, y: h },
      { x: w, y: -h },
      { x: -w, y: -h },
      { x: -w, y: h },
    ]
    const pieces = live ? corners.slice(1).map((b, i) => [corners[i]!, b] as [{ x: number; y: number }, { x: number; y: number }]) : dashes(corners, DASH_PX * pixel, GAP_PX * pixel)
    while (this.segments.length < pieces.length) {
      const mesh = new THREE.Mesh(unitPlane, cameraLineMaterial)
      mesh.renderOrder = ORDER - 2
      this.group.add(mesh)
      this.segments.push(mesh)
    }
    this.segments.forEach((mesh, i) => {
      const piece = pieces[i]
      mesh.visible = !!piece
      if (!piece) return
      const [a, b] = piece
      mesh.material = live ? cameraLiveMaterial : cameraLineMaterial
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.45)
      mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x)
      // A solid side runs a line's width past its corners, so they meet square.
      mesh.scale.set(Math.hypot(b.x - a.x, b.y - a.y) + (live ? LINE_PX * pixel : 0), LINE_PX * pixel, 1)
    })
  }

  hide(): void {
    this.group.visible = false
  }
}

/** Draws the scene model at a time into a Three.js group, draws the selection gizmo above it, and picks. */
export class SceneRenderer {
  readonly group = new THREE.Group()
  /** Everything drawn over the scene for the one working on it, the selection, the handles, the guides, the paths, the edges of masks, the frames of cameras: kept apart, so the scene can be drawn without it (D360). */
  private readonly overlay = new THREE.Group()
  /** The project's size, which a camera's frame is cut from (D357). */
  private composition = { width: 1920, height: 1080 }
  /** The frames of the cameras alive right now, by name, and which of them has the picture (D358). */
  private readonly cameraFrames = new Map<string, Frame>()
  private liveCamera: string | null = null
  private readonly cameraLines: FrameLine[] = []
  /** What was last asked to be drawn over the scene, kept so it can be laid out again in another view's pixels (D366): the selected path, the other paths, a Shape's handles, and the guides. */
  private pathSpec: { points: { x: number; y: number }[] | null; anchors: { x: number; y: number }[] | null; active: number[]; dashed: boolean; handles: ControlHandle[]; round: boolean[] } = { points: null, anchors: null, active: [], dashed: false, handles: [], round: [] }
  private otherSpec: { points: { x: number; y: number }[]; dashed: boolean }[] = []
  private shapeSpec: { points: { x: number; y: number }[] | null; active: number[]; handles: ControlHandle[]; round: boolean[] } = { points: null, active: [], handles: [], round: [] }
  private guideSpec: { lines: GuideLine[]; view: { left: number; right: number; top: number; bottom: number } } | null = null
  private readonly items = new Map<string, Item>()
  private readonly outlines: Outline[] = []
  private readonly gizmoOutline = new Outline()
  private readonly rotateRing: THREE.LineLoop
  private readonly resizeHandles: Marker[] = []
  private readonly rotateHandle = new Marker(unitCircle)
  private readonly anchorCross = new Cross()
  /** One diamond per anchored object on screen (D161). */
  private readonly anchorMarks: Marker[] = []
  private readonly stem: THREE.Mesh
  private readonly guides = new Guides()
  /** The selected path (D191). */
  readonly pathLine = new PathLine()
  /** The selected object's other paths (D205). */
  private readonly otherLines: PathLine[] = []
  /** The selected Shape's points (D233). */
  readonly shapeHandles = new ShapeHandles()
  /** The handles shown right now, with their world positions, for picking. */
  private handles: { handle: Handle; x: number; y: number; radius: number }[] = []
  private readonly raycaster = new THREE.Raycaster()
  /** What was last drawn, for the frames of groups. */
  private model: SceneModel | null = null
  private time = 0
  private editing: string | null = null
  private pixel = 1
  /** An object drawn where the pencil holds it while its motion is sketched (D297), whatever the model says. */
  private follow: { name: string; point: { x: number; y: number } } | null = null
  /** Each mask's picture (D337): the meshes that draw it, kept out of the scene and drawn to a texture of their own. */
  private readonly maskRoots = new Map<string, THREE.Group>()
  /** The textures, for each renderer that draws the scene, the view's, the Camera view's, an export's: one per mask by its name, and one per set of masks that hide an object together. */
  private readonly maskTargetsBy = new Map<THREE.WebGLRenderer, Map<string, THREE.WebGLRenderTarget>>()
  /** The size of what is being drawn into, in pixels, which every material reads the mask picture by. */
  private readonly maskSize = { value: new THREE.Vector2(1, 1) }
  /** This frame's masks: the ones that exist now and are on, and for each set of them that hides an object together, what it hides. */
  private readonly liveMasks = new Set<Mask>()
  private readonly maskSets = new Map<string, { masks: Mask[]; items: Item[] }>()
  /** What the view hides, the names in hand, the selection, and whether the masks' edges show (D334, D341, D344). */
  private hidden: ReadonlySet<string> = new Set()
  private held: ReadonlySet<string> = new Set()
  private showMasks = false
  /** The masks whose edges show this frame, the one in hand strongest, each as a box in the scene drawn over it. */
  private outlined: { mask: Mask; strength: number }[] = []
  private readonly maskEdges: THREE.Mesh[] = []
  private readonly keptColor = new THREE.Color()

  constructor() {
    this.rotateRing = new THREE.LineLoop(ringGeometry(), ringMaterial)
    this.rotateRing.renderOrder = ORDER + 1
    this.rotateRing.visible = false
    for (let i = 0; i < RESIZE_HANDLES.length; i++) {
      const marker = new Marker(unitPlane)
      this.resizeHandles.push(marker)
      this.overlay.add(marker.group)
    }
    this.stem = new THREE.Mesh(unitPlane, lightMaterial)
    this.stem.renderOrder = ORDER + 1
    this.stem.visible = false
    this.overlay.add(this.gizmoOutline.group, this.rotateRing, this.rotateHandle.group, this.anchorCross.group, this.stem, this.guides.group, this.pathLine.group, this.shapeHandles.group)
    this.group.add(this.overlay)
  }

  /** The project's size (D357): what a camera's frame is cut from. */
  setComposition(width: number, height: number): void {
    this.composition = { width, height }
  }

  /** The cameras alive right now, with the frame each cuts from the scene, and whether it has the picture (D358, D361). */
  cameras(): { name: string; frame: Frame; live: boolean }[] {
    return [...this.cameraFrames].map(([name, frame]) => ({ name, frame, live: name === this.liveCamera }))
  }

  /** The camera whose frame's line runs within `reach` of a place in the scene, the nearest when several do, or null (D361): a camera is picked by its line, never by what it frames. */
  pickCamera(world: { x: number; y: number }, reach: number): string | null {
    let best: string | null = null
    let bestDistance = Infinity
    for (const [name, f] of this.cameraFrames) {
      const a = (-f.rotation * Math.PI) / 180
      const dx = world.x - f.x
      const dy = world.y - f.y
      const ox = Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) - f.width / 2
      const oy = Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) - f.height / 2
      const distance = ox <= 0 && oy <= 0 ? Math.min(-ox, -oy) : Math.hypot(Math.max(ox, 0), Math.max(oy, 0))
      if (distance <= reach && distance < bestDistance) {
        best = name
        bestDistance = distance
      }
    }
    return best
  }

  /** The textures one renderer's drawings read the masks from. */
  private targetsOf(renderer: THREE.WebGLRenderer): Map<string, THREE.WebGLRenderTarget> {
    let targets = this.maskTargetsBy.get(renderer)
    if (!targets) {
      targets = new Map()
      this.maskTargetsBy.set(renderer, targets)
    }
    return targets
  }

  /**
   * Draw the scene as last updated through a camera, the masks' pictures made for it first: what
   * the Camera view shows (D360). With `overlay`, what is drawn for the one working on the scene
   * shows too, as it was last laid out (D366); without, the scene alone.
   */
  drawThrough(renderer: THREE.WebGLRenderer, camera: THREE.Camera, overlay = false): void {
    this.overlay.visible = overlay
    this.renderMasks(renderer, camera)
    renderer.render(this.group, camera)
    this.overlay.visible = true
  }

  /** Where a mask's picture is kept: its objects' meshes, apart from the scene. */
  private maskRoot(name: string): THREE.Group {
    let root = this.maskRoots.get(name)
    if (!root) {
      root = new THREE.Group()
      this.maskRoots.set(name, root)
    }
    return root
  }

  /**
   * How the view shows the scene (D334, D341, D344): what it hides, by name; what is in hand, the
   * selection, whose mask shows its edge and is picked before anything drawn; and whether the
   * edges of the masks on the selection show, or with nothing selected, of every mask there is.
   */
  setView(view: { hidden: readonly string[]; held: readonly string[]; showMasks: boolean }): void {
    this.hidden = new Set(view.hidden)
    this.held = new Set(view.held)
    this.showMasks = view.showMasks
  }

  /** Whether the view hides an object: itself, or a group that carries it (D341). */
  private hiddenNow(model: SceneModel, obj: SceneObject): boolean {
    return this.hidden.size > 0 && (this.hidden.has(obj.name) || containers(model, obj).some((g) => this.hidden.has(g.name)))
  }

  private maskEdgeAt(index: number): THREE.Mesh {
    while (this.maskEdges.length <= index) {
      const edge = new THREE.Mesh(
        unitPlane,
        new THREE.ShaderMaterial({
          uniforms: { map: { value: null as THREE.Texture | null }, size: this.maskSize, ratio: { value: 1 }, strength: { value: 1 }, color: { value: new THREE.Color(MASK_EDGE) } },
          vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
          fragmentShader: EDGE_FRAGMENT,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      )
      edge.renderOrder = ORDER - 1
      edge.visible = false
      this.overlay.add(edge)
      this.maskEdges.push(edge)
    }
    return this.maskEdges[index]!
  }

  /**
   * This frame's masks (D337): the ones that exist now and are on, and for every drawn object
   * the set of them that hides it. The pictures are drawn, and handed to the materials, by
   * `renderMasks`; until then nothing is hidden.
   */
  private planMasks(model: SceneModel | null, time: number, keepAliveFrom: number | undefined): void {
    for (const item of this.items.values()) {
      pictureOf(item.mesh).value = UNMASKED
      if (item.stroke) pictureOf(item.stroke).value = UNMASKED
    }
    this.maskSets.clear()
    this.liveMasks.clear()
    this.outlined = []
    const named = new Set<string>()
    if (model && model.masks.length > 0) {
      const byName = new Map(model.objects.map((o) => [o.name, o]))
      const alive = (name: string): boolean => {
        const o = byName.get(name)
        return !!o && (existsAt(model, o, time) || (keepAliveFrom !== undefined && existsAt(model, o, keepAliveFrom)))
      }
      // A mask masks while it exists (D331): outside its life, what it lists is whole. Hidden in the view, it does not mask there (D335).
      for (const mask of model.masks) {
        named.add(mask.name)
        const owner = byName.get(mask.name)
        if (owner && !this.hiddenNow(model, owner) && mask.shapes.some(alive)) this.liveMasks.add(mask)
      }
      if (this.liveMasks.size > 0) {
        for (const [name, item] of this.items) {
          if (!item.mesh.visible && !item.stroke?.visible) continue
          const hiding = masksOn(model, name).filter((m) => this.liveMasks.has(m))
          if (hiding.length === 0) continue
          const key = hiding.map((m) => `${m.inverted ? '!' : ''}${m.name}`).join(' ')
          const set = this.maskSets.get(key) ?? { masks: hiding, items: [] }
          set.items.push(item)
          this.maskSets.set(key, set)
        }
      }
      // The edges that show: the mask in hand always; with Show Masks, those on what is selected, or with nothing selected every mask there is now (D334, D344).
      const inHand = new Set<Mask>()
      const shown = new Set<Mask>()
      for (const name of this.held) {
        const mask = maskFor(model, name)
        if (mask) inHand.add(mask)
        else if (this.showMasks) for (const leaf of model.groups.has(name) ? groupMembers(model, name) : [name]) for (const m of masksOn(model, leaf)) if (this.liveMasks.has(m)) shown.add(m)
      }
      if (this.showMasks && this.held.size === 0) for (const m of this.liveMasks) shown.add(m)
      this.outlined = [...[...inHand].map((mask) => ({ mask, strength: 1 })), ...[...shown].filter((m) => !inHand.has(m)).map((mask) => ({ mask, strength: 0.7 }))]
    }
    for (const [name, root] of this.maskRoots) {
      if (named.has(name)) root.updateMatrixWorld()
      else if (root.children.length === 0) this.maskRoots.delete(name)
    }
  }

  /**
   * Draw the pictures of this frame's masks and hand them to what they hide (D337): each mask's
   * objects alone, through the camera the scene is about to be drawn with, into a texture the
   * size of the drawing; where several masks hide one object, their pictures multiplied into
   * one, so it shows only where every one of them lets it (D332). Whoever draws the scene calls
   * this just before: the view, and the export.
   */
  renderMasks(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const targets = this.targetsOf(renderer)
    const needed = new Set<Mask>()
    for (const set of this.maskSets.values()) for (const mask of set.masks) needed.add(mask)
    for (const { mask } of this.outlined) needed.add(mask)
    const used = new Set<string>()
    if (needed.size > 0) {
      const size = renderer.getDrawingBufferSize(this.maskSize.value)
      const target = (key: string, samples: number): THREE.WebGLRenderTarget => {
        used.add(key)
        let t = targets.get(key)
        if (!t) {
          t = new THREE.WebGLRenderTarget(size.x, size.y, { samples, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false })
          targets.set(key, t)
        } else if (t.width !== size.x || t.height !== size.y) t.setSize(size.x, size.y)
        return t
      }
      const color = renderer.getClearColor(this.keptColor)
      const alpha = renderer.getClearAlpha()
      const before = renderer.getRenderTarget()
      const autoClear = renderer.autoClear
      renderer.autoClear = true
      for (const mask of needed) {
        renderer.setRenderTarget(target(mask.name, 4))
        renderer.setClearColor(0x000000, 0)
        renderer.render(this.maskRoot(mask.name), camera)
      }
      for (const [key, set] of this.maskSets) {
        const only = set.masks[0]!
        let picture = targets.get(only.name)!.texture
        if (set.masks.length > 1 || only.inverted) {
          // A name holds no space, so a set's key is no mask's.
          const joined = target(`set ${key}`, 0)
          renderer.setRenderTarget(joined)
          renderer.setClearColor(0xffffff, 1)
          renderer.clear()
          renderer.autoClear = false
          joinMaterial.uniforms['size']!.value.copy(size)
          for (const mask of set.masks) {
            joinMaterial.uniforms['map']!.value = targets.get(mask.name)!.texture
            joinMaterial.uniforms['inverted']!.value = mask.inverted ? 1 : 0
            renderer.render(joinQuad, screenCamera)
          }
          renderer.autoClear = true
          picture = joined.texture
        }
        for (const item of set.items) {
          pictureOf(item.mesh).value = picture
          if (item.stroke) pictureOf(item.stroke).value = picture
        }
      }
      renderer.autoClear = autoClear
      renderer.setRenderTarget(before)
      renderer.setClearColor(color, alpha)
    }
    // Each edge is a box in the scene around its mask's picture, a little larger, so only that much is looked through for the line.
    const ortho = camera as THREE.OrthographicCamera
    const pixel = ortho.isOrthographicCamera ? (ortho.right - ortho.left) / ortho.zoom / Math.max(1, this.maskSize.value.x) : this.pixel
    this.outlined.forEach(({ mask, strength }, i) => {
      const edge = this.maskEdgeAt(i)
      let box: Box | null = null
      for (const name of mask.shapes) {
        const b = this.boxOf(name)
        if (b) box = union(box, b)
      }
      edge.visible = !!box
      if (!box) return
      const margin = EDGE_MARGIN * pixel
      edge.position.set((box.left + box.right) / 2, (box.top + box.bottom) / 2, 0.55)
      edge.scale.set(box.right - box.left + 2 * margin, box.top - box.bottom + 2 * margin, 1)
      const uniforms = (edge.material as THREE.ShaderMaterial).uniforms
      uniforms['map']!.value = targets.get(mask.name)!.texture
      uniforms['ratio']!.value = renderer.getPixelRatio()
      uniforms['strength']!.value = strength
    })
    for (let i = this.outlined.length; i < this.maskEdges.length; i++) this.maskEdges[i]!.visible = false
    for (const [key, t] of targets) {
      if (used.has(key)) continue
      t.dispose()
      targets.delete(key)
    }
  }

  /** How many masks' edges show right now. */
  maskEdgeCount(): number {
    return this.maskEdges.filter((edge) => edge.visible).length
  }

  /** Let go of the mask pictures. */
  dispose(): void {
    for (const targets of this.maskTargetsBy.values()) for (const t of targets.values()) t.dispose()
    this.maskTargetsBy.clear()
  }

  private outline(index: number): Outline {
    while (this.outlines.length <= index) {
      const outline = new Outline()
      this.overlay.add(outline.group)
      this.outlines.push(outline)
    }
    return this.outlines[index]!
  }

  /**
   * Draw the model at a time, outline every selected object, and show the handles of the mode on
   * the gizmo frame: the object's own frame for one object, a group's own frame for a group, with
   * its members outlined, or the upright box around an ad-hoc selection of several (D96, D116,
   * D124). A thin x marks the center of a group's box, which its next turn or scale happens around.
   * `pixel` is the world size of one screen pixel.
   */
  update(model: SceneModel | null, time: number, selection: string[], mode: TransformMode = 'all', pixel = 1, axes = 0, keepAliveFrom?: number, anchored: string[] = [], handles = true): void {
    this.model = model
    this.time = time
    this.pixel = pixel
    const seen = new Set<string>()
    if (model) {
      model.objects.forEach((obj, index) => {
        // A group and a camera draw nothing of their own (D124, D357).
        if (obj.className === GROUP || obj.className === CAMERA) return
        seen.add(obj.name)
        const item = this.ensure(obj)
        // A mask's picture is drawn apart, to a texture of its own, and nowhere else (D337).
        const mask = model.masks.length > 0 ? maskDrawnBy(model, obj.name) : null
        const home = mask ? this.maskRoot(mask.name) : this.group
        if (item.mesh.parent !== home) {
          home.add(item.mesh)
          if (item.stroke) home.add(item.stroke)
        }
        this.apply(item, obj, model, time, index, keepAliveFrom)
        // Hidden in the view (D341): not drawn there, so neither picked nor framed. A mask's picture stays, so a mask in hand still shows where it is.
        if (!mask && this.hiddenNow(model, obj)) {
          item.mesh.visible = false
          if (item.stroke) item.stroke.visible = false
        }
        // The Text being edited in the preview shows its words in the editor alone (D270).
        if (obj.name === this.editing) item.mesh.visible = false
        // Held by the pencil: drawn under the pointer, the model untouched until the sketch is written (D297).
        if (this.follow && obj.name === this.follow.name) {
          item.mesh.position.set(this.follow.point.x, this.follow.point.y, item.mesh.position.z)
          if (item.stroke) item.stroke.position.set(this.follow.point.x, this.follow.point.y, item.stroke.position.z)
        }
      })
    }
    for (const [name, item] of this.items) {
      if (seen.has(name)) continue
      item.mesh.removeFromParent()
      item.stroke?.removeFromParent()
      disposeItem(item)
      this.items.delete(name)
    }
    this.planMasks(model, time, keepAliveFrom)

    // The cameras alive now, each with the frame it cuts from the scene (D357, D361): its line over the scene, solid and lit for the one that has the picture, which is the view's own frame, dashed for the others.
    this.cameraFrames.clear()
    this.liveCamera = null
    if (model) {
      this.liveCamera = cameraAt(model, time, keepAliveFrom)?.name ?? null
      for (const camera of camerasOf(model)) {
        if (!existsAt(model, camera, time) && !(keepAliveFrom !== undefined && existsAt(model, camera, keepAliveFrom))) continue
        const v = viewOf(model, camera, time)
        this.cameraFrames.set(camera.name, { x: v.x, y: v.y, rotation: v.rotation, width: this.composition.width / v.zoom, height: this.composition.height / v.zoom })
      }
    }
    this.layout({ selection, mode, pixel, axes, anchored, handles, cameras: true }, false)
  }

  /**
   * Lay out what is drawn over the scene for the one working on it, in a view's own pixels: the
   * frames of the cameras, the marks of anchored things, the selection's outlines, and its
   * handles. `update` does it for the view it is given; a second view of the same scene, the
   * Camera view, has it laid out again before it is drawn or pressed (D366), the paths, a
   * Shape's handles, and the guides with it. `cameras` says whether the cameras' frames show:
   * they do in the Preview view, and the Camera view is the camera's own.
   */
  layout(o: { selection: string[]; mode: TransformMode; pixel: number; axes: number; anchored: string[]; handles: boolean; cameras: boolean }, again = true): void {
    const { selection, mode, pixel, axes, anchored, handles } = o
    const model = this.model
    this.pixel = pixel
    if (again) {
      this.applyPath(pixel)
      this.applyOtherPaths(pixel)
      this.applyShapeHandles(pixel)
      if (this.guideSpec) this.guides.set(this.guideSpec.lines, this.guideSpec.view, pixel)
    }
    const dashed = o.cameras ? [...this.cameraFrames] : []
    while (this.cameraLines.length < dashed.length) {
      const line = new FrameLine()
      this.overlay.add(line.group)
      this.cameraLines.push(line)
    }
    this.cameraLines.forEach((line, i) => {
      const entry = dashed[i]
      if (entry) line.set(entry[1], pixel, entry[0] === this.liveCamera)
      else line.hide()
    })

    // An anchored object wears a small diamond at its center, so what a push cannot move is seen (D161).
    const pinned = anchored.filter((n) => this.shown(n))
    while (this.anchorMarks.length < pinned.length) {
      const mark = new Marker(unitPlane)
      this.overlay.add(mark.group)
      this.anchorMarks.push(mark)
    }
    this.anchorMarks.forEach((mark, i) => {
      const f = i < pinned.length ? this.frameOf(pinned[i]!) : null
      if (f) mark.set(f.x, f.y, Math.PI / 4, ANCHOR_PX * pixel, pixel)
      else mark.hide()
    })

    const group = selection.length === 1 && model ? (model.objects.find((o) => o.name === selection[0] && o.className === GROUP) ?? null) : null
    const outlined = (group && model ? groupMembers(model, group.name) : selection).filter((n) => this.shown(n))
    outlined.forEach((name, i) => this.outline(i).set(this.frameOf(name)!, pixel))
    for (let i = outlined.length; i < this.outlines.length; i++) this.outlines[i]!.hide()

    // A group's box is in the code; a plain turn of an ad-hoc selection leaves its box on the turned axes until the selection changes (D116).
    const frame = group ? this.frameOf(group.name) : outlined.length === 1 ? this.frameOf(outlined[0]!) : outlined.length > 1 ? this.boxAround(outlined, axes) : null
    // The selection shows in every tool; the handles that transform it belong to Select alone (D236, D247).
    const showRing = handles && !!frame && mode === 'rotate'
    const showResize = handles && !!frame && (mode === 'resize' || mode === 'all')
    const showRotate = handles && !!frame && mode === 'all'
    const showAnchor = handles && !!frame && !!group && (mode === 'all' || mode === 'rotate')
    this.rotateRing.visible = showRing
    this.stem.visible = showRotate
    if (!showRotate) this.rotateHandle.hide()
    if (!showAnchor) this.anchorCross.hide()
    if (!showResize) for (const handle of this.resizeHandles) handle.hide()
    if ((group || outlined.length > 1) && frame) this.gizmoOutline.set(frame, pixel)
    else this.gizmoOutline.hide()
    this.handles = []
    if (!frame || !handles) return
    const angle = (frame.rotation * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const local = (lx: number, ly: number) => ({ x: frame.x + lx * cos - ly * sin, y: frame.y + lx * sin + ly * cos })
    const w = frame.width
    const h = frame.height
    if (showRing) {
      const radius = Math.hypot(w, h) / 2
      this.rotateRing.position.set(frame.x, frame.y, 0.6)
      this.rotateRing.scale.set(radius, radius, 1)
    }
    if (showResize) {
      this.resizeHandles.forEach((marker, i) => {
        const { sx, sy } = RESIZE_HANDLES[i]!
        const p = local((sx * w) / 2, (sy * h) / 2)
        const size = (sx !== 0 && sy !== 0 ? CORNER_PX : EDGE_PX) * pixel
        marker.set(p.x, p.y, angle, size, pixel)
        // Hit areas are larger than the drawn squares, so small objects stay easy to grab.
        this.handles.push({ handle: { kind: 'resize', sx, sy }, x: p.x, y: p.y, radius: (sx !== 0 && sy !== 0 ? 13 : 11) * pixel })
      })
    }
    if (showRotate) {
      const p = local(0, h / 2 + ROTATE_OFFSET * pixel)
      const size = ROTATE_PX * pixel
      this.rotateHandle.set(p.x, p.y, angle, size, pixel)
      const mid = local(0, h / 2 + (ROTATE_OFFSET * pixel) / 2)
      this.stem.position.set(mid.x, mid.y, 0.6)
      this.stem.rotation.z = angle
      this.stem.scale.set(LINE_PX * pixel, ROTATE_OFFSET * pixel, 1)
      this.handles.push({ handle: { kind: 'rotate' }, x: p.x, y: p.y, radius: 13 * pixel })
    }
    if (showAnchor) this.anchorCross.set(frame.x, frame.y, PIVOT_PX * pixel, pixel)
  }

  /** The handle under a world position, if any. Handles win over the objects beneath them. */
  pickHandle(world: { x: number; y: number }): Handle | null {
    let best: Handle | null = null
    let bestDistance = Infinity
    for (const h of this.handles) {
      const distance = Math.hypot(world.x - h.x, world.y - h.y)
      if (distance <= h.radius && distance < bestDistance) {
        best = h.handle
        bestDistance = distance
      }
    }
    return best
  }

  /** Show the lines a drag has snapped to, across the view (D135). They stay until cleared. */
  setGuides(lines: GuideLine[], view: { left: number; right: number; top: number; bottom: number }, pixel: number): void {
    this.guideSpec = { lines, view }
    this.guides.set(lines, view, pixel)
  }

  /** Draw a path's curve as a line with its ends marked, with a handle on each anchor when they can be edited, the picked ones larger, or nothing (D192, D194, D198); dashed when its shape is code (D226). */
  setPath(points: { x: number; y: number }[] | null, pixel: number, anchors: { x: number; y: number }[] | null = null, active: number[] = [], dashed = false, handles: ControlHandle[] = [], round: boolean[] = []): void {
    this.pathSpec = { points, anchors, active, dashed, handles, round }
    this.applyPath(pixel)
  }

  private applyPath(pixel: number): void {
    const s = this.pathSpec
    if (s.points) this.pathLine.set(s.points, pixel, s.anchors, s.active, s.dashed, s.handles, s.round)
    else this.pathLine.hide()
  }

  /** How many controls the selected path shows right now. */
  pathControlCount(): number {
    return this.pathLine.controlCount()
  }

  /** The other paths shown, as lines without handles (D205), each dashed when its shape is code (D226). */
  setOtherPaths(curves: { points: { x: number; y: number }[]; dashed: boolean }[], pixel: number): void {
    this.otherSpec = curves
    this.applyOtherPaths(pixel)
  }

  private applyOtherPaths(pixel: number): void {
    const curves = this.otherSpec
    while (this.otherLines.length < curves.length) {
      const line = new PathLine()
      this.overlay.add(line.group)
      this.otherLines.push(line)
    }
    this.otherLines.forEach((line, i) => {
      const curve = curves[i]
      if (curve) line.set(curve.points, pixel, null, [], curve.dashed)
      else line.hide()
    })
  }

  /** The points of the selected Shape as handles, the picked ones larger, with the controls of the picked anchors, or none (D233, D240). */
  setShapeHandles(points: { x: number; y: number }[] | null, pixel: number, active: number[] = [], handles: ControlHandle[] = [], round: boolean[] = []): void {
    this.shapeSpec = { points, active, handles, round }
    this.applyShapeHandles(pixel)
  }

  private applyShapeHandles(pixel: number): void {
    const s = this.shapeSpec
    if (s.points && s.points.length > 0) this.shapeHandles.set(s.points, pixel, s.active, s.handles, s.round)
    else this.shapeHandles.hide()
  }

  /** How many of the shown shape handles are round, smooth points. */
  shapeRoundCount(): number {
    return this.shapeHandles.roundCount()
  }

  /** How many control handles show right now. */
  controlHandleCount(): number {
    return this.shapeHandles.controlCount()
  }

  /** How many path lines show right now, the selected one included. */
  pathLineCount(): number {
    return (this.pathLine.group.visible ? 1 : 0) + this.otherLines.filter((l) => l.group.visible).length
  }

  clearGuides(): void {
    this.guideSpec = null
    this.guides.hide()
  }

  guideCount(): number {
    return this.guides.count()
  }

  /** Whether an object draws anything right now: its fill, or a Shape's stroke alone (D238). */
  private shown(name: string): boolean {
    // A camera shows as its frame while it is alive (D361).
    if (this.cameraFrames.has(name)) return true
    const item = this.items.get(name)
    return !!item && (item.mesh.visible || !!item.stroke?.visible)
  }

  /** Where a visible object, or a group, is drawn right now, or null. */
  /** The Text whose words are being edited in the preview, drawn by the editor over it instead (D270). */
  setEditing(name: string | null): void {
    this.editing = name
  }

  /** The object the pencil holds while its motion is sketched, drawn at the point (D297); null lets go. */
  setFollow(name: string | null, point: { x: number; y: number } | null): void {
    this.follow = name && point ? { name, point } : null
  }

  frameOf(name: string): Frame | null {
    // A camera's frame is what it cuts from the scene (D357).
    const framed = this.cameraFrames.get(name)
    if (framed) return framed
    const item = this.items.get(name)
    if (item) {
      // A Shape with no fill is its stroke (D238).
      if (!item.mesh.visible && !item.stroke?.visible) return null
      const { position, rotation, scale } = item.mesh
      if (item.bounds) {
        // A Shape's box sits where its line is, off its x and y, turned and scaled with it (D232).
        const c = Math.cos(rotation.z)
        const s = Math.sin(rotation.z)
        const k = scale.x
        return { x: position.x + k * (c * item.bounds.x - s * item.bounds.y), y: position.y + k * (s * item.bounds.x + c * item.bounds.y), rotation: (rotation.z * 180) / Math.PI, width: Math.abs(item.bounds.width * k), height: Math.abs(item.bounds.height * k) }
      }
      return { x: position.x, y: position.y, rotation: (rotation.z * 180) / Math.PI, width: Math.abs(scale.x), height: Math.abs(scale.y) }
    }
    const group = this.model?.objects.find((o) => o.name === name && o.className === GROUP)
    return group && this.model ? groupBox(this.model, group, this.time) : null
  }

  /** The box around several visible things on axes turned by `axes`, upright by default, for an ad-hoc selection (D116). */
  boxAround(names: string[], axes = 0): Frame | null {
    const ax = (axes * Math.PI) / 180
    const axCos = Math.cos(ax)
    const axSin = Math.sin(ax)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const name of names) {
      const f = this.frameOf(name)
      if (!f) continue
      const a = (f.rotation * Math.PI) / 180
      const c = Math.cos(a)
      const d = Math.sin(a)
      for (const [lx, ly] of [
        [-f.width / 2, -f.height / 2],
        [f.width / 2, -f.height / 2],
        [-f.width / 2, f.height / 2],
        [f.width / 2, f.height / 2],
      ]) {
        const wx = f.x + lx! * c - ly! * d
        const wy = f.y + lx! * d + ly! * c
        const x = wx * axCos + wy * axSin
        const y = -wx * axSin + wy * axCos
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    if (!Number.isFinite(minX)) return null
    const cu = (minX + maxX) / 2
    const cv = (minY + maxY) / 2
    return { x: cu * axCos - cv * axSin, y: cu * axSin + cv * axCos, rotation: axes, width: maxX - minX, height: maxY - minY }
  }

  /** The axis-aligned box around a visible object, rotation included, or null. */
  boxOf(name: string): Box | null {
    const frame = this.frameOf(name)
    if (!frame) return null
    const a = (frame.rotation * Math.PI) / 180
    const cos = Math.abs(Math.cos(a))
    const sin = Math.abs(Math.sin(a))
    const halfWidth = (frame.width * cos + frame.height * sin) / 2
    const halfHeight = (frame.width * sin + frame.height * cos) / 2
    return { left: frame.x - halfWidth, right: frame.x + halfWidth, top: frame.y + halfHeight, bottom: frame.y - halfHeight }
  }

  /** The box around every visible object, or null when nothing is visible. */
  bounds(): Box | null {
    let box: Box | null = null
    for (const name of this.items.keys()) {
      const b = this.boxOf(name)
      if (b) box = union(box, b)
    }
    return box
  }

  /** The visible objects whose boxes touch a world box, for a selection marquee (D89). */
  objectsIn(box: Box): string[] {
    const names: string[] = []
    for (const name of this.items.keys()) {
      // A mask is not drawn, so a marquee does not take it (D334).
      if (this.model && maskDrawnBy(this.model, name)) continue
      const b = this.boxOf(name)
      if (b && b.left <= box.right && b.right >= box.left && b.bottom <= box.top && b.top >= box.bottom) names.push(name)
    }
    return names
  }

  /**
   * The visible objects whose frames, as a view shows them, touch a box on the pane, for a box
   * drawn in a view that may be turned, the Camera view's (D366): `toPane` is that view's own.
   */
  objectsOnPane(box: { left: number; right: number; top: number; bottom: number }, toPane: (x: number, y: number) => { x: number; y: number }): string[] {
    const names: string[] = []
    for (const name of this.items.keys()) {
      if (this.model && maskDrawnBy(this.model, name)) continue
      const f = this.frameOf(name)
      if (!f) continue
      const a = (f.rotation * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      let left = Infinity
      let right = -Infinity
      let top = Infinity
      let bottom = -Infinity
      for (const [lx, ly] of [
        [-f.width / 2, -f.height / 2],
        [f.width / 2, -f.height / 2],
        [-f.width / 2, f.height / 2],
        [f.width / 2, f.height / 2],
      ]) {
        const p = toPane(f.x + lx! * c - ly! * s, f.y + lx! * s + ly! * c)
        left = Math.min(left, p.x)
        right = Math.max(right, p.x)
        top = Math.min(top, p.y)
        bottom = Math.max(bottom, p.y)
      }
      if (left <= box.right && right >= box.left && top <= box.bottom && bottom >= box.top) names.push(name)
    }
    return names
  }

  /**
   * The name of the topmost visible object under a normalized device coordinate, or null. A mask
   * is not drawn, so it is not picked, but for the one in hand, which is picked before anything
   * drawn; and what a mask hides at that point is not picked either, unless it is in hand, the
   * selection, which can be dragged where it does not show (D334, D343).
   */
  pick(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, camera)
    const model = this.model
    // A Shape's stroke counts as the Shape: an open line has nothing else to hit (D232).
    const drawn: THREE.Mesh[] = []
    const inHand: THREE.Mesh[] = []
    for (const [name, item] of this.items) {
      const mask = model ? maskDrawnBy(model, name) : null
      if (!mask) drawn.push(...drawing(item))
      else if (this.held.has(mask.name) || this.held.has(name)) inHand.push(...drawing(item))
    }
    const topmost = (meshes: THREE.Mesh[]): string[] =>
      this.raycaster
        .intersectObjects(meshes, false)
        .sort((a, b) => b.object.renderOrder - a.object.renderOrder)
        .map((hit) => hit.object.userData['name'])
        .filter((name): name is string => typeof name === 'string')
    const held = topmost(inHand)[0]
    if (held !== undefined) return held
    const inside = new Map<Mask, boolean>()
    const lets = (mask: Mask): boolean => {
      let within = inside.get(mask)
      if (within === undefined) {
        within = this.raycaster.intersectObjects(mask.shapes.flatMap((n) => { const item = this.items.get(n); return item ? drawing(item) : [] }), false).length > 0
        inside.set(mask, within)
      }
      return within !== mask.inverted
    }
    const inSelection = (name: string): boolean => this.held.has(name) || (!!model && containers(model, model.objects.find((o) => o.name === name)!).some((g) => this.held.has(g.name)))
    for (const name of topmost(drawn)) if (!model || inSelection(name) || masksOn(model, name).every((m) => !this.liveMasks.has(m) || lets(m))) return name
    return null
  }

  private ensure(obj: SceneObject): Item {
    let item = this.items.get(obj.name)
    if (item && item.className !== obj.className) {
      item.mesh.removeFromParent()
      item.stroke?.removeFromParent()
      disposeItem(item)
      item = undefined
    }
    if (!item) {
      const isShape = obj.className === SHAPE
      // A Shape's triangles wind either way, as its points were drawn, so both sides show.
      const material = maskable(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, side: isShape ? THREE.DoubleSide : THREE.FrontSide }), this.maskSize)
      // A Shape's fill is its own geometry, rebuilt when its line changes; the unit plane and circle are shared (D232).
      const mesh = new THREE.Mesh(isShape ? new THREE.BufferGeometry() : obj.className === 'Circle' ? unitCircle : unitPlane, material)
      mesh.userData['name'] = obj.name
      item = { mesh, className: obj.className, width: 1, height: 1 }
      if (isShape) {
        const stroke = new THREE.Mesh(new THREE.BufferGeometry(), maskable(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }), this.maskSize))
        stroke.userData['name'] = obj.name
        item.stroke = stroke
        this.group.add(stroke)
      }
      this.items.set(obj.name, item)
      this.group.add(mesh)
    }
    return item
  }

  /**
   * Draw a Shape (D232, D238): the pieces of its line, from its path or its points, filled as
   * SVG fills them, with its stroke as a second mesh; the geometry is rebuilt only when the
   * line changes. `fill: 'none'` draws no fill. Its box is kept in its own space for the frame.
   */
  private applyShape(item: Item, obj: SceneObject, model: SceneModel, time: number, pose: Pose, opacity: number, index: number, z: number): void {
    const pieces = shapePieces(model, obj, time)
    const widthValue = valueAt(model, obj, 'strokeWidth', time)
    const strokeWidth = typeof widthValue === 'number' && Number.isFinite(widthValue) ? Math.max(0, widthValue) : 0
    // How much of the line is drawn so far (D298): the stroke stops there; the fill is whole.
    const drawnValue = valueAt(model, obj, 'drawn', time)
    const drawn = typeof drawnValue === 'number' && Number.isFinite(drawnValue) ? Math.max(0, Math.min(1, drawnValue)) : 1
    const d = valueAt(model, obj, 'curves', time)
    // Path data is its own key; points, and a morphing shape, are keyed by the line they make, since a list may be a word and a morph changes the line over time (D257).
    const morphing = obj.actions.some((a) => a.verb === 'morph' && !a.overridden)
    const key = `${strokeWidth}:${drawn < 1 ? drawn.toFixed(3) : ''}:${hasPathData(d) && !morphing ? `d${d}` : pieces.map((piece) => `${piece.closed ? 'c' : 'o'}${piece.curve.map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`).join(';')}`).join('|')}`
    if (item.shapeKey !== key) {
      item.shapeKey = key
      item.mesh.geometry.dispose()
      item.mesh.geometry = fillGeometry(pieces)
      if (item.stroke) {
        item.stroke.geometry.dispose()
        const curves = pieces.map((piece) => piece.curve)
        item.stroke.geometry = strokeWidth > 0 ? strokeGeometry(drawn < 1 ? drawnCurves(curves, drawn) : curves, strokeWidth) : new THREE.BufferGeometry()
      }
      let left = Infinity
      let right = -Infinity
      let bottom = Infinity
      let top = -Infinity
      for (const piece of pieces) {
        for (const p of piece.curve) {
          left = Math.min(left, p.x)
          right = Math.max(right, p.x)
          bottom = Math.min(bottom, p.y)
          top = Math.max(top, p.y)
        }
      }
      item.bounds = Number.isFinite(left) ? { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left + strokeWidth, height: top - bottom + strokeWidth } : { x: 0, y: 0, width: 0, height: 0 }
      item.width = item.bounds.width
      item.height = item.bounds.height
    }
    const material = item.mesh.material as THREE.MeshBasicMaterial
    const fill = String(valueAt(model, obj, 'fill', time))
    item.mesh.visible = fill !== 'none' && item.mesh.geometry.getAttribute('position') !== undefined
    if (item.mesh.visible) setColor(material, fill)
    // The fill's and the outline's own opacities on top of the object's (D304).
    material.opacity = opacity * unitOpacity(valueAt(model, obj, 'fillOpacity', time))
    item.mesh.scale.set(pose.scale, pose.scale, 1)
    if (item.stroke) {
      const stroke = item.stroke
      stroke.visible = strokeWidth > 0 && pieces.some((piece) => piece.curve.length >= 2)
      stroke.renderOrder = index
      stroke.position.set(pose.x, pose.y, z)
      stroke.rotation.z = (pose.rotation * Math.PI) / 180
      stroke.scale.set(pose.scale, pose.scale, 1)
      const strokeMaterial = stroke.material as THREE.MeshBasicMaterial
      setColor(strokeMaterial, String(valueAt(model, obj, 'stroke', time)))
      strokeMaterial.opacity = opacity * unitOpacity(valueAt(model, obj, 'strokeOpacity', time))
    }
  }

  private apply(item: Item, obj: SceneObject, model: SceneModel, time: number, index: number, keepAliveFrom?: number): void {
    const mesh = item.mesh
    // Outside its life, or at zero opacity, an object is not drawn and nothing else about it is sampled. While a Shift
    // gesture looks ahead, whatever was alive where it began stays drawn, so it can be dragged into an animation (D138).
    const alive = existsAt(model, obj, time) || (keepAliveFrom !== undefined && existsAt(model, obj, keepAliveFrom))
    const opacity = alive ? opacityAt(model, obj, time) : 0
    if (opacity <= 0.0005) {
      mesh.visible = false
      if (item.stroke) item.stroke.visible = false
      return
    }
    const material = mesh.material as THREE.MeshBasicMaterial
    const num = (attr: string): number => {
      const v = valueAt(model, obj, attr, time)
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
    const str = (attr: string): string => String(valueAt(model, obj, attr, time))

    mesh.visible = true
    mesh.renderOrder = index
    // Drawn through the groups that carry it (D124).
    const pose = worldPose(model, obj, time)
    mesh.position.set(pose.x, pose.y, num('z'))
    mesh.rotation.z = (pose.rotation * Math.PI) / 180
    material.opacity = opacity

    if (obj.className === 'Rect') {
      item.width = num('width')
      item.height = num('height')
      setColor(material, str('fill'))
    } else if (obj.className === 'Circle') {
      // Width and height default to twice the radius; set, they make an oval (D106).
      item.width = num('width')
      item.height = num('height')
      setColor(material, str('fill'))
    } else if (obj.className === 'Text') {
      this.applyText(item, obj, model, time, str('fill'))
      mesh.scale.set((item.drawn?.width ?? item.width) * pose.scale, (item.drawn?.height ?? item.height) * pose.scale, 1)
      return
    } else if (obj.className === SHAPE) {
      this.applyShape(item, obj, model, time, pose, opacity, index, num('z'))
      return
    }
    mesh.scale.set(item.width * pose.scale, item.height * pose.scale, 1)
  }

  /**
   * A Text drawn on a canvas (D267): its lines laid out as the sampler measures them, whole
   * while nothing runs on its units, else character by character in their states (D268), the
   * canvas grown around the block so far as the characters reach, and kept, so a frame redraws
   * into it rather than making another. The box the handles frame stays the block's.
   */
  private applyText(item: Item, obj: SceneObject, model: SceneModel, time: number, fill: string): void {
    const style = textStyleAt(model, obj, time)
    const layout = layoutOf(style)
    const states = textUnitStates(model, obj, time, layout)
    const color = parseColor(fill) ? fill : '#ffffff'
    // Redrawn when the look or the characters' states change, not for every frame of a unit animation that leaves them still.
    const still = item.drawnStates !== undefined && sameUnitStates(item.drawnStates, states)
    // A camera closer than the scene's own size magnifies the picture of the text: it is drawn for the next doubling at or past that zoom, so it is redrawn at a few zooms and not at every frame of one (D357). Held on the screen, no camera magnifies it.
    const zoom = isAttached(model, obj) ? 1 : viewAt(model, time).zoom
    const pad0 = textPadding(style)
    const longest = Math.max(layout.width, layout.height) + 2 * pad0
    const sharp = zoom <= 1 ? 1 : Math.max(1, Math.min(TEXT_SHARP_MAX, 2 ** Math.ceil(Math.log2(zoom) - 1e-9), Math.floor(TEXT_CANVAS_MAX / (longest * TEXT_SCALE))))
    const scale = TEXT_SCALE * sharp
    const key = [layout.width, layout.height, style.text, style.fontSize, style.font, style.weight, style.italic, style.align, style.lineHeight, style.letterSpacing, color, fontsVersion.current, sharp].join('\u0000')
    if (item.textKey === key && still) return
    item.textKey = key
    item.drawnStates = states
    const pad = textPadding(style)
    item.width = layout.width + 2 * pad
    item.height = layout.height + 2 * pad
    const over = states ? unitOverflow(layout, states) : { x: 0, y: 0 }
    const marginX = pad + over.x
    const marginY = pad + over.y
    const width = Math.max(1, Math.ceil((layout.width + 2 * marginX) * scale))
    const height = Math.max(1, Math.ceil((layout.height + 2 * marginY) * scale))
    const material = item.mesh.material as THREE.MeshBasicMaterial
    let canvas = item.textCanvas
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      item.textCanvas = canvas
      material.map?.dispose()
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearFilter
      texture.generateMipmaps = false
      material.map = texture
      material.color.set(0xffffff)
      material.needsUpdate = true
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    drawText(ctx, layout, color, states, scale, marginX, marginY)
    if (material.map) material.map.needsUpdate = true
    item.drawn = { width: width / scale, height: height / scale }
  }
}

function union(a: Box | null, b: Box): Box {
  return a ? { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) } : b
}

function setColor(material: THREE.MeshBasicMaterial, fill: string): void {
  if (material.map) {
    material.map.dispose()
    material.map = null
    material.needsUpdate = true
  }
  material.color.set(parseColor(fill) ? fill : '#ff00ff')
}

function disposeItem(item: Item): void {
  const material = item.mesh.material as THREE.MeshBasicMaterial
  material.map?.dispose()
  material.dispose()
  // A Shape owns its geometries; the other kinds share the unit ones.
  if (item.className === SHAPE) item.mesh.geometry.dispose()
  if (item.stroke) {
    item.stroke.geometry.dispose()
    ;(item.stroke.material as THREE.MeshBasicMaterial).dispose()
  }
}
