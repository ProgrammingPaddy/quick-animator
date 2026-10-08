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

const unitPlane = new THREE.PlaneGeometry(1, 1)
const unitCircle = new THREE.CircleGeometry(1, 96)
/** Canvas pixels per world pixel for text, so it stays crisp when zoomed in. */
const TEXT_SCALE = 2
const ACCENT = 0x3b82f6

function ringGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

/** Draws the scene model at a time into a Three.js group, and picks objects under the pointer. */
export class SceneRenderer {
  readonly group = new THREE.Group()
  private readonly items = new Map<string, Item>()
  private readonly selectionBox: THREE.LineSegments
  private readonly rotateRing: THREE.LineLoop
  private readonly corners: THREE.Mesh[] = []
  private readonly raycaster = new THREE.Raycaster()

  constructor() {
    const lineMaterial = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false })
    this.selectionBox = new THREE.LineSegments(new THREE.EdgesGeometry(unitPlane), lineMaterial)
    this.selectionBox.renderOrder = 1_000_000
    this.selectionBox.visible = false
    this.rotateRing = new THREE.LineLoop(ringGeometry(), lineMaterial)
    this.rotateRing.renderOrder = 1_000_000
    this.rotateRing.visible = false
    const cornerMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false })
    for (let i = 0; i < 4; i++) {
      const corner = new THREE.Mesh(unitPlane, cornerMaterial)
      corner.renderOrder = 1_000_001
      corner.visible = false
      this.corners.push(corner)
    }
    this.group.add(this.selectionBox, this.rotateRing, ...this.corners)
  }

  /**
   * Draw the model at a time, with the selection shown for the transform mode: a box to move,
   * a ring to rotate, corner handles to scale. `handleSize` is in world pixels.
   */
  update(model: SceneModel | null, time: number, selection: string[], mode: TransformMode = 'move', handleSize = 8): void {
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
    const selected = selection.length === 1 ? this.items.get(selection[0]!) : undefined
    const show = !!selected && selected.mesh.visible
    this.selectionBox.visible = show && mode !== 'rotate'
    this.rotateRing.visible = show && mode === 'rotate'
    for (const corner of this.corners) corner.visible = show && mode === 'scale'
    if (!selected || !show) return
    const { position, rotation, scale } = selected.mesh
    this.selectionBox.position.set(position.x, position.y, position.z + 0.5)
    this.selectionBox.rotation.copy(rotation)
    this.selectionBox.scale.copy(scale)
    const radius = Math.hypot(scale.x, scale.y) / 2
    this.rotateRing.position.set(position.x, position.y, position.z + 0.5)
    this.rotateRing.scale.set(radius, radius, 1)
    this.corners.forEach((corner, i) => {
      const sx = i % 2 === 0 ? -0.5 : 0.5
      const sy = i < 2 ? -0.5 : 0.5
      const local = new THREE.Vector3(sx * scale.x, sy * scale.y, 0).applyEuler(rotation)
      corner.position.set(position.x + local.x, position.y + local.y, position.z + 0.6)
      corner.rotation.copy(rotation)
      corner.scale.set(handleSize, handleSize, 1)
    })
  }

  /** The box around every visible object, ignoring rotation, or null when nothing is visible. */
  bounds(): { left: number; right: number; top: number; bottom: number } | null {
    let box: { left: number; right: number; top: number; bottom: number } | null = null
    for (const item of this.items.values()) {
      if (!item.mesh.visible) continue
      const { x, y } = item.mesh.position
      const halfWidth = Math.abs(item.mesh.scale.x) / 2
      const halfHeight = Math.abs(item.mesh.scale.y) / 2
      const left = x - halfWidth
      const right = x + halfWidth
      const top = y + halfHeight
      const bottom = y - halfHeight
      box = box ? { left: Math.min(box.left, left), right: Math.max(box.right, right), top: Math.max(box.top, top), bottom: Math.min(box.bottom, bottom) } : { left, right, top, bottom }
    }
    return box
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
