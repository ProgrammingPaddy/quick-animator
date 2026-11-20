import * as THREE from 'three'
import { groupMembers } from '../model/groups'
import { CAMERA, GROUP } from '../model/registry'
import { aheadOf, frameOf as cameraFrame, scaleAt, setPicture, type View } from '../model/lens'
import { FLAT, lift, planeOfPicture, TURNED_LAYER, type Plane } from './planes'
import { maskDrawnBy, maskFor, masksOn } from '../model/masks'
import { hasPathData } from '../model/pathData'
import { cameraAt, camerasOf, containers, existsAt, groupBox, inView, isAttached, opacityAt, parseColor, shapePiecesWithin, textPadding, textStyleAt, textUnitStates, valueAt, viewAt, viewOf, worldPose, type Pose, type ShapePiece } from '../model/sample'
import { SHAPE } from '../model/registry'
import { drawText, estimateMeasure, fontSpec, layoutOf, sameUnitStates, textMeasure, unitOverflow, type TextMeasure, type TextStyle, type UnitState } from '../model/text'
import { fontsVersion } from '../project/fonts'
import type { Mask, SceneModel, SceneObject } from '../model/types'
import type { TransformMode } from '../state/store'

interface Item {
  mesh: THREE.Mesh
  className: string
  /** Where it is drawn on the plane it lies in, its turn there in degrees, and that plane (D434): the scene's own at its depth, or the picture's for a thing held on the screen. */
  at: { x: number; y: number; rotation: number }
  plane: Plane
  /** Held on the screen (D362): its place among the layers is its place in the cast, whatever its depth. */
  attached: boolean
  /** Its place in the cast. */
  index: number
  /** Its box as a thin line, drawn in a view that is turned, where a flat thing seen on edge would show nothing (D435). */
  edge: THREE.LineLoop
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
  /** The plane it lies in, when that is not the scene's own at depth 0 (D434): a depth, and for the plane of a turned camera's picture its turn. */
  z?: number
  turn?: THREE.Matrix4 | null
}

/** The plane a frame lies in. */
export function planeOfFrame(frame: { z?: number; turn?: THREE.Matrix4 | null }): Plane {
  return !frame.z && !frame.turn ? FLAT : { z: frame.z ?? 0, turn: frame.turn ?? null }
}

/** A frame with the plane it lies in said, when that is not the scene's own at depth 0. */
function onPlane<T extends object>(frame: T, plane: Plane): T & { z?: number; turn?: THREE.Matrix4 | null } {
  return plane.z === 0 && !plane.turn ? frame : { ...frame, z: plane.z, turn: plane.turn }
}

/** A frame as it is on its own plane, with no word of which plane that is. */
function flatOf(frame: Frame): Frame {
  return frame.z === undefined && frame.turn === undefined ? frame : { x: frame.x, y: frame.y, rotation: frame.rotation, width: frame.width, height: frame.height }
}

/**
 * Put something drawn on a plane where the plane has it: its place and its turn on the plane, the
 * plane's depth, and the plane's own turn in the scene when it has one. Its scale is set first.
 */
function place(object: THREE.Object3D, x: number, y: number, angle: number, plane: { z?: number; turn?: THREE.Matrix4 | null }, raise = 0): void {
  object.position.set(x, y, (plane.z ?? 0) + raise)
  object.rotation.set(0, 0, angle)
  if (plane.turn) {
    object.matrixAutoUpdate = false
    object.updateMatrix()
    object.matrix.premultiply(plane.turn)
    object.matrixWorldNeedsUpdate = true
  } else object.matrixAutoUpdate = true
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
/** A circle of more sides, for one shown so large that 96 would show their corners (D424): each count made once. */
const fineCircles = new Map<number, THREE.CircleGeometry>([[96, unitCircle]])
/** The circle to draw one with, for the radius it shows at in pixels: its sides within a tenth of a pixel of the round. */
function circleFor(radius: number): THREE.CircleGeometry {
  let sides = 96
  while (sides < 3072 && radius * (1 - Math.cos(Math.PI / sides)) > 0.1) sides *= 2
  let geometry = fineCircles.get(sides)
  if (!geometry) {
    geometry = new THREE.CircleGeometry(0.5, sides)
    fineCircles.set(sides, geometry)
  }
  return geometry
}
const unitSquare = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)])
/** The thin line of a thing's box in a view that is turned (D435). */
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x8a8f98, depthTest: false, transparent: true, opacity: 0.6 })
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
    place(this.group, frame.x, frame.y, (frame.rotation * Math.PI) / 180, frame)
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

  set(x: number, y: number, rotation: number, size: number, pixel: number, plane: { z?: number; turn?: THREE.Matrix4 | null } = FLAT): void {
    this.group.visible = true
    place(this.group, x, y, rotation, plane, 0.7)
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
/** The path of what is selected, among the paths Show Paths shows (D405): the white of the selection's own outline. */
const heldPathMaterial = new THREE.MeshBasicMaterial({ color: LIGHT, depthTest: false, transparent: true, opacity: 0.95 })

/** Straight pieces as one mesh's triangles (D401): each a band of a width along its piece, as a mesh for each piece drew them. */
function bandGeometry(pieces: [{ x: number; y: number }, { x: number; y: number }][], width: number): THREE.BufferGeometry {
  const positions = new Float32Array(pieces.length * 18)
  const half = width / 2
  let at = 0
  for (const [a, b] of pieces) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length === 0) continue
    const nx = (-dy / length) * half
    const ny = (dx / length) * half
    positions.set([a.x + nx, a.y + ny, 0, a.x - nx, a.y - ny, 0, b.x - nx, b.y - ny, 0, a.x + nx, a.y + ny, 0, b.x - nx, b.y - ny, 0, b.x + nx, b.y + ny, 0], at)
    at += 18
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(at === positions.length ? positions : positions.subarray(0, at), 3))
  return geometry
}

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
  /** The whole line as one mesh (D401): a recorded path has thousands of pieces, and a mesh for each made every frame slow. */
  private readonly line = new THREE.Mesh(new THREE.BufferGeometry(), pathMaterial)
  private readonly start = new THREE.Mesh(unitCircle, pathMaterial)
  private readonly end = new THREE.Mesh(unitPlane, pathMaterial)
  private readonly anchors = new AnchorMarks()
  private readonly controls = new Controls()
  /** What the line was last built from: it is built again only when one of these changes. */
  private built: { points: readonly { x: number; y: number }[]; count: number; pixel: number; dashed: boolean } | null = null
  private pieces = 0
  private length = 0

  constructor() {
    this.line.renderOrder = ORDER + 6
    this.line.position.z = 0.85
    this.line.frustumCulled = false
    this.start.renderOrder = ORDER + 7
    this.end.renderOrder = ORDER + 7
    this.end.rotation.z = Math.PI / 4
    this.group.add(this.line, this.start, this.end, this.anchors.group, this.controls.group)
    this.group.visible = false
  }

  /** `held` draws the line in the color of what is in hand (D405). */
  set(points: { x: number; y: number }[], pixel: number, anchors: { x: number; y: number }[] | null = null, active: number[] = [], dashed = false, handles: ControlHandle[] = [], round: boolean[] = [], held = false): void {
    if (points.length === 0) {
      this.group.visible = false
      return
    }
    this.group.visible = true
    // The controls of the picked anchors of a curves path (D246), and a round mark on each smooth anchor (D252).
    this.controls.set(handles, pixel)
    this.anchors.set(anchors ?? [], pixel, active, round)
    const material = held ? heldPathMaterial : pathMaterial
    this.line.material = material
    this.start.material = material
    this.end.material = material
    const was = this.built
    if (!was || was.points !== points || was.count !== points.length || was.pixel !== pixel || was.dashed !== dashed) {
      const pieces = dashed ? dashes(points, DASH_PX * pixel, GAP_PX * pixel) : points.slice(1).map((b, i) => [points[i]!, b] as [{ x: number; y: number }, { x: number; y: number }])
      this.line.geometry.dispose()
      this.line.geometry = bandGeometry(pieces, LINE_PX * 1.5 * pixel)
      this.pieces = pieces.length
      this.length = pieces.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)
      this.built = { points, count: points.length, pixel, dashed }
    }
    const first = points[0]!
    const last = points[points.length - 1]!
    this.start.position.set(first.x, first.y, 0.86)
    this.start.scale.set(8 * pixel, 8 * pixel, 1)
    this.end.position.set(last.x, last.y, 0.86)
    this.end.scale.set(8 * pixel, 8 * pixel, 1)
  }

  count(): number {
    return this.group.visible ? this.pieces : 0
  }

  /** How much line is drawn, the dashes of a dashed one and not its gaps, for a check. */
  drawn(): number {
    return this.group.visible ? this.length : 0
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

const cameraEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x9a9a9a, depthTest: false, transparent: true, opacity: 0.85 })
const cameraLiveEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xeab308, depthTest: false, transparent: true, opacity: 0.95 })
/** How large a camera's body is drawn, in pane pixels, and how near it a press picks it. */
const BODY_PX = 26
export const BODY_REACH_PX = 16

/** The lines of a camera's body, in its own space, a unit across: a box behind its place, and its lens as a short funnel the way it looks. */
function bodyGeometry(): THREE.BufferGeometry {
  const w = 0.5
  const h = 0.36
  const back = 0.9
  const lens = 0.42
  const corners = (z: number, k: number): THREE.Vector3[] => [new THREE.Vector3(-w * k, -h * k, z), new THREE.Vector3(w * k, -h * k, z), new THREE.Vector3(w * k, h * k, z), new THREE.Vector3(-w * k, h * k, z)]
  const near = corners(0, 1)
  const far = corners(back, 1)
  const mouth = corners(-lens, 0.55)
  const throat = corners(0, 0.22)
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    points.push(near[i]!, near[j]!, far[i]!, far[j]!, near[i]!, far[i]!, mouth[i]!, mouth[j]!, throat[i]!, mouth[i]!)
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}
const cameraBodyGeometry = bodyGeometry()

/**
 * A camera as a thing standing in the scene (D435), drawn in a view that is turned: a small body
 * where it is, facing the way it looks, and the edges of its view out to the corners of its
 * frame. The one that has the picture is lit, as its frame is.
 */
class CameraBody {
  readonly group = new THREE.Group()
  private readonly body = new THREE.LineSegments(cameraBodyGeometry, cameraEdgeMaterial)
  private readonly edges = new THREE.LineSegments(new THREE.BufferGeometry(), cameraEdgeMaterial)

  constructor() {
    this.edges.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3))
    for (const line of [this.body, this.edges]) {
      line.layers.set(TURNED_LAYER)
      line.renderOrder = ORDER - 2
      line.frustumCulled = false
    }
    this.group.add(this.body, this.edges)
    this.group.visible = false
  }

  set(view: View, pixel: number, live: boolean): void {
    this.group.visible = true
    const material = live ? cameraLiveEdgeMaterial : cameraEdgeMaterial
    this.body.material = material
    this.edges.material = material
    this.body.position.set(view.x, view.y, view.z)
    this.body.rotation.set((view.rotationX * Math.PI) / 180, (view.rotationY * Math.PI) / 180, (view.rotation * Math.PI) / 180, 'YXZ')
    this.body.scale.setScalar(BODY_PX * pixel)
    const f = cameraFrame(view)
    const position = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute
    ;[[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([a, b], i) => {
      position.setXYZ(i * 2, view.x, view.y, view.z)
      position.setXYZ(i * 2 + 1, f.center.x + (a! * f.right.x * f.width) / 2 + (b! * f.up.x * f.height) / 2, f.center.y + (a! * f.right.y * f.width) / 2 + (b! * f.up.y * f.height) / 2, f.center.z + (a! * f.right.z * f.width) / 2 + (b! * f.up.z * f.height) / 2)
    })
    position.needsUpdate = true
  }

  hide(): void {
    this.group.visible = false
  }
}

/** The frame of a camera that is alive, over the scene, so it shows whatever is drawn under it (D361): a solid lit line for the one that has the picture, a dashed one for the others. */
class FrameLine {
  readonly group = new THREE.Group()
  private readonly segments: THREE.Mesh[] = []

  set(frame: Frame, pixel: number, live: boolean): void {
    this.group.visible = true
    place(this.group, frame.x, frame.y, (frame.rotation * Math.PI) / 180, frame)
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
  /** The frames of the cameras alive right now, by name, and which of them has the picture (D358). */
  private readonly cameraFrames = new Map<string, Frame>()
  /** What each of them takes its picture through (D433). */
  private readonly cameraViews = new Map<string, View>()
  private liveCamera: string | null = null
  private readonly cameraLines: FrameLine[] = []
  private readonly cameraBodies: CameraBody[] = []
  /** What is drawn for the thing in hand, its box, its handles, its path, its points, the guides: all on the plane that thing lies in (D434). */
  private readonly inHand = new THREE.Group()
  /** The things drawn, in the order of the cast. */
  private cast: Item[] = []
  /** Whether nothing drawn is off depth 0 (D434): a scene with no depth, which draws in the order of the cast and through a flat picture, as it always did. */
  depthless = true
  /** How large a view shows a place of the scene, in its own pixels for a unit there, when a view says: what the detail of a circle follows (D424). Without it, the camera that has the picture. */
  viewDetail: ((place: THREE.Vector3) => number) | null = null
  /** What was last asked to be drawn over the scene, kept so it can be laid out again in another view's pixels (D366): the selected path, the other paths, a Shape's handles, and the guides. */
  private pathSpec: { points: { x: number; y: number }[] | null; anchors: { x: number; y: number }[] | null; active: number[]; dashed: boolean; handles: ControlHandle[]; round: boolean[] } = { points: null, anchors: null, active: [], dashed: false, handles: [], round: [] }
  private otherSpec: { points: { x: number; y: number }[]; dashed: boolean; held?: boolean; z?: number; turn?: THREE.Matrix4 | null }[] = []
  private shapeSpec: { points: { x: number; y: number }[] | null; active: number[]; handles: ControlHandle[]; round: boolean[] } = { points: null, active: [], handles: [], round: [] }
  private guideSpec: { lines: GuideLine[]; view: { left: number; right: number; top: number; bottom: number } } | null = null
  private readonly items = new Map<string, Item>()
  private readonly outlines: Outline[] = []
  private readonly gizmoOutline = new Outline()
  private readonly rotateRing: THREE.LineLoop
  private readonly resizeHandles: Marker[] = []
  private readonly rotateHandle = new Marker(unitCircle)
  private readonly anchorCross = new Cross()
  /** The box around the path in hand with Move path (D394): its outline, the handle that turns the path on its stem, and the cross on the point it turns about. */
  private readonly pathBox = new Outline()
  private readonly pathTurnHandle = new Marker(unitCircle)
  private readonly pathTurnStem: THREE.Mesh
  private readonly pathPivot = new Cross()
  private pathBoxSpec: { frame: Frame; pivot: { x: number; y: number } } | null = null
  private pathTurnGrip: { x: number; y: number; radius: number } | null = null
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
  /** The plane the thing in hand lies in, as last laid out: its handles, its path, and its points are places on it. */
  private handPlane: Plane = FLAT
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
  /** Whether every camera alive shows its frame, or only one in hand (D374). */
  private showCameras = false
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
      this.inHand.add(marker.group)
    }
    this.stem = new THREE.Mesh(unitPlane, lightMaterial)
    this.stem.renderOrder = ORDER + 1
    this.stem.visible = false
    this.pathTurnStem = new THREE.Mesh(unitPlane, lightMaterial)
    this.pathTurnStem.renderOrder = ORDER + 1
    this.pathTurnStem.visible = false
    this.inHand.add(this.gizmoOutline.group, this.rotateRing, this.rotateHandle.group, this.anchorCross.group, this.stem, this.guides.group, this.pathLine.group, this.shapeHandles.group, this.pathBox.group, this.pathTurnStem, this.pathTurnHandle.group, this.pathPivot.group)
    this.overlay.add(this.inHand)
    this.group.add(this.overlay)
  }

  /** The project's size (D357): what a camera's frame is cut from. */
  setComposition(width: number, height: number): void {
    setPicture(width, height)
  }

  /** The cameras alive right now, with the frame each cuts from the scene, and whether it has the picture (D358, D361). */
  cameras(): { name: string; frame: Frame; live: boolean; shown: boolean }[] {
    return [...this.cameraFrames].map(([name, frame]) => ({ name, frame, live: name === this.liveCamera, shown: this.cameraShown(name) }))
  }

  /** Whether a camera's frame is drawn (D374): every camera's when they are shown, else one in hand, the selection. */
  private cameraShown(name: string): boolean {
    return this.showCameras || this.held.has(name)
  }

  /** Whether a camera stands in a turned view as a body (D435): one whose frame is drawn, and the one that has the picture, always. */
  private cameraStands(name: string): boolean {
    return this.cameraShown(name) || name === this.liveCamera
  }

  /** A place in the scene in a frame's own space, from its middle, with how far the frame reaches each way. */
  private within(f: Frame, world: { x: number; y: number }): { x: number; y: number; halfWidth: number; halfHeight: number } {
    const a = (-f.rotation * Math.PI) / 180
    const dx = world.x - f.x
    const dy = world.y - f.y
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a), halfWidth: f.width / 2, halfHeight: f.height / 2 }
  }

  /** What a camera takes its picture through right now (D433), by its name; undefined for one that is not alive. */
  cameraView(name: string): View | undefined {
    return this.cameraViews.get(name)
  }

  /** The camera that has the picture right now. */
  get live(): string | null {
    return this.liveCamera
  }

  /**
   * The camera whose frame holds the pointer, for the Camera tool (D373), which picks a camera by
   * all of its frame: one of `prefer`, what is selected, when it holds the pointer, so a camera
   * in hand stays in hand; else the smallest frame, the one a larger frame would hide. `at` is
   * the pointer's place on a frame's own plane, or null where its line of sight misses it (D434).
   */
  pickCameraInside(at: (frame: Frame) => { x: number; y: number } | null, prefer: readonly string[]): string | null {
    let best: string | null = null
    let bestArea = Infinity
    for (const [name, f] of this.cameraFrames) {
      if (!this.cameraShown(name)) continue
      const world = at(f)
      if (!world) continue
      const p = this.within(f, world)
      if (Math.abs(p.x) > p.halfWidth || Math.abs(p.y) > p.halfHeight) continue
      if (prefer.includes(name)) return name
      const area = f.width * f.height
      if (area < bestArea) {
        best = name
        bestArea = area
      }
    }
    return best
  }

  /** The cameras whose frames, as a view shows them, touch a box on the pane, as a box drawn with the Camera tool takes them (D373): `toPane` is that view's own. */
  camerasOnPane(box: { left: number; right: number; top: number; bottom: number }, toPane: (x: number, y: number, plane: Plane) => { x: number; y: number }): string[] {
    const names: string[] = []
    for (const [name, f] of this.cameraFrames) {
      if (!this.cameraShown(name)) continue
      if (touches(f, box, toPane)) names.push(name)
    }
    return names
  }

  /**
   * The camera whose frame's line runs within `reach` pane pixels of the pointer, the nearest when
   * several do, or null (D361): a camera is picked by its line, never by what it frames. `at` is
   * the pointer's place on a frame's own plane, with how much of the scene a pane pixel is there.
   */
  pickCamera(at: (frame: Frame) => { x: number; y: number; pixel: number } | null, reach: number): string | null {
    let best: string | null = null
    let bestDistance = Infinity
    for (const [name, f] of this.cameraFrames) {
      // A frame that is not drawn is not picked (D374).
      if (!this.cameraShown(name)) continue
      const world = at(f)
      if (!world) continue
      const p = this.within(f, world)
      const ox = Math.abs(p.x) - p.halfWidth
      const oy = Math.abs(p.y) - p.halfHeight
      const distance = (ox <= 0 && oy <= 0 ? Math.min(-ox, -oy) : Math.hypot(Math.max(ox, 0), Math.max(oy, 0))) / world.pixel
      if (distance <= reach && distance < bestDistance) {
        best = name
        bestDistance = distance
      }
    }
    return best
  }

  /** The camera whose body, as a turned view draws it (D435), is under a place on the pane: the nearest within reach. `project` is that view's own. */
  pickCameraBody(paneX: number, paneY: number, project: (place: THREE.Vector3) => { x: number; y: number } | null): string | null {
    let best: string | null = null
    let bestDistance = BODY_REACH_PX
    for (const [name, view] of this.cameraViews) {
      if (!this.cameraStands(name)) continue
      const p = project(new THREE.Vector3(view.x, view.y, view.z))
      if (!p) continue
      const distance = Math.hypot(p.x - paneX, p.y - paneY)
      if (distance <= bestDistance) {
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
    this.orderFor(camera)
    this.renderMasks(renderer, camera)
    renderer.render(this.group, camera)
    this.overlay.visible = true
  }

  /**
   * Which thing is drawn over which, for the camera about to draw (D434): nearer covers farther,
   * and things at one depth draw in the order of the cast, as a flat scene always has. What is
   * held on the screen keeps its place in the cast whatever the camera does, as a flat layer
   * among layers in depth does: the things between two of them are sorted among themselves. A
   * scene with no depth is left in the order of the cast.
   */
  orderFor(camera: THREE.Camera): void {
    if (this.depthless) return
    // Things lie in planes of one depth each: from in front of them the higher is nearer, from behind the lower.
    const sign = camera.getWorldDirection(facing).z <= 0 ? 1 : -1
    const run: Item[] = []
    let next = 0
    const give = (item: Item): void => {
      item.mesh.renderOrder = next
      if (item.stroke) item.stroke.renderOrder = next
      next++
    }
    const flush = (): void => {
      run.sort((a, b) => sign * (a.plane.z - b.plane.z) || a.index - b.index)
      for (const item of run) give(item)
      run.length = 0
    }
    for (const item of this.cast) {
      if (!item.mesh.visible && !item.stroke?.visible) continue
      if (item.attached) {
        flush()
        give(item)
      } else run.push(item)
    }
    flush()
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
   * `showCameras` says whether every camera alive shows its frame (D374); one in hand always does.
   */
  setView(view: { hidden: readonly string[]; held: readonly string[]; showMasks: boolean; showCameras?: boolean }): void {
    this.hidden = new Set(view.hidden)
    this.held = new Set(view.held)
    this.showMasks = view.showMasks
    this.showCameras = view.showCameras === true
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
        return !!o && (inView(model, o, time) || (keepAliveFrom !== undefined && existsAt(model, o, keepAliveFrom)))
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
      edge.scale.set(box.right - box.left + 2 * margin, box.top - box.bottom + 2 * margin, 1)
      place(edge, (box.left + box.right) / 2, (box.top + box.bottom) / 2, 0, this.items.get(mask.shapes[0] ?? '')?.plane ?? FLAT, 0.55)
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
    this.cast = []
    this.depthless = true
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
        if (this.follow && obj.name === this.follow.name) item.at = { x: this.follow.point.x, y: this.follow.point.y, rotation: item.at.rotation }
        this.cast.push(item)
        this.settle(obj.name, item)
        if (!item.attached && item.plane.z !== 0 && (item.mesh.visible || item.stroke?.visible)) this.depthless = false
      })
    }
    for (const [name, item] of this.items) {
      if (seen.has(name)) continue
      item.mesh.removeFromParent()
      item.stroke?.removeFromParent()
      item.edge.removeFromParent()
      disposeItem(item)
      this.items.delete(name)
    }
    this.planMasks(model, time, keepAliveFrom)

    // The cameras alive now, each with the frame it cuts from the scene (D357, D361): its line over the scene, solid and lit for the one that has the picture, which is the view's own frame, dashed for the others.
    this.cameraFrames.clear()
    this.cameraViews.clear()
    this.liveCamera = null
    if (model) {
      this.liveCamera = cameraAt(model, time, keepAliveFrom)?.name ?? null
      for (const camera of camerasOf(model)) {
        if (!inView(model, camera, time) && !(keepAliveFrom !== undefined && existsAt(model, camera, keepAliveFrom))) continue
        // The frame lies on the plane of the camera's picture, as far ahead as it looks at depth 0 (D433): for a camera that looks straight on from where it stands unless told, the frame it always had.
        const v = viewOf(model, camera, time)
        const taken = cameraFrame(v)
        this.cameraViews.set(camera.name, v)
        this.cameraFrames.set(camera.name, onPlane({ x: v.x, y: v.y, rotation: v.rotation, width: taken.width, height: taken.height }, planeOfPicture(v)))
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
  layout(o: { selection: string[]; mode: TransformMode; pixel: number; axes: number; anchored: string[]; handles: boolean; cameras: boolean; plane?: Plane; scale?: (place: THREE.Vector3) => number; bodies?: boolean }, again = true): void {
    const { selection, mode, pixel, axes, anchored, handles } = o
    const model = this.model
    this.pixel = pixel
    /** How much of the scene a pane pixel is where a frame is: `pixel`, but in a view with perspective, where it goes by how far the frame is (D434). */
    const pixelAt = (frame: Frame): number => (o.scale ? 1 / Math.max(1e-9, o.scale(lift(frame.x, frame.y, planeOfFrame(frame), scratch))) : pixel)
    if (again) {
      this.applyPath(pixel)
      this.applyOtherPaths(pixel)
      this.applyPathBox(pixel)
      this.applyShapeHandles(pixel)
      if (this.guideSpec) this.guides.set(this.guideSpec.lines, this.guideSpec.view, pixel)
    }
    const dashed = o.cameras ? [...this.cameraFrames].filter(([name]) => this.cameraShown(name)) : []
    while (this.cameraLines.length < dashed.length) {
      const line = new FrameLine()
      this.overlay.add(line.group)
      this.cameraLines.push(line)
    }
    this.cameraLines.forEach((line, i) => {
      const entry = dashed[i]
      if (entry) line.set(entry[1], pixelAt(entry[1]), entry[0] === this.liveCamera)
      else line.hide()
    })
    // In a view that is turned each of them is also a thing standing in the scene (D435): its body, and the edges of its view. The one that has the picture always stands there, as its frame is always drawn.
    const bodies = o.bodies ? [...this.cameraFrames].filter(([name]) => this.cameraStands(name)) : []
    while (this.cameraBodies.length < bodies.length) {
      const body = new CameraBody()
      this.overlay.add(body.group)
      this.cameraBodies.push(body)
    }
    this.cameraBodies.forEach((body, i) => {
      const view = bodies[i] ? this.cameraViews.get(bodies[i]![0]) : undefined
      if (view) body.set(view, o.scale ? 1 / Math.max(1e-9, o.scale(scratch.set(view.x, view.y, view.z))) : pixel, bodies[i]![0] === this.liveCamera)
      else body.hide()
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
      if (f) mark.set(f.x, f.y, Math.PI / 4, ANCHOR_PX * pixelAt(f), pixelAt(f), f)
      else mark.hide()
    })

    const group = selection.length === 1 && model ? (model.objects.find((o) => o.name === selection[0] && o.className === GROUP) ?? null) : null
    const outlined = (group && model ? groupMembers(model, group.name) : selection).filter((n) => this.shown(n))
    outlined.forEach((name, i) => {
      const f = this.frameOf(name)!
      this.outline(i).set(f, pixelAt(f))
    })
    for (let i = outlined.length; i < this.outlines.length; i++) this.outlines[i]!.hide()

    // A group's box is in the code; a plain turn of an ad-hoc selection leaves its box on the turned axes until the selection changes (D116).
    const framed = group ? this.frameOf(group.name) : outlined.length === 1 ? this.frameOf(outlined[0]!) : outlined.length > 1 ? this.boxAround(outlined, axes) : null
    // What is drawn for the thing in hand lies on its plane, or on the one the view says is in hand (D434); the frame's own numbers are places on that plane.
    this.handPlane = o.plane ?? (framed ? planeOfFrame(framed) : FLAT)
    place(this.inHand, 0, 0, 0, this.handPlane)
    const frame = framed ? flatOf(framed) : null
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

  /**
   * The box around the path in hand with Move path (D394): around its line as the path lies, a
   * handle above it that turns the path, and a cross on the point it turns about, where it
   * begins. Null for none.
   */
  setPathBox(box: { frame: Frame; pivot: { x: number; y: number } } | null, pixel: number): void {
    this.pathBoxSpec = box
    this.applyPathBox(pixel)
  }

  private applyPathBox(pixel: number): void {
    const s = this.pathBoxSpec
    if (!s) {
      this.pathBox.hide()
      this.pathTurnHandle.hide()
      this.pathPivot.hide()
      this.pathTurnStem.visible = false
      this.pathTurnGrip = null
      return
    }
    this.pathBox.set(s.frame, pixel)
    const angle = (s.frame.rotation * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const local = (lx: number, ly: number) => ({ x: s.frame.x + lx * cos - ly * sin, y: s.frame.y + lx * sin + ly * cos })
    const p = local(0, s.frame.height / 2 + ROTATE_OFFSET * pixel)
    this.pathTurnHandle.set(p.x, p.y, angle, ROTATE_PX * pixel, pixel)
    const mid = local(0, s.frame.height / 2 + (ROTATE_OFFSET * pixel) / 2)
    this.pathTurnStem.visible = true
    this.pathTurnStem.position.set(mid.x, mid.y, 0.6)
    this.pathTurnStem.rotation.z = angle
    this.pathTurnStem.scale.set(LINE_PX * pixel, ROTATE_OFFSET * pixel, 1)
    this.pathPivot.set(s.pivot.x, s.pivot.y, PIVOT_PX * pixel, pixel)
    this.pathTurnGrip = { x: p.x, y: p.y, radius: 13 * pixel }
  }

  /** Whether a place in the scene is on the handle that turns the path in hand. */
  onPathTurnHandle(world: { x: number; y: number }): boolean {
    const g = this.pathTurnGrip
    return !!g && Math.hypot(world.x - g.x, world.y - g.y) <= g.radius
  }

  /** Where the handle that turns the path in hand is, for a check; null when no path wears its box. */
  pathTurnHandleAt(): { x: number; y: number } | null {
    return this.pathTurnGrip ? { x: this.pathTurnGrip.x, y: this.pathTurnGrip.y } : null
  }

  /** How many controls the selected path shows right now. */
  pathControlCount(): number {
    return this.pathLine.controlCount()
  }

  /** The other paths shown, as lines without handles (D205), each dashed when its shape is code (D226), and in the selection's color when it is the path of what is selected (D405). */
  setOtherPaths(curves: { points: { x: number; y: number }[]; dashed: boolean; held?: boolean; z?: number; turn?: THREE.Matrix4 | null }[], pixel: number): void {
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
      if (curve) {
        line.set(curve.points, pixel, null, [], curve.dashed, [], [], curve.held === true)
        place(line.group, 0, 0, 0, curve)
      } else line.hide()
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

  /** How many of the path lines shown are in the color of what is selected (D405), for a check. */
  heldPathCount(): number {
    return this.otherSpec.filter((c) => c.held === true).length
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
      const { x, y, rotation } = item.at
      const scale = item.mesh.scale
      if (item.bounds) {
        // A Shape's box sits where its line is, off its x and y, turned and scaled with it (D232).
        const a = (rotation * Math.PI) / 180
        const c = Math.cos(a)
        const s = Math.sin(a)
        const k = scale.x
        return onPlane({ x: x + k * (c * item.bounds.x - s * item.bounds.y), y: y + k * (s * item.bounds.x + c * item.bounds.y), rotation, width: Math.abs(item.bounds.width * k), height: Math.abs(item.bounds.height * k) }, item.plane)
      }
      return onPlane({ x, y, rotation, width: Math.abs(scale.x), height: Math.abs(scale.y) }, item.plane)
    }
    const group = this.model?.objects.find((o) => o.name === name && o.className === GROUP)
    if (!group || !this.model) return null
    const box = groupBox(this.model, group, this.time)
    if (!box) return null
    // A group is its members (D417): its box lies on the plane of the first of them that is drawn.
    for (const member of groupMembers(this.model, name)) {
      const of = this.items.get(member)
      if (of && (of.mesh.visible || of.stroke?.visible)) return onPlane(box, of.plane)
    }
    return box
  }

  /** The plane a thing lies in, as it is drawn (D434): the scene's own at depth 0 for one that is not there. */
  planeOf(name: string): Plane {
    const frame = this.frameOf(name)
    return frame ? planeOfFrame(frame) : FLAT
  }

  /** Put an item's meshes where it lies: its place and its turn on its plane, and its box as a thin line for a view that is turned (D435). */
  private settle(name: string, item: Item): void {
    const angle = (item.at.rotation * Math.PI) / 180
    place(item.mesh, item.at.x, item.at.y, angle, item.plane)
    if (item.stroke) place(item.stroke, item.at.x, item.at.y, angle, item.plane)
    const frame = this.frameOf(name)
    item.edge.visible = !!frame
    if (!frame) return
    item.edge.scale.set(frame.width, frame.height, 1)
    place(item.edge, frame.x, frame.y, angle, item.plane)
  }

  /** The places in the scene that hold everything a view could show (D435): the corners of every thing drawn, and of every camera's frame with where the camera stands. */
  extent(): THREE.Vector3[] {
    const places: THREE.Vector3[] = []
    const corners = (f: Frame): void => {
      const a = (f.rotation * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      const plane = planeOfFrame(f)
      for (const [lx, ly] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) places.push(lift(f.x + lx * f.width * c - ly * f.height * s, f.y + lx * f.width * s + ly * f.height * c, plane))
    }
    for (const name of this.items.keys()) {
      const f = this.frameOf(name)
      if (f) corners(f)
    }
    for (const [name, f] of this.cameraFrames) {
      corners(f)
      const view = this.cameraViews.get(name)
      if (view) places.push(new THREE.Vector3(view.x, view.y, view.z))
    }
    return places
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
    // The box lies on the plane of the first of them (D434): things at several depths have no one plane, and the first is the one in hand.
    const first = names.map((name) => this.frameOf(name)).find((f) => !!f)
    return onPlane({ x: cu * axCos - cv * axSin, y: cu * axSin + cv * axCos, rotation: axes, width: maxX - minX, height: maxY - minY }, first ? planeOfFrame(first) : FLAT)
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
  objectsOnPane(box: { left: number; right: number; top: number; bottom: number }, toPane: (x: number, y: number, plane: Plane) => { x: number; y: number }): string[] {
    const names: string[] = []
    for (const name of this.items.keys()) {
      if (this.model && maskDrawnBy(this.model, name)) continue
      const f = this.frameOf(name)
      if (f && touches(f, box, toPane)) names.push(name)
    }
    return names
  }

  /**
   * The thing whose box, as a view shows it, has an edge within `reach` pane pixels of a place on
   * the pane: the nearest. For a view that is turned (D435), where a flat thing seen on edge has
   * no face to press and is found by the line it is drawn as.
   */
  pickEdge(paneX: number, paneY: number, reach: number, toPane: (x: number, y: number, plane: Plane) => { x: number; y: number }): string | null {
    let best: string | null = null
    let bestDistance = reach
    for (const name of this.items.keys()) {
      if (this.model && maskDrawnBy(this.model, name)) continue
      const f = this.frameOf(name)
      if (!f) continue
      const c = cornersOnPane(f, toPane)
      for (let i = 0; i < 4; i++) {
        const a = c[i]!
        const b = c[(i + 1) % 4]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const length2 = dx * dx + dy * dy
        const t = length2 > 0 ? Math.max(0, Math.min(1, ((paneX - a.x) * dx + (paneY - a.y) * dy) / length2)) : 0
        const distance = Math.hypot(paneX - (a.x + dx * t), paneY - (a.y + dy * t))
        if (distance <= bestDistance) {
          best = name
          bestDistance = distance
        }
      }
    }
    return best
  }

  /**
   * The name of the topmost visible object under a normalized device coordinate, or null. A mask
   * is not drawn, so it is not picked, but for the one in hand, which is picked before anything
   * drawn; and what a mask hides at that point is not picked either, unless it is in hand, the
   * selection, which can be dragged where it does not show (D334, D343).
   */
  pick(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
    // The topmost is by the order this camera draws in (D434).
    this.orderFor(camera)
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
      item.edge.removeFromParent()
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
      const edge = new THREE.LineLoop(unitSquare, edgeMaterial)
      edge.layers.set(TURNED_LAYER)
      edge.renderOrder = ORDER - 3
      edge.visible = false
      this.overlay.add(edge)
      item = { mesh, className: obj.className, width: 1, height: 1, at: { x: 0, y: 0, rotation: 0 }, plane: FLAT, attached: false, index: 0, edge }
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
  private applyShape(item: Item, obj: SceneObject, model: SceneModel, time: number, pose: Pose, opacity: number, index: number, view: View): void {
    // Its curves are drawn in pieces half a unit from the curve at its own size, and as much finer as it shows larger, by doublings, so they are made again at a few sizes and not at every frame of a move (D424).
    const shows = this.shownScale(item, view) * Math.abs(pose.scale)
    const tolerance = shows <= 1.5 ? 0.5 : 0.5 / 2 ** Math.min(7, Math.ceil(Math.log2(shows) - 1e-9))
    const pieces = shapePiecesWithin(model, obj, time, tolerance)
    const widthValue = valueAt(model, obj, 'strokeWidth', time)
    const strokeWidth = typeof widthValue === 'number' && Number.isFinite(widthValue) ? Math.max(0, widthValue) : 0
    // How much of the line is drawn so far (D298): the stroke stops there; the fill is whole.
    const drawnValue = valueAt(model, obj, 'drawn', time)
    const drawn = typeof drawnValue === 'number' && Number.isFinite(drawnValue) ? Math.max(0, Math.min(1, drawnValue)) : 1
    const d = valueAt(model, obj, 'curves', time)
    // Path data is its own key; points, and a morphing shape, are keyed by the line they make, since a list may be a word and a morph changes the line over time (D257).
    const morphing = obj.actions.some((a) => a.verb === 'morph' && !a.overridden)
    const key = `${strokeWidth}:${drawn < 1 ? drawn.toFixed(3) : ''}:${tolerance < 0.5 ? tolerance : ''}:${hasPathData(d) && !morphing ? `d${d}` : pieces.map((piece) => `${piece.closed ? 'c' : 'o'}${piece.curve.map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`).join(';')}`).join('|')}`
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
      stroke.scale.set(pose.scale, pose.scale, 1)
      const strokeMaterial = stroke.material as THREE.MeshBasicMaterial
      setColor(strokeMaterial, String(valueAt(model, obj, 'stroke', time)))
      strokeMaterial.opacity = opacity * unitOpacity(valueAt(model, obj, 'strokeOpacity', time))
    }
  }

  private apply(item: Item, obj: SceneObject, model: SceneModel, time: number, index: number, keepAliveFrom?: number): void {
    const mesh = item.mesh
    // Outside its life, or at zero opacity, an object is not drawn and nothing else about it is sampled. While a Shift
    // gesture looks ahead, whatever was alive where it began stays drawn, so it can be dragged into an animation (D138);
    // while a recording runs, what is in hand stays drawn though its life has gone by (D403).
    const alive = inView(model, obj, time) || (keepAliveFrom !== undefined && existsAt(model, obj, keepAliveFrom))
    const opacity = alive ? opacityAt(model, obj, time) : 0
    item.index = index
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
    item.at = { x: pose.x, y: pose.y, rotation: pose.rotation }
    // Held on the screen it lies on the plane of the picture, wherever the camera that has it is and looks (D362); else on the scene's own plane at its depth (D434).
    item.attached = isAttached(model, obj)
    const view = viewAt(model, time)
    const z = num('z')
    if (item.attached) item.plane = planeOfPicture(view)
    else if (item.plane.z !== z || item.plane.turn) item.plane = z === 0 ? FLAT : { z, turn: null }
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
      // As many sides as the size it shows at asks for (D424): a circle close to a camera, or zoomed in on, stays round.
      const round = circleFor((Math.max(item.width, item.height) / 2) * Math.abs(pose.scale) * this.shownScale(item, view))
      if (mesh.geometry !== round) mesh.geometry = round
    } else if (obj.className === 'Text') {
      this.applyText(item, obj, model, time, str('fill'), view)
      mesh.scale.set((item.drawn?.width ?? item.width) * pose.scale, (item.drawn?.height ?? item.height) * pose.scale, 1)
      return
    } else if (obj.className === SHAPE) {
      this.applyShape(item, obj, model, time, pose, opacity, index, view)
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
  /** How large a thing shows, in pixels for a unit of the scene where it lies (D424): as the views say, or with none saying, through the camera that has the picture; 1 for a thing behind it. */
  private shownScale(item: Item, view: View): number {
    const at = lift(item.at.x, item.at.y, item.plane, scratch)
    if (this.viewDetail) return this.viewDetail(at)
    return item.attached ? 1 : this.throughCamera(view, at)
  }

  /** How many pixels of the picture a unit of the scene takes at a place, through a camera; 1 behind it. */
  private throughCamera(view: View, at: THREE.Vector3): number {
    const ahead = aheadOf(view, at)
    return view.orthographic || ahead > 1e-6 ? scaleAt(view, ahead) : 1
  }

  private applyText(item: Item, obj: SceneObject, model: SceneModel, time: number, fill: string, view: View): void {
    const style = textStyleAt(model, obj, time)
    const layout = layoutOf(style)
    const states = textUnitStates(model, obj, time, layout)
    const color = parseColor(fill) ? fill : '#ffffff'
    // Redrawn when the look or the characters' states change, not for every frame of a unit animation that leaves them still.
    const still = item.drawnStates !== undefined && sameUnitStates(item.drawnStates, states)
    // A camera that shows the text larger than its own size, by its lens or by standing close, magnifies the picture of it: it is drawn for the next doubling at or past that, so it is redrawn at a few sizes and not at every frame of a move (D357, D424). Held on the screen, no camera magnifies it.
    const zoom = item.attached ? 1 : this.throughCamera(view, lift(item.at.x, item.at.y, item.plane, scratch))
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

const facing = new THREE.Vector3()
const scratch = new THREE.Vector3()

/** The corners of a frame as a view shows them, on the pane. */
function cornersOnPane(f: Frame, toPane: (x: number, y: number, plane: Plane) => { x: number; y: number }): { x: number; y: number }[] {
  const a = (f.rotation * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const plane = planeOfFrame(f)
  return ([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const).map(([lx, ly]) => toPane(f.x + lx * f.width * c - ly * f.height * s, f.y + lx * f.width * s + ly * f.height * c, plane))
}

/** Whether a frame, as a view shows it, touches a box on the pane: by the upright box around its corners there. */
function touches(f: Frame, box: { left: number; right: number; top: number; bottom: number }, toPane: (x: number, y: number, plane: Plane) => { x: number; y: number }): boolean {
  const corners = cornersOnPane(f, toPane)
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return Math.min(...xs) <= box.right && Math.max(...xs) >= box.left && Math.min(...ys) <= box.bottom && Math.max(...ys) >= box.top
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
