import * as THREE from 'three'
import { groupMembers } from '../model/groups'
import { GROUP } from '../model/registry'
import { groupBox, isVisibleAt, parseColor, textMeasurer, valueAt, worldPose } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import type { TransformMode } from '../state/store'

interface Item {
  mesh: THREE.Mesh
  className: string
  /** Unscaled size in world pixels, for the selection box. */
  width: number
  height: number
  textKey?: string
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

interface TextMetrics {
  fontSpec: string
  width: number
  height: number
  ascent: number
  pad: number
}

const metricsCache = new Map<string, TextMetrics>()
let measuringContext: CanvasRenderingContext2D | null = null

/** The canvas pixels a text takes at a font size, measured once per text. */
function textMetrics(text: string, fontSize: number, font: string): TextMetrics {
  const key = [text, fontSize, font].join('\u0000')
  const cached = metricsCache.get(key)
  if (cached) return cached
  if (!measuringContext) measuringContext = document.createElement('canvas').getContext('2d')
  const px = Math.max(1, fontSize) * TEXT_SCALE
  const fontSpec = `${px}px "${font}", "Segoe UI", sans-serif`
  let width = px * 0.55 * Math.max(1, text.length)
  let ascent = px * 0.8
  let descent = px * 0.2
  if (measuringContext) {
    measuringContext.font = fontSpec
    const m = measuringContext.measureText(text || ' ')
    width = m.width
    ascent = m.actualBoundingBoxAscent || ascent
    descent = m.actualBoundingBoxDescent || descent
  }
  const pad = px * 0.1
  const metrics: TextMetrics = { fontSpec, width: Math.max(1, Math.ceil(width + pad * 2)), height: Math.max(1, Math.ceil(ascent + descent + pad * 2)), ascent, pad }
  if (metricsCache.size > 2000) metricsCache.clear()
  metricsCache.set(key, metrics)
  return metrics
}

// The sampler frames groups with the same measurements the renderer draws with.
textMeasurer.current = (text, fontSize, font) => {
  const m = textMetrics(text, fontSize, font)
  return { width: m.width / TEXT_SCALE, height: m.height / TEXT_SCALE }
}
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

function ringGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

/** Draws the scene model at a time into a Three.js group, draws the selection gizmo above it, and picks. */
export class SceneRenderer {
  readonly group = new THREE.Group()
  private readonly items = new Map<string, Item>()
  private readonly outlines: Outline[] = []
  private readonly gizmoOutline = new Outline()
  private readonly rotateRing: THREE.LineLoop
  private readonly resizeHandles: Marker[] = []
  private readonly rotateHandle = new Marker(unitCircle)
  private readonly anchorCross = new Cross()
  private readonly stem: THREE.Mesh
  /** The handles shown right now, with their world positions, for picking. */
  private handles: { handle: Handle; x: number; y: number; radius: number }[] = []
  private readonly raycaster = new THREE.Raycaster()
  /** What was last drawn, for the frames of groups. */
  private model: SceneModel | null = null
  private time = 0

  constructor() {
    this.rotateRing = new THREE.LineLoop(ringGeometry(), ringMaterial)
    this.rotateRing.renderOrder = ORDER + 1
    this.rotateRing.visible = false
    for (let i = 0; i < RESIZE_HANDLES.length; i++) {
      const marker = new Marker(unitPlane)
      this.resizeHandles.push(marker)
      this.group.add(marker.group)
    }
    this.stem = new THREE.Mesh(unitPlane, lightMaterial)
    this.stem.renderOrder = ORDER + 1
    this.stem.visible = false
    this.group.add(this.gizmoOutline.group, this.rotateRing, this.rotateHandle.group, this.anchorCross.group, this.stem)
  }

  private outline(index: number): Outline {
    while (this.outlines.length <= index) {
      const outline = new Outline()
      this.group.add(outline.group)
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
  update(model: SceneModel | null, time: number, selection: string[], mode: TransformMode = 'all', pixel = 1, axes = 0): void {
    this.model = model
    this.time = time
    const seen = new Set<string>()
    if (model) {
      model.objects.forEach((obj, index) => {
        if (obj.className === GROUP) return
        seen.add(obj.name)
        this.apply(this.ensure(obj), obj, model, time, index)
      })
    }
    for (const [name, item] of this.items) {
      if (seen.has(name)) continue
      this.group.remove(item.mesh)
      disposeItem(item)
      this.items.delete(name)
    }

    const group = selection.length === 1 && model ? (model.objects.find((o) => o.name === selection[0] && o.className === GROUP) ?? null) : null
    const outlined = (group && model ? groupMembers(model, group.name) : selection).filter((n) => this.items.get(n)?.mesh.visible)
    outlined.forEach((name, i) => this.outline(i).set(this.frameOf(name)!, pixel))
    for (let i = outlined.length; i < this.outlines.length; i++) this.outlines[i]!.hide()

    // A group's box is in the code; a plain turn of an ad-hoc selection leaves its box on the turned axes until the selection changes (D116).
    const frame = group ? this.frameOf(group.name) : outlined.length === 1 ? this.frameOf(outlined[0]!) : outlined.length > 1 ? this.boxAround(outlined, axes) : null
    const showRing = !!frame && mode === 'rotate'
    const showResize = !!frame && (mode === 'resize' || mode === 'all')
    const showRotate = !!frame && mode === 'all'
    const showAnchor = !!frame && !!group && (mode === 'all' || mode === 'rotate')
    this.rotateRing.visible = showRing
    this.stem.visible = showRotate
    if (!showRotate) this.rotateHandle.hide()
    if (!showAnchor) this.anchorCross.hide()
    if (!showResize) for (const handle of this.resizeHandles) handle.hide()
    if ((group || outlined.length > 1) && frame) this.gizmoOutline.set(frame, pixel)
    else this.gizmoOutline.hide()
    this.handles = []
    if (!frame) return
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

  /** Where a visible object, or a group, is drawn right now, or null. */
  frameOf(name: string): Frame | null {
    const item = this.items.get(name)
    if (item) {
      if (!item.mesh.visible) return null
      const { position, rotation, scale } = item.mesh
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
      const b = this.boxOf(name)
      if (b && b.left <= box.right && b.right >= box.left && b.bottom <= box.top && b.top >= box.bottom) names.push(name)
    }
    return names
  }

  /** The name of the topmost visible object under a normalized device coordinate, or null. */
  pick(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, camera)
    const meshes = [...this.items.values()].filter((i) => i.mesh.visible).map((i) => i.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return null
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder)
    const name = hits[0]!.object.userData['name']
    return typeof name === 'string' ? name : null
  }

  private ensure(obj: SceneObject): Item {
    let item = this.items.get(obj.name)
    if (item && item.className !== obj.className) {
      this.group.remove(item.mesh)
      disposeItem(item)
      item = undefined
    }
    if (!item) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false })
      const mesh = new THREE.Mesh(obj.className === 'Circle' ? unitCircle : unitPlane, material)
      mesh.userData['name'] = obj.name
      item = { mesh, className: obj.className, width: 1, height: 1 }
      this.items.set(obj.name, item)
      this.group.add(mesh)
    }
    return item
  }

  private apply(item: Item, obj: SceneObject, model: SceneModel, time: number, index: number): void {
    const mesh = item.mesh
    // An object with zero opacity does not exist right now: nothing else about it is sampled.
    if (!isVisibleAt(model, obj, time)) {
      mesh.visible = false
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
    material.opacity = Math.max(0, Math.min(1, num('opacity')))

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
      this.applyText(item, str('text'), num('fontSize'), str('font'), str('fill'))
    }
    mesh.scale.set(item.width * pose.scale, item.height * pose.scale, 1)
  }

  private applyText(item: Item, text: string, fontSize: number, font: string, fill: string): void {
    const key = [text, fontSize, font, fill].join('\u0000')
    if (item.textKey === key) return
    item.textKey = key
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { fontSpec, width, height, ascent, pad } = textMetrics(text, fontSize, font)
    canvas.width = width
    canvas.height = height
    ctx.font = fontSpec
    ctx.fillStyle = parseColor(fill) ? fill : '#ffffff'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, pad, pad + ascent)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const material = item.mesh.material as THREE.MeshBasicMaterial
    material.map?.dispose()
    material.map = texture
    material.color.set(0xffffff)
    material.needsUpdate = true
    item.width = canvas.width / TEXT_SCALE
    item.height = canvas.height / TEXT_SCALE
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
}
