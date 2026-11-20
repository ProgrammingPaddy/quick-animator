import * as THREE from 'three'
import { axesOf, frameDistance, fullDistance, looksStraight, type View } from '../model/lens'

/**
 * A plane of the scene that things lie in and are worked on in (D434): the scene's own, at a
 * depth; or, turned from it, the plane of the picture, which a camera that is turned holds
 * things on (D362). A place on it is `x` and `y`, as in the scene, so everything that works on a
 * flat thing works on it as it always did, whatever the view makes of the plane.
 */
export interface Plane {
  z: number
  turn: THREE.Matrix4 | null
}

/** The layer of what is drawn only for a view that is turned (D435): the cameras' bodies, the edges of their views, the outlines of things. */
export const TURNED_LAYER = 1

/** The scene's own plane, at depth 0. */
export const FLAT: Plane = Object.freeze({ z: 0, turn: null })

export function samePlane(a: Plane, b: Plane): boolean {
  return a === b || (a.z === b.z && a.turn === b.turn)
}

const inverse = new THREE.Matrix4()
const local = new THREE.Ray()

/** Where a line of sight meets a plane, as a place on it; null when it runs along the plane, or meets it behind where the line begins. */
export function meet(ray: THREE.Ray, plane: Plane): { x: number; y: number } | null {
  let r = ray
  if (plane.turn) {
    local.copy(ray).applyMatrix4(inverse.copy(plane.turn).invert())
    r = local
  }
  const dz = r.direction.z
  if (Math.abs(dz) < 1e-7) return null
  const t = (plane.z - r.origin.z) / dz
  if (t < 0) return null
  return { x: r.origin.x + r.direction.x * t, y: r.origin.y + r.direction.y * t }
}

/** A place on a plane, as a place in the scene. */
export function lift(x: number, y: number, plane: Plane, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(x, y, plane.z)
  return plane.turn ? out.applyMatrix4(plane.turn) : out
}

/** A place in the scene, as the place on a plane straight under it. */
export function drop(place: THREE.Vector3, plane: Plane): { x: number; y: number } {
  if (!plane.turn) return { x: place.x, y: place.y }
  const p = place.clone().applyMatrix4(inverse.copy(plane.turn).invert())
  return { x: p.x, y: p.y }
}

/** Where a line of sight crosses the plane through a place that faces a direction. */
export function across(ray: THREE.Ray, through: THREE.Vector3, facing: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const along = ray.direction.dot(facing)
  if (Math.abs(along) < 1e-9) return out.copy(ray.origin)
  const ahead = (through.x - ray.origin.x) * facing.x + (through.y - ray.origin.y) * facing.y + (through.z - ray.origin.z) * facing.z
  return out.copy(ray.origin).addScaledVector(ray.direction, ahead / along)
}

/**
 * The plane of a camera's picture (D362, D434): its frame lies in it, and so does everything
 * held on the screen. Told as the plane the camera would have looking straight on, at the depth
 * its frame is drawn at, turned about the camera's own place by its pan and its tilt; so for a
 * camera that looks straight on it is a plane of the scene's own, and nothing is turned.
 */
export function picturePlane(view: View): Plane {
  const z = view.z - frameDistance(view)
  if (looksStraight(view)) return { z, turn: null }
  const about = new THREE.Vector3(view.x, view.y, view.z)
  const turn = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((view.rotationX * Math.PI) / 180, (view.rotationY * Math.PI) / 180, 0, 'YXZ'))
  turn.setPosition(about.clone().sub(about.clone().applyMatrix4(turn)))
  return { z, turn }
}

/** The pictures' planes of the views last asked for, so a view that has not changed keeps one plane, and what compares planes sees it has not. */
const kept = new Map<string, Plane>()

/** The plane of a camera's picture, the same object for the same view. */
export function planeOfPicture(view: View): Plane {
  const key = `${view.x},${view.y},${view.z},${view.rotationX},${view.rotationY}`
  let plane = kept.get(key)
  if (!plane) {
    if (kept.size > 64) kept.clear()
    plane = picturePlane(view)
    kept.set(key, plane)
  }
  return plane
}

/**
 * A Three.js camera that takes the picture a view describes (D433): through its lens, from where
 * it stands and the way it looks. While the camera looks straight on and nothing drawn is off
 * depth 0, `depthless`, the picture is the flat one it always was, and is taken as it always was,
 * without perspective, so a scene with no depth draws to the pixel as it did.
 */
export class PictureCamera {
  private readonly lens = new THREE.PerspectiveCamera(40, 16 / 9, 1, 1e7)
  private readonly flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1e7)
  camera: THREE.Camera = this.flat

  set(view: View, width: number, height: number, depthless: boolean): void {
    const asFlat = view.orthographic || (depthless && looksStraight(view) && view.z > 0)
    const c = asFlat ? this.flat : this.lens
    if (asFlat) {
      this.flat.left = -width / 2
      this.flat.right = width / 2
      this.flat.top = height / 2
      this.flat.bottom = -height / 2
      this.flat.zoom = view.orthographic ? Math.max(1e-6, view.zoom) : fullDistance(view) / view.z
    } else {
      const full = fullDistance(view)
      this.lens.aspect = width / height
      this.lens.fov = (2 * Math.atan(height / 2 / full) * 180) / Math.PI
      // Nothing behind the camera is drawn, nor what is nearer than a hair in front of it.
      this.lens.near = Math.max(0.01, full / 20000)
      this.lens.far = Math.max(1e7, full * 1000)
    }
    c.position.set(view.x, view.y, view.z)
    c.rotation.set((view.rotationX * Math.PI) / 180, (view.rotationY * Math.PI) / 180, (view.rotation * Math.PI) / 180, 'YXZ')
    ;(c as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix()
    c.updateMatrixWorld()
    this.camera = c
  }
}

/** A camera's axes as Three.js vectors. */
export function vectorsOf(view: { rotationX: number; rotationY: number; rotation: number }, roll = true): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const a = axesOf(view, roll)
  return { right: new THREE.Vector3(a.right.x, a.right.y, a.right.z), up: new THREE.Vector3(a.up.x, a.up.y, a.up.z), forward: new THREE.Vector3(a.forward.x, a.forward.y, a.forward.z) }
}

const scratch = new THREE.Vector3()
const scratchB = new THREE.Vector3()

/**
 * What a gesture needs of a view of the scene (D366, D434), from two things a view knows: the
 * line of sight through a place on its pane, and where a place in the scene shows. Places on the
 * pane are places on the plane in hand, the plane of what is being worked on, so a thing at any
 * depth, in a view turned any way, is worked on in its own flat coordinates.
 */
export abstract class SurfaceBase {
  /** The plane in hand: what is worked on lies in it. The scene's own at depth 0 unless told. */
  plane: Plane = FLAT

  /** The line of sight through a place on the pane. */
  abstract ray(paneX: number, paneY: number): THREE.Ray
  /** Where a place in the scene shows on the pane; null when it is behind the view. */
  abstract project(place: THREE.Vector3): { x: number; y: number } | null
  /** Pane pixels per unit of the scene at a place, across the line of sight. */
  abstract scaleAt(place: THREE.Vector3): number
  /** The view's own right and up, and the way it looks, in the scene. */
  abstract axes(): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }
  /** The middle of what the view shows, on the pane. */
  abstract middle(): { x: number; y: number }
  /** A place the view looks at: what a line of sight is measured against when it runs along the plane in hand. */
  abstract focus(): THREE.Vector3

  /** The place on the plane in hand under a place on the pane. Where the line of sight runs along that plane, the place across from where the view looks, dropped onto it. */
  toWorld(paneX: number, paneY: number): { x: number; y: number } {
    const ray = this.ray(paneX, paneY)
    return meet(ray, this.plane) ?? drop(across(ray, this.focus(), this.axes().forward, scratch), this.plane)
  }

  /** Where a place on a plane shows on the pane: the plane in hand unless another is given. */
  toPane(x: number, y: number, plane: Plane = this.plane): { x: number; y: number } {
    return this.project(lift(x, y, plane, scratch)) ?? { x: -1e7, y: -1e7 }
  }

  /** Pane pixels per unit of the scene on the plane in hand, where the middle of the view looks at it. */
  get zoom(): number {
    const m = this.middle()
    const w = this.toWorld(m.x, m.y)
    return this.scaleAt(lift(w.x, w.y, this.plane, scratch))
  }

  /** Pane pixels per unit of the scene at a place on a plane. */
  zoomOn(x: number, y: number, plane: Plane): number {
    return this.scaleAt(lift(x, y, plane, scratch))
  }

  /** How far a drag of so many pane pixels goes on the plane in hand, from the middle of the view. */
  delta(dx: number, dy: number): { x: number; y: number } {
    const m = this.middle()
    const a = this.toWorld(m.x, m.y)
    const b = this.toWorld(m.x + dx, m.y + dy)
    return { x: b.x - a.x, y: b.y - a.y }
  }

  /**
   * How far a thing at a place goes in the scene as the pointer goes from one place on the pane
   * to another (D430): it stays under the pointer, in the plane through its own place that faces
   * the view. From the front that is across and up; from above, across and in depth.
   */
  carry(fromX: number, fromY: number, toX: number, toY: number, at: THREE.Vector3): THREE.Vector3 {
    const facing = this.axes().forward
    const a = across(this.ray(fromX, fromY), at, facing, scratch)
    const b = across(this.ray(toX, toY), at, facing, scratchB)
    return new THREE.Vector3().subVectors(b, a)
  }
}
