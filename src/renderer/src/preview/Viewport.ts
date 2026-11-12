import * as THREE from 'three'
import { NO_VIEW, type View } from '../model/sample'

/** Space kept around the camera frame when fitting it to the pane, in pane pixels. */
const PADDING = 40
const MIN_ZOOM = 0.02
const MAX_ZOOM = 32

/**
 * The Three.js view of the world. The camera frame, at project resolution, is what gets
 * rendered to video; the space around it exists so things can live and move off screen.
 * Origin at the scene's middle, y up, pixel units (decision D21). The frame sits where the
 * camera that has the picture puts it, turned and sized as it frames; with no camera, at the
 * scene's middle (D357).
 */
export class Viewport {
  /** Pane pixels per world pixel. */
  zoom = 1
  /** Called after any change of zoom or position. */
  onChange?: () => void
  /** Called before each drawing, with what draws and the camera it draws through: the masks' pictures are made here (D337). */
  beforeRender?: (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void
  /** Scene objects are added here. */
  readonly content = new THREE.Group()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly frame: THREE.Mesh
  private readonly outline: THREE.LineSegments
  private composition = { width: 1920, height: 1080 }
  /** What the frame is cut by: the view of the camera that has the picture (D357). */
  private placed: View = NO_VIEW
  private view = { width: 0, height: 0 }
  /** True once the pane has reported a size. Until then nothing renders or picks. */
  get sized(): boolean {
    return this.view.width > 0 && this.view.height > 0
  }

  /** World point shown at the center of the pane. */
  private center = { x: 0, y: 0 }
  /** True once the user has zoomed or panned since the last fit. Until then, resizes keep fitting. */
  private adjusted = false

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x0e0e0e, 1)

    const unit = new THREE.PlaneGeometry(1, 1)
    this.frame = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0x1c1c1c }))
    this.frame.position.z = -10
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: 0x3a3a3a }))
    this.outline.position.z = -9
    this.scene.add(this.frame, this.outline, this.content)
    this.applyComposition()
  }

  /** The frame's size and the color inside it, the project's background (D131). */
  setComposition(width: number, height: number, background: string): void {
    this.composition = { width, height }
    ;(this.frame.material as THREE.MeshBasicMaterial).color.set(background)
    this.applyComposition()
    this.fit()
  }

  /** Put the frame where a camera frames (D357); the view itself stays where it is. */
  setFrame(view: View): void {
    const p = this.placed
    if (p.x === view.x && p.y === view.y && p.zoom === view.zoom && p.rotation === view.rotation) return
    this.placed = view
    this.applyComposition()
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.view = { width, height }
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    if (this.adjusted) this.updateCamera()
    else this.fit()
  }

  /** Show the project's frame at the scene's middle and the camera's frame where it is now, centered, with padding (D359): with no camera, or one that looks inside the scene, that is the scene as it always was. */
  fit(): void {
    const { width, height } = this.view
    if (width === 0 || height === 0) return
    this.adjusted = false
    const frame = this.fitRect()
    const zoom = Math.min(
      (width - PADDING * 2) / (frame.right - frame.left),
      (height - PADDING * 2) / (frame.top - frame.bottom),
    )
    this.zoom = Math.max(zoom, MIN_ZOOM)
    this.center = { x: (frame.left + frame.right) / 2, y: (frame.top + frame.bottom) / 2 }
    this.updateCamera()
  }

  /** Set the zoom, keeping the pane center fixed. */
  setZoom(zoom: number): void {
    this.zoomAt(zoom / this.zoom, this.view.width / 2, this.view.height / 2)
  }

  /** Multiply the zoom, keeping the world point under the given pane position fixed. */
  zoomAt(factor: number, paneX: number, paneY: number): void {
    this.adjusted = true
    const before = this.toWorld(paneX, paneY)
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor))
    const after = this.toWorld(paneX, paneY)
    this.center.x += before.x - after.x
    this.center.y += before.y - after.y
    this.updateCamera()
  }

  /** Move the view by a number of pane pixels. Positive y moves the view down the world. */
  panBy(paneDx: number, paneDy: number): void {
    this.adjusted = true
    this.center.x += paneDx / this.zoom
    this.center.y -= paneDy / this.zoom
    this.updateCamera()
  }

  /** Put the view's left or top edge at a world coordinate, for the scrollbars (D85). */
  scrollTo(edge: { left?: number; top?: number }): void {
    this.adjusted = true
    if (edge.left !== undefined) this.center.x = edge.left + this.view.width / 2 / this.zoom
    if (edge.top !== undefined) this.center.y = edge.top - this.view.height / 2 / this.zoom
    this.updateCamera()
  }

  /** The world rectangle currently in view. */
  viewRect(): { left: number; right: number; top: number; bottom: number } {
    const halfWidth = this.view.width / 2 / this.zoom
    const halfHeight = this.view.height / 2 / this.zoom
    return { left: this.center.x - halfWidth, right: this.center.x + halfWidth, top: this.center.y + halfHeight, bottom: this.center.y - halfHeight }
  }

  /** The camera frame in world coordinates: the upright box around it, where the camera puts it. */
  frameRect(): { left: number; right: number; top: number; bottom: number } {
    const v = this.placed
    const a = (v.rotation * Math.PI) / 180
    const w = this.composition.width / v.zoom
    const h = this.composition.height / v.zoom
    const halfWidth = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
    const halfHeight = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2
    return { left: v.x - halfWidth, right: v.x + halfWidth, top: v.y + halfHeight, bottom: v.y - halfHeight }
  }

  /** What Fit shows: the box around the project's frame at the scene's middle and the camera's frame. */
  fitRect(): { left: number; right: number; top: number; bottom: number } {
    const a = this.sceneRect()
    const b = this.frameRect()
    return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) }
  }

  /** The project's frame at the scene's middle, whatever a camera frames. */
  sceneRect(): { left: number; right: number; top: number; bottom: number } {
    return { left: -this.composition.width / 2, right: this.composition.width / 2, top: this.composition.height / 2, bottom: -this.composition.height / 2 }
  }

  /** World coordinates of a pane position. */
  toWorld(paneX: number, paneY: number): { x: number; y: number } {
    return {
      x: (paneX - this.view.width / 2) / this.zoom + this.center.x,
      y: -(paneY - this.view.height / 2) / this.zoom + this.center.y,
    }
  }

  /** The pane position of a place in the world: the inverse of `toWorld`. */
  toPane(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.center.x) * this.zoom + this.view.width / 2, y: -(y - this.center.y) * this.zoom + this.view.height / 2 }
  }

  /** Normalized device coordinates of a pane position, for picking. */
  toNdc(paneX: number, paneY: number): THREE.Vector2 {
    return new THREE.Vector2((paneX / Math.max(1, this.view.width)) * 2 - 1, -(paneY / Math.max(1, this.view.height)) * 2 + 1)
  }

  render(): void {
    if (this.view.width === 0 || this.view.height === 0) return
    this.beforeRender?.(this.renderer, this.camera)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  private applyComposition(): void {
    const { width, height } = this.composition
    const v = this.placed
    const turn = (v.rotation * Math.PI) / 180
    for (const [mesh, z] of [[this.frame, -10], [this.outline, -9]] as const) {
      mesh.scale.set(width / v.zoom, height / v.zoom, 1)
      mesh.position.set(v.x, v.y, z)
      mesh.rotation.z = turn
    }
  }

  private updateCamera(): void {
    const { width, height } = this.view
    if (width === 0 || height === 0) return
    const halfWidth = width / 2 / this.zoom
    const halfHeight = height / 2 / this.zoom
    this.camera.left = -halfWidth
    this.camera.right = halfWidth
    this.camera.top = halfHeight
    this.camera.bottom = -halfHeight
    this.camera.position.set(this.center.x, this.center.y, 100)
    this.camera.updateProjectionMatrix()
    this.render()
    this.onChange?.()
  }
}
