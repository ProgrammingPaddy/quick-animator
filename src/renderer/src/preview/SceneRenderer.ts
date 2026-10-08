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

/** A grab point of the selection gizmo: a corner or edge that resizes, or the handle that rotates (D86). */
export type Handle = { kind: 'resize'; sx: -1 | 0 | 1; sy: -1 | 0 | 1 } | { kind: 'rotate' }

/** Where an object is drawn right now: center, rotation in degrees, and drawn size in world pixels. */
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
const unitCircle = new THREE.CircleGeometry(1, 96)
/** Canvas pixels per world pixel for text, so it stays crisp when zoomed in. */
const TEXT_SCALE = 2
const ACCENT = 0x3b82f6
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
const ROTATE_PX = 10

function ringGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

/** Draws the scene model at a time into a Three.js group, draws the selection gizmo, and picks. */
export class SceneRenderer {
  readonly group = new THREE.Group()
  private readonly items = new Map<string, Item>()
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false })
  private readonly handleMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false })
  private readonly boxes: THREE.LineSegments[] = []
  private readonly rotateRing: THREE.LineLoop
  private readonly resizeHandles: THREE.Mesh[] = []
  private readonly rotateHandle: THREE.Mesh
  private readonly stem: THREE.Line
  /** The handles shown right now, with their world positions, for picking. */
  private handles: { handle: Handle; x: number; y: number; radius: number }[] = []
  private readonly raycaster = new THREE.Raycaster()

  constructor() {
    this.rotateRing = new THREE.LineLoop(ringGeometry(), this.lineMaterial)
    this.rotateRing.renderOrder = 1_000_000
    this.rotateRing.visible = false
    for (const spec of RESIZE_HANDLES) {
      const handle = new THREE.Mesh(unitPlane, this.handleMaterial)
      handle.renderOrder = 1_000_001
      handle.visible = false
      handle.userData['handle'] = spec
      this.resizeHandles.push(handle)
    }
    this.rotateHandle = new THREE.Mesh(unitCircle, this.handleMaterial)
    this.rotateHandle.renderOrder = 1_000_001
    this.rotateHandle.visible = false
    this.stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), this.lineMaterial)
    this.stem.renderOrder = 1_000_000
    this.stem.visible = false
    this.group.add(this.rotateRing, ...this.resizeHandles, this.rotateHandle, this.stem)
  }

  private box(index: number): THREE.LineSegments {
    while (this.boxes.length <= index) {
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(unitPlane), this.lineMaterial)
      box.renderOrder = 1_000_000
      this.group.add(box)
      this.boxes.push(box)
    }
    return this.boxes[index]!
  }

  /**
   * Draw the model at a time, with a box around every selected object and, for a single
   * selection, the handles of the mode. `pixel` is the world size of one screen pixel.
   */
  update(model: SceneModel | null, time: number, selection: string[], mode: TransformMode = 'all', pixel = 1): void {
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

    const selected = selection.map((n) => this.items.get(n)).filter((i): i is Item => !!i && i.mesh.visible)
    selected.forEach((item, i) => {
      const box = this.box(i)
      const { position, rotation, scale } = item.mesh
      box.visible = true
      box.position.set(position.x, position.y, position.z + 0.5)
      box.rotation.copy(rotation)
      box.scale.copy(scale)
    })
    for (let i = selected.length; i < this.boxes.length; i++) this.boxes[i]!.visible = false

    const single = selected.length === 1 ? selected[0]! : null
    const showRing = !!single && mode === 'rotate'
    const showResize = !!single && (mode === 'resize' || mode === 'all')
    const showRotate = !!single && mode === 'all'
    this.rotateRing.visible = showRing
    this.rotateHandle.visible = showRotate
    this.stem.visible = showRotate
    for (const handle of this.resizeHandles) handle.visible = showResize
    this.handles = []
    if (!single) return
    const { position, rotation, scale } = single.mesh
    const z = position.z + 0.6
    const w = Math.abs(scale.x)
    const h = Math.abs(scale.y)
    const cos = Math.cos(rotation.z)
    const sin = Math.sin(rotation.z)
    const local = (lx: number, ly: number) => ({ x: position.x + lx * cos - ly * sin, y: position.y + lx * sin + ly * cos })
    if (showRing) {
      const radius = Math.hypot(w, h) / 2
      this.rotateRing.position.set(position.x, position.y, z)
      this.rotateRing.scale.set(radius, radius, 1)
    }
    if (showResize) {
      this.resizeHandles.forEach((mesh, i) => {
        const { sx, sy } = RESIZE_HANDLES[i]!
        const p = local((sx * w) / 2, (sy * h) / 2)
        const size = (sx !== 0 && sy !== 0 ? CORNER_PX : EDGE_PX) * pixel
        mesh.position.set(p.x, p.y, z)
        mesh.rotation.copy(rotation)
        mesh.scale.set(size, size, 1)
        this.handles.push({ handle: { kind: 'resize', sx, sy }, x: p.x, y: p.y, radius: Math.max(size, 8 * pixel) })
      })
    }
    if (showRotate) {
      const p = local(0, h / 2 + ROTATE_OFFSET * pixel)
      const radius = (ROTATE_PX * pixel) / 2
      this.rotateHandle.position.set(p.x, p.y, z)
      this.rotateHandle.scale.set(radius, radius, 1)
      const top = local(0, h / 2)
      this.stem.position.set(top.x, top.y, z)
      this.stem.rotation.z = rotation.z
      this.stem.scale.set(1, ROTATE_OFFSET * pixel, 1)
      this.handles.push({ handle: { kind: 'rotate' }, x: p.x, y: p.y, radius: ROTATE_PX * pixel })
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

  /** Where a visible object is drawn right now, or null. */
  frameOf(name: string): Frame | null {
    const item = this.items.get(name)
    if (!item || !item.mesh.visible) return null
    const { position, rotation, scale } = item.mesh
    return { x: position.x, y: position.y, rotation: (rotation.z * 180) / Math.PI, width: Math.abs(scale.x), height: Math.abs(scale.y) }
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
      if (!b) continue
      box = box ? { left: Math.min(box.left, b.left), right: Math.max(box.right, b.right), top: Math.max(box.top, b.top), bottom: Math.min(box.bottom, b.bottom) } : b
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
      const radius = num('radius')
      item.width = radius * 2
      item.height = radius * 2
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
