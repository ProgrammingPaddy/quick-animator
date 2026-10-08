import * as THREE from 'three'

/** Space kept around the camera frame when fitting it to the pane, in pane pixels. */
const PADDING = 40
const MIN_ZOOM = 0.02
const MAX_ZOOM = 32

/**
 * The Three.js view of the world. The camera frame, at project resolution, is what gets
 * rendered to video; the space around it exists so things can live and move off screen.
 * Origin at the frame center, y up, pixel units (decision D21).
 */
export class Viewport {
  /** Pane pixels per world pixel. */
  zoom = 1
  /** Called after any change of zoom or position. */
  onChange?: () => void
  /** Scene objects are added here. */
  readonly content = new THREE.Group()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly frame: THREE.Mesh
  private readonly outline: THREE.LineSegments
  private composition = { width: 1920, height: 1080 }
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

  setComposition(width: number, height: number): void {
    this.composition = { width, height }
    this.applyComposition()
    this.fit()
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.view = { width, height }
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    if (this.adjusted) this.updateCamera()
    else this.fit()
  }

  /** Show the whole camera frame, centered, with padding. */
  fit(): void {
    const { width, height } = this.view
    if (width === 0 || height === 0) return
    this.adjusted = false
    const zoom = Math.min(
      (width - PADDING * 2) / this.composition.width,
      (height - PADDING * 2) / this.composition.height,
    )
    this.zoom = Math.max(zoom, MIN_ZOOM)
    this.center = { x: 0, y: 0 }
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

  /** The world rectangle currently in view. */
  viewRect(): { left: number; right: number; top: number; bottom: number } {
    const halfWidth = this.view.width / 2 / this.zoom
    const halfHeight = this.view.height / 2 / this.zoom
    return { left: this.center.x - halfWidth, right: this.center.x + halfWidth, top: this.center.y + halfHeight, bottom: this.center.y - halfHeight }
  }

  /** The camera frame in world coordinates. */
  frameRect(): { left: number; right: number; top: number; bottom: number } {
    return { left: -this.composition.width / 2, right: this.composition.width / 2, top: this.composition.height / 2, bottom: -this.composition.height / 2 }
  }

  /** World coordinates of a pane position. */
  toWorld(paneX: number, paneY: number): { x: number; y: number } {
    return {
      x: (paneX - this.view.width / 2) / this.zoom + this.center.x,
      y: -(paneY - this.view.height / 2) / this.zoom + this.center.y,
    }
  }

  /** Normalized device coordinates of a pane position, for picking. */
  toNdc(paneX: number, paneY: number): THREE.Vector2 {
    return new THREE.Vector2((paneX / Math.max(1, this.view.width)) * 2 - 1, -(paneY / Math.max(1, this.view.height)) * 2 + 1)
  }

  render(): void {
    if (this.view.width === 0 || this.view.height === 0) return
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.dispose()
  }

  private applyComposition(): void {
    const { width, height } = this.composition
    this.frame.scale.set(width, height, 1)
    this.outline.scale.set(width, height, 1)
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
