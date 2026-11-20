import * as THREE from 'three'
import { frameOf, fullDistance, looksStraight, type View } from '../model/lens'
import { NO_VIEW } from '../model/sample'
import { PictureCamera, SurfaceBase, vectorsOf } from './planes'
import type { SceneRenderer } from './SceneRenderer'
import type { Rect, Surface } from './Viewport'

/**
 * The Camera view (D360, D366, D433): the scene drawn through the camera that has the picture, on
 * a canvas of its own, fitted to its part of the pane. It is a surface a gesture works on as the
 * Preview view's is: places on the pane, from the preview's top left corner, go to the scene and
 * back through the camera, its place, the way it looks, and its lens.
 */
export class CameraView extends SurfaceBase implements Surface {
  /** Whether the view is on the pane right now. */
  shown = false
  private readonly gl: THREE.WebGLRenderer
  private readonly picture = new PictureCamera()
  /** The picture on the pane: its left and top from the preview's top left corner, and its size, in pane pixels. */
  private box = { left: 0, top: 0, width: 1, height: 1 }
  private composition = { width: 1920, height: 1080 }
  private view: View = NO_VIEW
  private depthless = true
  /** The size the canvas was last given: sizing it clears it, so it is sized again only when that changes. */
  private sized = ''

  constructor(private readonly canvas: HTMLCanvasElement) {
    super()
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true })
  }

  /** The camera the picture is drawn through. */
  get camera(): THREE.Camera {
    return this.picture.camera
  }

  /** Pane pixels per pixel of the project. */
  get scale(): number {
    return this.box.width / this.composition.width
  }

  /** How far the view is rolled from the scene's own axes, in degrees. */
  get turn(): number {
    return this.view.rotation
  }

  /** Whether the camera looks straight into the scene: the planes of one depth face it. */
  get straight(): boolean {
    return looksStraight(this.view)
  }

  /** What the picture is taken through right now. */
  get taken(): View {
    return this.view
  }

  /** The picture's box on the pane, from the preview's top left corner. */
  get frame(): { left: number; top: number; width: number; height: number } {
    return this.box
  }

  /**
   * Fit the picture into the view's part of the pane, `panel`, with `pad` pixels kept around it;
   * `host` is the preview itself, which places on the pane are measured from. Not shown, it keeps
   * what it had.
   */
  fit(shown: boolean, panel: DOMRect, host: DOMRect, composition: { width: number; height: number }, background: THREE.ColorRepresentation, pad: number): void {
    this.shown = shown && panel.width > 0 && panel.height > 0
    if (!this.shown) return
    this.composition = { width: composition.width, height: composition.height }
    const scale = Math.max(0.01, Math.min((panel.width - pad * 2) / composition.width, (panel.height - pad * 2) / composition.height))
    const width = Math.max(1, Math.round(composition.width * scale))
    const height = Math.max(1, Math.round(composition.height * scale))
    // The canvas sits in the middle of its part of the pane.
    this.box = { left: panel.left - host.left + (panel.width - width) / 2, top: panel.top - host.top + (panel.height - height) / 2, width, height }
    const key = `${width}x${height}@${window.devicePixelRatio}`
    if (this.sized !== key) {
      this.sized = key
      this.canvas.style.width = `${width}px`
      this.canvas.style.height = `${height}px`
      this.gl.setPixelRatio(window.devicePixelRatio)
      this.gl.setSize(width, height, false)
    }
    this.gl.setClearColor(background, 1)
    this.place()
  }

  /** Look through a camera: where it is, the way it looks, and its lens. `depthless` says nothing drawn is off depth 0, so a camera that looks straight on takes the flat picture it always did. */
  setView(view: View, depthless = true): void {
    this.view = view
    this.depthless = depthless
    this.place()
  }

  private place(): void {
    this.picture.set(this.view, this.composition.width, this.composition.height, this.depthless)
  }

  /** Draw the scene as last updated, with what is drawn for the one working on it or without. */
  draw(scene: SceneRenderer, overlay: boolean): void {
    if (this.shown) scene.drawThrough(this.gl, this.camera, overlay)
  }

  /** A place on the pane as a place in the picture: from its middle, in the project's pixels, up being up. */
  toPicture(paneX: number, paneY: number): { x: number; y: number } {
    const k = this.scale
    return { x: (paneX - this.box.left - this.box.width / 2) / k, y: -(paneY - this.box.top - this.box.height / 2) / k }
  }

  /** Whether a place on the pane is on the picture. */
  holds(paneX: number, paneY: number): boolean {
    return this.shown && paneX >= this.box.left && paneX <= this.box.left + this.box.width && paneY >= this.box.top && paneY <= this.box.top + this.box.height
  }

  axes(): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
    return vectorsOf(this.view)
  }

  middle(): { x: number; y: number } {
    return { x: this.box.left + this.box.width / 2, y: this.box.top + this.box.height / 2 }
  }

  focus(): THREE.Vector3 {
    const c = frameOf(this.view).center
    return new THREE.Vector3(c.x, c.y, c.z)
  }

  ray(paneX: number, paneY: number): THREE.Ray {
    const p = this.toPicture(paneX, paneY)
    const { right, up, forward } = this.axes()
    const at = new THREE.Vector3(this.view.x, this.view.y, this.view.z)
    if (this.view.orthographic) {
      const k = 1 / Math.max(1e-6, this.view.zoom)
      // Nothing behind a camera is in its picture, with perspective or without.
      return new THREE.Ray(at.addScaledVector(right, p.x * k).addScaledVector(up, p.y * k), forward)
    }
    return new THREE.Ray(at, forward.clone().multiplyScalar(fullDistance(this.view)).addScaledVector(right, p.x).addScaledVector(up, p.y).normalize())
  }

  project(place: THREE.Vector3): { x: number; y: number } | null {
    const { right, up, forward } = this.axes()
    const d = place.clone().sub(new THREE.Vector3(this.view.x, this.view.y, this.view.z))
    let s = Math.max(1e-6, this.view.zoom)
    if (!this.view.orthographic) {
      const ahead = d.dot(forward)
      if (ahead <= 1e-6) return null
      s = fullDistance(this.view) / ahead
    }
    const k = this.scale
    return { x: this.box.left + this.box.width / 2 + d.dot(right) * s * k, y: this.box.top + this.box.height / 2 - d.dot(up) * s * k }
  }

  scaleAt(place: THREE.Vector3): number {
    if (this.view.orthographic) return this.scale * Math.max(1e-6, this.view.zoom)
    const ahead = place.clone().sub(new THREE.Vector3(this.view.x, this.view.y, this.view.z)).dot(this.axes().forward)
    // Behind the camera nothing shows: a place there is taken at the picture's own scale.
    return ahead > 1e-6 ? (this.scale * fullDistance(this.view)) / ahead : this.scale
  }

  toNdc(paneX: number, paneY: number): THREE.Vector2 {
    return new THREE.Vector2(((paneX - this.box.left) / Math.max(1, this.box.width)) * 2 - 1, -((paneY - this.box.top) / Math.max(1, this.box.height)) * 2 + 1)
  }

  /** The upright box around what the camera frames: its frame, where it is drawn. */
  viewRect(): Rect {
    const f = frameOf(this.view)
    const xs: number[] = []
    const ys: number[] = []
    for (const [a, b] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
      xs.push(f.center.x + (a * f.right.x * f.width) / 2 + (b * f.up.x * f.height) / 2)
      ys.push(f.center.y + (a * f.right.y * f.width) / 2 + (b * f.up.y * f.height) / 2)
    }
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.max(...ys), bottom: Math.min(...ys) }
  }

  /** The frame is all the Camera view shows. */
  frameRect(): Rect {
    return this.viewRect()
  }

  sceneRect(): Rect {
    return { left: -this.composition.width / 2, right: this.composition.width / 2, top: this.composition.height / 2, bottom: -this.composition.height / 2 }
  }

  dispose(): void {
    this.gl.dispose()
  }
}
