import * as THREE from 'three'
import type { SceneModel } from '../model/types'
import { SceneRenderer } from '../preview/SceneRenderer'

/**
 * Draws frames at project resolution through the same scene renderer as the preview, one world
 * pixel per output pixel, and reads their pixels (D25, R67, R112). An opaque frame sits on the
 * project's background; a frame with alpha leaves the background out and composites premultiplied,
 * so edges and fades come out right, then returns straight alpha as video formats expect.
 */
export class FrameRenderer {
  private readonly canvas = document.createElement('canvas')
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.OrthographicCamera
  private readonly content = new SceneRenderer()
  private readonly backdrop: THREE.Mesh
  private readonly read: Uint8Array
  private readonly premultiplied = new WeakSet<THREE.Material>()

  constructor(
    readonly width: number,
    readonly height: number,
    background: string,
    readonly alpha: boolean,
  ) {
    this.canvas.width = width
    this.canvas.height = height
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, premultipliedAlpha: alpha, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(width, height, false)
    this.renderer.setClearColor(0x000000, 0)
    this.camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -1000, 1000)
    this.camera.position.set(0, 0, 100)
    this.camera.updateProjectionMatrix()
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(background) }))
    this.backdrop.position.z = -10
    this.backdrop.visible = !alpha
    this.scene.add(this.backdrop, this.content.group)
    this.read = new Uint8Array(width * height * 4)
  }

  /** The frame at a time: rows of RGBA from the top down, straight alpha. */
  draw(model: SceneModel, time: number): Uint8Array {
    this.content.update(model, time, [], 'all', 1)
    if (this.alpha) this.premultiply()
    this.renderer.render(this.scene, this.camera)
    const gl = this.renderer.getContext()
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.read)
    const out = new Uint8Array(this.width * this.height * 4)
    const stride = this.width * 4
    // WebGL reads from the bottom row up; video wants the top first.
    for (let y = 0; y < this.height; y++) out.set(this.read.subarray(y * stride, (y + 1) * stride), (this.height - 1 - y) * stride)
    if (this.alpha) {
      for (let i = 0; i < out.length; i += 4) {
        const a = out[i + 3]!
        if (a === 0 || a === 255) continue
        out[i] = Math.min(255, Math.round((out[i]! * 255) / a))
        out[i + 1] = Math.min(255, Math.round((out[i + 1]! * 255) / a))
        out[i + 2] = Math.min(255, Math.round((out[i + 2]! * 255) / a))
      }
    } else {
      for (let i = 3; i < out.length; i += 4) out[i] = 255
    }
    return out
  }

  /** Every material composites premultiplied, so fades over nothing keep their color. Done once per material. */
  private premultiply(): void {
    this.content.group.traverse((obj) => {
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (!material) return
      for (const m of Array.isArray(material) ? material : [material]) {
        if (this.premultiplied.has(m)) continue
        this.premultiplied.add(m)
        m.premultipliedAlpha = true
        m.needsUpdate = true
      }
    })
  }

  dispose(): void {
    this.renderer.dispose()
    this.backdrop.geometry.dispose()
    ;(this.backdrop.material as THREE.Material).dispose()
  }
}
