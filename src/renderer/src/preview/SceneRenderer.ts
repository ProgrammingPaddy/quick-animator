import * as THREE from 'three'
import { isVisibleAt, parseColor, valueAt } from '../model/sample'
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

/** A grab point of the selection gizmo: a corner or edge that resizes, the handle that rotates, or the armed pivot (D86, D112). */
export type Handle = { kind: 'resize'; sx: -1 | 0 | 1; sy: -1 | 0 | 1 } | { kind: 'rotate' } | { kind: 'pivot' }

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

/** The center rotations turn around: where it is, and whether a double-click armed it for dragging (D112). */
export interface Pivot {
  x: number
  y: number
  armed: boolean
}

const unitPlane = new THREE.PlaneGeometry(1, 1)
// Both unit shapes are one world pixel across, so an object's drawn size is its scale.
const unitCircle = new THREE.CircleGeometry(0.5, 96)
/** Canvas pixels per world pixel for text, so it stays crisp when zoomed in. */
const TEXT_SCALE = 2
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
const ACCENT = 0x3b82f6
/** Gizmo render order: after every object, which are all drawn in the transparent pass. */
const ORDER = 1_000_000
/** Screen pixels: the white line, and the dark rim added on each side. */
const LINE_PX = 1.5
const RIM_PX = 1

// The gizmo materials are transparent so Three.js draws them with, and after, the objects: an
// opaque material would be drawn first and then painted over by any object (D94).
const lightMaterial = new THREE.MeshBasicMaterial({ color: LIGHT, depthTest: false, transparent: true })
const darkMaterial = new THREE.MeshBasicMaterial({ color: DARK, depthTest: false, transparent: true })
const accentMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true })
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

/** A thin x of two strokes, white with a dark rim, blue when armed: the pivot (D112). */
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

  set(x: number, y: number, length: number, pixel: number, armed: boolean): void {
    this.group.visible = true
    this.group.position.set(x, y, 0.8)
    const line = LINE_PX * pixel
    const rim = line + RIM_PX * 2 * pixel
    for (let i = 0; i < 2; i++) {
      this.dark[i]!.scale.set(length + rim, rim, 1)
      this.light[i]!.scale.set(length, line, 1)
      this.light[i]!.material = armed ? accentMaterial : lightMaterial
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
  private readonly pivotCross = new Cross()
  private readonly stem: THREE.Mesh
  /** The handles shown right now, with their world positions, for picking. */
  private handles: { handle: Handle; x: number; y: number; radius: number }[] = []
  /** Where the pivot is drawn, armed or not, for the double-click that arms it. */
  private pivotAt: { x: number; y: number; radius: number } | null = null
  private readonly raycaster = new THREE.Raycaster()

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
    this.group.add(this.gizmoOutline.group, this.rotateRing, this.rotateHandle.group, this.pivotCross.group, this.stem)
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
   * the gizmo frame: the object's own frame for one object, the box around all of them, turned by
   * `groupRotation`, for several (D96, D116). `pixel` is the world size of one screen pixel.
   */
  update(model: SceneModel | null, time: number, selection: string[], mode: TransformMode = 'all', pixel = 1, pivot: Pivot | null = null, groupRotation = 0): void {
    const seen = new Set<string>()
    if (model) {
      model.objects.forEach((obj, index) => {
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

    const selected = selection.filter((n) => this.items.get(n)?.mesh.visible)
    selected.forEach((name, i) => this.outline(i).set(this.frameOf(name)!, pixel))
    for (let i = selected.length; i < this.outlines.length; i++) this.outlines[i]!.hide()

    const frame = selected.length === 1 ? this.frameOf(selected[0]!) : selected.length > 1 ? this.groupFrame(selected, groupRotation) : null
    const showRing = !!frame && mode === 'rotate'
    const showResize = !!frame && (mode === 'resize' || mode === 'all')
    const showRotate = !!frame && mode === 'all'
    const showPivot = !!frame && (mode === 'all' || mode === 'rotate')
    this.rotateRing.visible = showRing
    this.stem.visible = showRotate
    if (!showRotate) this.rotateHandle.hide()
    if (!showPivot) this.pivotCross.hide()
    if (!showResize) for (const handle of this.resizeHandles) handle.hide()
    if (selected.length > 1 && frame) this.gizmoOutline.set(frame, pixel)
    else this.gizmoOutline.hide()
    this.handles = []
    this.pivotAt = null
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
    if (showPivot) {
      const p = pivot ?? { x: frame.x, y: frame.y, armed: false }
      this.pivotCross.set(p.x, p.y, (p.armed ? PIVOT_PX + 4 : PIVOT_PX) * pixel, pixel, p.armed)
      this.pivotAt = { x: p.x, y: p.y, radius: 10 * pixel }
      // Only an armed pivot is a handle; otherwise a drag from the center moves the object (D112).
      if (p.armed) this.handles.push({ handle: { kind: 'pivot' }, x: p.x, y: p.y, radius: 12 * pixel })
    }
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

  /** True when a world position is on the pivot cross, armed or not. */
  onPivot(world: { x: number; y: number }): boolean {
    const p = this.pivotAt
    return !!p && Math.hypot(world.x - p.x, world.y - p.y) <= p.radius
  }

  /** Where a visible object is drawn right now, or null. */
  frameOf(name: string): Frame | null {
    const item = this.items.get(name)
    if (!item || !item.mesh.visible) return null
    const { position, rotation, scale } = item.mesh
    return { x: position.x, y: position.y, rotation: (rotation.z * 180) / Math.PI, width: Math.abs(scale.x), height: Math.abs(scale.y) }
  }

  /**
   * The box around several visible objects, as a frame turned by `rotation` degrees: the
   * tightest box with those axes, so a turned group keeps a box that turns with it (D116).
   */
  groupFrame(names: string[], rotation = 0): Frame | null {
    const a = (rotation * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const name of names) {
      const f = this.frameOf(name)
      if (!f) continue
      const fa = (f.rotation * Math.PI) / 180
      const fc = Math.cos(fa)
      const fs = Math.sin(fa)
      for (const [lx, ly] of [
        [-f.width / 2, -f.height / 2],
        [f.width / 2, -f.height / 2],
        [-f.width / 2, f.height / 2],
        [f.width / 2, f.height / 2],
      ]) {
        const wx = f.x + lx! * fc - ly! * fs
        const wy = f.y + lx! * fs + ly! * fc
        const u = wx * cos + wy * sin
        const v = -wx * sin + wy * cos
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
    }
    if (!Number.isFinite(minU)) return null
    const cu = (minU + maxU) / 2
    const cv = (minV + maxV) / 2
    return { x: cu * cos - cv * sin, y: cu * sin + cv * cos, rotation, width: maxU - minU, height: maxV - minV }
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
    mesh.position.set(num('x'), num('y'), num('z'))
    mesh.rotation.z = (num('rotation') * Math.PI) / 180
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
    const scale = num('scale')
    mesh.scale.set(item.width * scale, item.height * scale, 1)
  }

  private applyText(item: Item, text: string, fontSize: number, font: string, fill: string): void {
    const key = [text, fontSize, font, fill].join('\u0000')
    if (item.textKey === key) return
    item.textKey = key
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const px = Math.max(1, fontSize) * TEXT_SCALE
    const fontSpec = `${px}px "${font}", "Segoe UI", sans-serif`
    ctx.font = fontSpec
    const metrics = ctx.measureText(text || ' ')
    const ascent = metrics.actualBoundingBoxAscent || px * 0.8
    const descent = metrics.actualBoundingBoxDescent || px * 0.2
    const pad = px * 0.1
    canvas.width = Math.max(1, Math.ceil(metrics.width + pad * 2))
    canvas.height = Math.max(1, Math.ceil(ascent + descent + pad * 2))
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
