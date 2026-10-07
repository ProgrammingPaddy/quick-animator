import * as THREE from 'three'
import { isVisibleAt, lifetimeOpacity, parseColor, valueAt } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'

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

/** Draws the scene model at a time into a Three.js group, and picks objects under the pointer. */
export class SceneRenderer {
  readonly group = new THREE.Group()
  private readonly items = new Map<string, Item>()
  private readonly selectionBox: THREE.LineSegments
  private readonly raycaster = new THREE.Raycaster()

  constructor() {
    this.selectionBox = new THREE.LineSegments(new THREE.EdgesGeometry(unitPlane), new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false }))
    this.selectionBox.renderOrder = 1_000_000
    this.selectionBox.visible = false
    this.group.add(this.selectionBox)
  }

  update(model: SceneModel | null, time: number, selection: string[]): void {
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
    if (selected && selected.mesh.visible) {
      this.selectionBox.visible = true
      this.selectionBox.position.copy(selected.mesh.position)
      this.selectionBox.position.z += 0.5
      this.selectionBox.rotation.copy(selected.mesh.rotation)
      this.selectionBox.scale.copy(selected.mesh.scale)
    } else {
      this.selectionBox.visible = false
    }
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
    const material = mesh.material as THREE.MeshBasicMaterial
    const num = (attr: string): number => {
      const v = valueAt(model, obj, attr, time)
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
    const str = (attr: string): string => String(valueAt(model, obj, attr, time))

    const opacity = Math.max(0, Math.min(1, num('opacity'))) * lifetimeOpacity(obj, time)
    mesh.visible = isVisibleAt(obj, time) && opacity > 0
    mesh.renderOrder = index
    mesh.position.set(num('x'), num('y'), num('z'))
    mesh.rotation.z = (num('rotation') * Math.PI) / 180
    material.opacity = opacity

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
