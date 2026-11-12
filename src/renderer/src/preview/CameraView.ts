import * as THREE from 'three'
import { NO_VIEW, type View } from '../model/sample'
import type { SceneRenderer } from './SceneRenderer'
import type { Rect, Surface } from './Viewport'

/**
 * The Camera view (D360, D366): the scene drawn through the camera that has the picture, on a
 * canvas of its own, fitted to its part of the pane. It is a surface a gesture works on as the
 * Preview view's is: places on the pane, from the preview's top left corner, go to the scene
 * and back through the camera, its place, its zoom, and its roll.
 */
export class CameraView implements Surface {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
  /** Whether the view is on the pane right now. */
  shown = false
  private readonly gl: THREE.WebGLRenderer
  /** The picture on the pane: its left and top from the preview's top left corner, and its size, in pane pixels. */
  private box = { left: 0, top: 0, width: 1, height: 1 }
  private composition = { width: 1920, height: 1080 }
  private view: View = NO_VIEW
  /** The size the canvas was last given: sizing it clears it, so it is sized again only when that changes. */
  private sized = ''

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true })
  }

  /** Pane pixels per pixel of the project. */
  get scale(): number {
    return this.box.width / this.composition.width
  }

  /** Pane pixels per pixel of the scene. */
  get zoom(): number {
    return this.scale * this.view.zoom
  }

  /** How far the view is turned from the scene's own axes, in degrees. */
  get turn(): number {
    return this.view.rotation
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
    this.camera.left = -composition.width / 2
    this.camera.right = composition.width / 2
    this.camera.top = composition.height / 2
    this.camera.bottom = -composition.height / 2
    this.place()
  }

  /** Look through a camera: where it is, how close, and its roll. */
  setView(view: View): void {
    this.view = view
    this.place()
  }

  private place(): void {
    this.camera.position.set(this.view.x, this.view.y, 100)
    this.camera.rotation.z = (this.view.rotation * Math.PI) / 180
    this.camera.zoom = this.view.zoom
    this.camera.updateProjectionMatrix()
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

  toWorld(paneX: number, paneY: number): { x: number; y: number } {
    const p = this.toPicture(paneX, paneY)
    const a = (this.view.rotation * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    return { x: this.view.x + (cos * p.x - sin * p.y) / this.view.zoom, y: this.view.y + (sin * p.x + cos * p.y) / this.view.zoom }
  }

  toPane(x: number, y: number): { x: number; y: number } {
    const a = (this.view.rotation * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const dx = (x - this.view.x) * this.view.zoom
    const dy = (y - this.view.y) * this.view.zoom
    const k = this.scale
    return { x: this.box.left + this.box.width / 2 + (cos * dx + sin * dy) * k, y: this.box.top + this.box.height / 2 - (-sin * dx + cos * dy) * k }
  }

  toNdc(paneX: number, paneY: number): THREE.Vector2 {
    return new THREE.Vector2(((paneX - this.box.left) / Math.max(1, this.box.width)) * 2 - 1, -((paneY - this.box.top) / Math.max(1, this.box.height)) * 2 + 1)
  }

  /** How far a drag of so many pane pixels goes in the scene: by the picture's scale and the camera's zoom, turned as the camera is. */
  delta(dx: number, dy: number): { x: number; y: number } {
    const a = (this.view.rotation * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const z = this.zoom
    return { x: (cos * dx + sin * dy) / z, y: (sin * dx - cos * dy) / z }
  }

  /** The upright box around what the camera frames. */
  viewRect(): Rect {
    const a = (this.view.rotation * Math.PI) / 180
    const w = this.composition.width / this.view.zoom
    const h = this.composition.height / this.view.zoom
    const halfWidth = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
    const halfHeight = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2
    return { left: this.view.x - halfWidth, right: this.view.x + halfWidth, top: this.view.y + halfHeight, bottom: this.view.y - halfHeight }
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
