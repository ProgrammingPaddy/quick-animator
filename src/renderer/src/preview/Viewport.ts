import * as THREE from 'three'
import { frameOf, NORMAL_LENS, SENSOR, type Vec3, type View } from '../model/lens'
import { NO_VIEW } from '../model/sample'
import { across, SurfaceBase, TURNED_LAYER, vectorsOf, type Plane } from './planes'

/** Space kept around the camera frame when fitting it to the pane, in pane pixels. */
const PADDING = 40
const MIN_ZOOM = 0.02
const MAX_ZOOM = 32
/** How far behind what it looks at a view drawn without perspective stands, in the scene's pixels: farther than anything is. */
const STAND_BACK = 1e6
/** How far a drag turns a view or a camera that goes round, in degrees for a pane pixel (D428). */
export const ROUND_RATE = 0.3
/** An upright box in the scene. */
export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * What a gesture needs of a view of the scene (D366, D434): the Preview view, or the Camera view,
 * which looks through the camera. Places on the pane are from the preview's top left corner in
 * both, so what is drawn over the pane, a box, a trail, sits where the pointer is in either.
 * Places in the scene are places on the plane in hand, the plane of what is being worked on.
 */
export interface Surface {
  /** Pane pixels per pixel of the scene, on the plane in hand. */
  readonly zoom: number
  /** How far the view is rolled from the scene's own axes, in degrees. */
  readonly turn: number
  readonly camera: THREE.Camera
  /** The plane in hand: what is worked on lies in it. */
  plane: Plane
  /** Whether the planes of one depth face the view, so a drag across it is a drag across them. */
  readonly straight: boolean
  toWorld(paneX: number, paneY: number): { x: number; y: number }
  toPane(x: number, y: number, plane?: Plane): { x: number; y: number }
  toNdc(paneX: number, paneY: number): THREE.Vector2
  /** How far a drag of so many pane pixels goes on the plane in hand. */
  delta(dx: number, dy: number): { x: number; y: number }
  /** Pane pixels per pixel of the scene at a place on a plane. */
  zoomOn(x: number, y: number, plane: Plane): number
  ray(paneX: number, paneY: number): THREE.Ray
  project(place: THREE.Vector3): { x: number; y: number } | null
  scaleAt(place: THREE.Vector3): number
  axes(): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }
  /** How far a thing at a place goes as the pointer goes from one place on the pane to another, in the plane that faces the view (D430). */
  carry(fromX: number, fromY: number, toX: number, toY: number, at: THREE.Vector3): THREE.Vector3
  /** The upright box around what the view shows. */
  viewRect(): Rect
  frameRect(): Rect
  sceneRect(): Rect
}

const quarter = (degrees: number): boolean => Math.abs(degrees / 90 - Math.round(degrees / 90)) < 1e-9

/**
 * The Three.js view of the world: the Preview view (D428). The camera frame, at project
 * resolution, is what gets rendered to video; the space around it exists so things can live and
 * move off screen. Origin at the scene's middle, y up, pixel units (decision D21). The frame sits
 * where the camera that has the picture puts it, turned and sized as it frames; with no camera,
 * at the scene's middle (D357).
 *
 * It is a view of the scene and no camera: it looks at a place from a side, as close as its zoom,
 * and nothing it does is written. From the front it is the flat view it always was. Looking
 * straight along an axis, from the front, a side, or above, it is drawn without perspective, so a
 * thing is its own size at any depth; turned any other way it has the perspective of a 50 mm lens
 * across the pane, as a 3D program's view does when it is orbited (D430).
 */
export class Viewport extends SurfaceBase implements Surface {
  /** The Preview view is never rolled. */
  readonly turn = 0
  /** Called after any change of zoom or position. */
  onChange?: () => void
  /** Called before each drawing, with what draws and the camera it draws through: the masks' pictures are made here (D337). */
  beforeRender?: (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void
  /** Scene objects are added here. */
  readonly content = new THREE.Group()

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly frame: THREE.Mesh
  private readonly outline: THREE.LineSegments
  private readonly level3 = new THREE.PerspectiveCamera(40, 1, 1, 1e7)
  private readonly level2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, STAND_BACK * 2)
  private composition = { width: 1920, height: 1080 }
  /** What the frame is cut by: the view of the camera that has the picture (D357). */
  private placed: View = NO_VIEW
  private view = { width: 0, height: 0 }
  /** True once the pane has reported a size. Until then nothing renders or picks. */
  get sized(): boolean {
    return this.view.width > 0 && this.view.height > 0
  }

  /** The place of the scene at the middle of the pane, which the view goes round. */
  private readonly target = new THREE.Vector3(0, 0, 0)
  /** The side it looks from, in degrees, as a camera's pan and tilt are told: 0 and 0 is the front. */
  private yaw = 0
  private pitch = 0
  /** Pane pixels per pixel of the scene, where the view looks. */
  private level = 1
  /** True once the user has zoomed or panned since the last fit. Until then, resizes keep fitting. */
  private adjusted = false
  /** The places of the scene Fit last showed, which a resize goes on showing until the view is zoomed or moved. */
  private fittedTo: THREE.Vector3[] | null = null

  constructor(canvas: HTMLCanvasElement) {
    super()
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x0e0e0e, 1)

    const unit = new THREE.PlaneGeometry(1, 1)
    this.frame = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0x1c1c1c, side: THREE.DoubleSide }))
    // The line lies on the frame it edges, so it is drawn after it and over it whatever their depths say.
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit), new THREE.LineBasicMaterial({ color: 0x3a3a3a, depthTest: false }))
    this.outline.renderOrder = 1
    this.scene.add(this.frame, this.outline, this.content)
    this.applyComposition()
  }

  /** The camera the view is drawn through right now: flat while it looks along an axis, a lens otherwise. */
  get camera(): THREE.Camera {
    return this.flat ? this.level2 : this.level3
  }

  /** Whether the view looks straight along an axis, from the front, the back, a side, above, or below: drawn without perspective. */
  get flat(): boolean {
    return quarter(this.yaw) && quarter(this.pitch)
  }

  /** Whether it is the view from the front: the scene's right and up are the pane's. */
  get straight(): boolean {
    return this.pitch === 0 && Math.abs(this.yaw / 360 - Math.round(this.yaw / 360)) < 1e-9
  }

  /** The side the view looks from, as a camera's pan and tilt, in degrees. */
  get facing(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch }
  }

  /** Pane pixels per pixel of the scene where the view looks: what its zoom is called. */
  get scale(): number {
    return this.level
  }

  axes(): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
    return vectorsOf({ rotationX: this.pitch, rotationY: this.yaw, rotation: 0 })
  }

  /** How far the eye of a view with a lens stands from where it looks, for the zoom it has. */
  private get distance(): number {
    return (Math.max(this.view.width, this.view.height, 1) * NORMAL_LENS) / SENSOR / this.level
  }

  /** Where the view's eye is: for a view drawn without perspective, where it would be with it. */
  eye(): Vec3 {
    const e = this.target.clone().addScaledVector(this.axes().forward, -this.distance)
    return { x: e.x, y: e.y, z: e.z }
  }

  middle(): { x: number; y: number } {
    return { x: this.view.width / 2, y: this.view.height / 2 }
  }

  focus(): THREE.Vector3 {
    return this.target
  }

  ray(paneX: number, paneY: number): THREE.Ray {
    const { right, up, forward } = this.axes()
    const u = (paneX - this.view.width / 2) / this.level
    const v = -(paneY - this.view.height / 2) / this.level
    if (this.flat) {
      // Without perspective every line of sight runs the way the view looks, from far behind anything.
      const origin = this.target.clone().addScaledVector(right, u).addScaledVector(up, v).addScaledVector(forward, -STAND_BACK)
      return new THREE.Ray(origin, forward)
    }
    const d = this.distance
    const direction = forward.clone().multiplyScalar(d).addScaledVector(right, u).addScaledVector(up, v).normalize()
    return new THREE.Ray(this.target.clone().addScaledVector(forward, -d), direction)
  }

  project(place: THREE.Vector3): { x: number; y: number } | null {
    const { right, up, forward } = this.axes()
    if (this.flat) {
      const d = place.clone().sub(this.target)
      return { x: this.view.width / 2 + d.dot(right) * this.level, y: this.view.height / 2 - d.dot(up) * this.level }
    }
    const distance = this.distance
    const d = place.clone().sub(this.target).addScaledVector(forward, distance)
    const ahead = d.dot(forward)
    if (ahead <= 1e-6) return null
    const s = (this.level * distance) / ahead
    return { x: this.view.width / 2 + d.dot(right) * s, y: this.view.height / 2 - d.dot(up) * s }
  }

  scaleAt(place: THREE.Vector3): number {
    if (this.flat) return this.level
    const { forward } = this.axes()
    const distance = this.distance
    const ahead = place.clone().sub(this.target).dot(forward) + distance
    return (this.level * distance) / Math.max(1e-6, ahead)
  }

  /** The frame's size and the color inside it, the project's background (D131). A new size is fitted; a new color leaves the view where it is. */
  setComposition(width: number, height: number, background: string): void {
    const resized = width !== this.composition.width || height !== this.composition.height
    this.composition = { width, height }
    ;(this.frame.material as THREE.MeshBasicMaterial).color.set(background)
    this.applyComposition()
    if (resized || !this.fittedTo) this.fit()
  }

  /** Put the frame where a camera frames (D357); the view itself stays where it is. */
  setFrame(view: View): void {
    const p = this.placed
    if (p.x === view.x && p.y === view.y && p.z === view.z && p.zoom === view.zoom && p.rotation === view.rotation && p.rotationX === view.rotationX && p.rotationY === view.rotationY && p.focal === view.focal && p.orthographic === view.orthographic) return
    this.placed = view
    this.applyComposition()
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.view = { width, height }
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    // A view left as Fit left it keeps showing what Fit showed, whatever the pane's size: the camera may have moved since, and the view does not follow it (D367).
    if (this.adjusted) this.updateCamera()
    else this.show(this.fittedTo ?? this.frameCorners())
  }

  /** Show the whole frame, centered, with padding: where the camera that has the picture puts it now (D367), which with no camera is the scene's middle. The view keeps the side it looks from. */
  fit(): void {
    this.fittedTo = this.frameCorners()
    this.show(this.fittedTo)
  }

  /** Show places of the scene whole, centered, with padding, as a view not yet zoomed or moved: from the side the view looks from. */
  showAll(places: THREE.Vector3[]): void {
    if (places.length === 0) return
    this.fittedTo = places
    this.show(places)
  }

  private show(places: THREE.Vector3[]): void {
    const { width, height } = this.view
    if (width === 0 || height === 0 || places.length === 0) return
    this.adjusted = false
    const { right, up, forward } = this.axes()
    let left = Infinity
    let rightmost = -Infinity
    let bottom = Infinity
    let top = -Infinity
    let near = 0
    for (const p of places) {
      const u = p.dot(right)
      const v = p.dot(up)
      left = Math.min(left, u)
      rightmost = Math.max(rightmost, u)
      bottom = Math.min(bottom, v)
      top = Math.max(top, v)
      near += p.dot(forward) / places.length
    }
    const zoom = Math.min((width - PADDING * 2) / Math.max(1e-6, rightmost - left), (height - PADDING * 2) / Math.max(1e-6, top - bottom))
    this.level = Math.min(MAX_ZOOM, Math.max(zoom, MIN_ZOOM))
    this.target.set(0, 0, 0).addScaledVector(right, (left + rightmost) / 2).addScaledVector(up, (bottom + top) / 2).addScaledVector(forward, near)
    this.updateCamera()
  }

  /** Set the zoom, keeping the pane center fixed. */
  setZoom(zoom: number): void {
    this.zoomAt(zoom / this.level, this.view.width / 2, this.view.height / 2)
  }

  /** Multiply the zoom, keeping the place under the given pane position fixed. */
  zoomAt(factor: number, paneX: number, paneY: number): void {
    this.adjusted = true
    const facing = this.axes().forward
    const before = across(this.ray(paneX, paneY), this.target, facing)
    this.level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.level * factor))
    const after = across(this.ray(paneX, paneY), this.target, facing)
    this.target.add(before).sub(after)
    this.updateCamera()
  }

  /** Move the view by a number of pane pixels. Positive y moves the view down the world. */
  panBy(paneDx: number, paneDy: number): void {
    this.adjusted = true
    const { right, up } = this.axes()
    this.target.addScaledVector(right, paneDx / this.level).addScaledVector(up, -paneDy / this.level)
    this.updateCamera()
  }

  /**
   * Go round what the view looks at (D428): a drag to the right turns the view to its right and a
   * drag up turns it up, so the near side of what is seen follows the pointer. It never goes over
   * the top or under the bottom.
   */
  roundBy(paneDx: number, paneDy: number, rate = ROUND_RATE): void {
    this.adjusted = true
    // The side is kept within half a turn either way, so it reads as it would be told.
    const yaw = this.yaw - paneDx * rate
    this.yaw = yaw - 360 * Math.round(yaw / 360)
    this.pitch = Math.max(-90, Math.min(90, this.pitch - paneDy * rate))
    this.updateCamera()
  }

  /** Look at a place on the view's own middle line of sight, so that is what the view goes round; nothing seen changes. */
  lookAt(place: THREE.Vector3): void {
    const { forward } = this.axes()
    if (!this.flat) {
      // The eye stays where it is: the zoom is told where the view looks, so it follows the distance.
      const eye = this.target.clone().addScaledVector(forward, -this.distance)
      const ahead = place.clone().sub(eye).dot(forward)
      if (ahead <= 1e-3) return
      this.level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.max(this.view.width, this.view.height, 1) * NORMAL_LENS) / SENSOR / ahead))
    }
    this.target.addScaledVector(forward, place.clone().sub(this.target).dot(forward))
  }

  /** Look from a side, as a camera's pan and tilt tell it, at what the view looks at now. */
  face(yaw: number, pitch: number): void {
    this.adjusted = true
    this.yaw = yaw
    this.pitch = Math.max(-90, Math.min(90, pitch))
    this.updateCamera()
  }

  /** Stand where a camera stands and look the way it looks (D436): its place, its pan and tilt, and how far ahead it looks. The roll is the camera's own. */
  standAt(place: Vec3, yaw: number, pitch: number, ahead: number): void {
    this.adjusted = true
    this.yaw = yaw
    this.pitch = Math.max(-90, Math.min(90, pitch))
    const distance = Math.max(1e-3, ahead)
    this.level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.max(this.view.width, this.view.height, 1) * NORMAL_LENS) / SENSOR / distance))
    this.target.set(place.x, place.y, place.z).addScaledVector(this.axes().forward, this.distance)
    this.updateCamera()
  }

  /** Put the view's left or top edge at a world coordinate, for the scrollbars (D85): the view from the front has them. */
  scrollTo(edge: { left?: number; top?: number }): void {
    if (!this.straight) return
    this.adjusted = true
    if (edge.left !== undefined) this.target.x = edge.left + this.view.width / 2 / this.level
    if (edge.top !== undefined) this.target.y = edge.top - this.view.height / 2 / this.level
    this.updateCamera()
  }

  /** The world rectangle currently in view: from the front, the box of the scene the pane shows; turned, the box around where the pane's corners look at the plane in hand. */
  viewRect(): Rect {
    if (this.straight) {
      const halfWidth = this.view.width / 2 / this.level
      const halfHeight = this.view.height / 2 / this.level
      return { left: this.target.x - halfWidth, right: this.target.x + halfWidth, top: this.target.y + halfHeight, bottom: this.target.y - halfHeight }
    }
    const corners = [this.toWorld(0, 0), this.toWorld(this.view.width, 0), this.toWorld(0, this.view.height), this.toWorld(this.view.width, this.view.height)]
    return { left: Math.min(...corners.map((c) => c.x)), right: Math.max(...corners.map((c) => c.x)), top: Math.max(...corners.map((c) => c.y)), bottom: Math.min(...corners.map((c) => c.y)) }
  }

  /** The four corners of the camera's frame in the scene, where the camera puts it. */
  frameCorners(): THREE.Vector3[] {
    const f = frameOf(this.placed)
    const c = new THREE.Vector3(f.center.x, f.center.y, f.center.z)
    const r = new THREE.Vector3(f.right.x, f.right.y, f.right.z).multiplyScalar(f.width / 2)
    const u = new THREE.Vector3(f.up.x, f.up.y, f.up.z).multiplyScalar(f.height / 2)
    return [c.clone().sub(r).add(u), c.clone().add(r).add(u), c.clone().add(r).sub(u), c.clone().sub(r).sub(u)]
  }

  /** The camera frame in world coordinates: the upright box around it, where the camera puts it. */
  frameRect(): Rect {
    const corners = this.frameCorners()
    return { left: Math.min(...corners.map((c) => c.x)), right: Math.max(...corners.map((c) => c.x)), top: Math.max(...corners.map((c) => c.y)), bottom: Math.min(...corners.map((c) => c.y)) }
  }

  /** The project's frame at the scene's middle, whatever a camera frames. */
  sceneRect(): Rect {
    return { left: -this.composition.width / 2, right: this.composition.width / 2, top: this.composition.height / 2, bottom: -this.composition.height / 2 }
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
    const f = frameOf(this.placed)
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.right.x, f.right.y, f.right.z), new THREE.Vector3(f.up.x, f.up.y, f.up.z), new THREE.Vector3(-f.forward.x, -f.forward.y, -f.forward.z))
    for (const mesh of [this.frame, this.outline]) {
      mesh.scale.set(f.width, f.height, 1)
      mesh.position.set(f.center.x, f.center.y, f.center.z)
      mesh.quaternion.setFromRotationMatrix(basis)
    }
  }

  private updateCamera(): void {
    const { width, height } = this.view
    if (width === 0 || height === 0) return
    const { forward } = this.axes()
    const camera = this.camera
    if (this.flat) {
      const halfWidth = width / 2 / this.level
      const halfHeight = height / 2 / this.level
      this.level2.left = -halfWidth
      this.level2.right = halfWidth
      this.level2.top = halfHeight
      this.level2.bottom = -halfHeight
      // It stands well back from where it looks, as far as nothing is: a press is a line of sight from where the camera is, and finds only what is ahead of it.
      this.level2.position.copy(this.target).addScaledVector(forward, -STAND_BACK)
      this.level2.updateProjectionMatrix()
    } else {
      const distance = this.distance
      this.level3.aspect = width / height
      this.level3.fov = (2 * Math.atan(height / 2 / this.level / distance) * 180) / Math.PI
      this.level3.near = Math.max(0.05, distance / 5000)
      this.level3.far = Math.max(1e7, distance * 1000)
      this.level3.position.copy(this.target).addScaledVector(forward, -distance)
      this.level3.updateProjectionMatrix()
    }
    camera.rotation.set((this.pitch * Math.PI) / 180, (this.yaw * Math.PI) / 180, 0, 'YXZ')
    // What is drawn for a turned view alone, the cameras' bodies and the outlines of things, shows there and not from the front.
    if (this.straight) camera.layers.disable(TURNED_LAYER)
    else camera.layers.enable(TURNED_LAYER)
    camera.updateMatrixWorld()
    this.render()
    this.onChange?.()
  }
}
