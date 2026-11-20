/**
 * The camera's arithmetic (D416, D422, D433): a camera is a place, a direction, and a lens, as
 * in every 3D program, and the picture is what the lens takes in from there. Space is `x` to the
 * right, `y` up, `z` toward the viewer, in the scene's units (D21). Everything here is plain
 * numbers, so the sampler, the views, and an export all go by the same sums.
 */

/** The size of the project's picture, which a lens and a camera's standing distance are measured by. Whoever knows the project says so. */
export const picture = { width: 1920, height: 1080 }

/** Say the project's size. True when it changed. */
export function setPicture(width: number, height: number): boolean {
  if (picture.width === width && picture.height === height) return false
  picture.width = width
  picture.height = height
  return true
}

/** The width of the sensor a focal length is written for, in millimetres, across the picture's longer side: the 36 mm of a full frame, as Blender, Maya, and After Effects have it. */
export const SENSOR = 36
/** The lens a camera has unless one is written, in millimetres. */
export const NORMAL_LENS = 50

/** The picture's longer side, which the sensor lies across. */
export function longSide(): number {
  return Math.max(picture.width, picture.height)
}

/** Where a camera stands unless `z` is written: where a 50 mm lens takes in exactly the project's size at depth 0, 1.389 times its longer side. */
export function standDistance(): number {
  return (longSide() * NORMAL_LENS) / SENSOR
}

/** The angle a lens takes in across the picture's longer side, in degrees. */
export function fovOf(focal: number): number {
  return (2 * Math.atan(SENSOR / 2 / Math.max(0.1, focal)) * 180) / Math.PI
}

/** The focal length that takes in an angle across the picture's longer side, in millimetres. */
export function focalOf(fov: number): number {
  const angle = Math.min(179, Math.max(0.5, fov))
  return SENSOR / 2 / Math.tan((angle * Math.PI) / 360)
}

/**
 * What the picture is taken through at a moment (D357, D433): where the camera is; which way it
 * looks, its pan about the upright axis, `rotationY`, then its tilt, `rotationX`, then its roll,
 * `rotation`, each in degrees and counterclockwise about its axis; and its lens, a focal length
 * in millimetres that `zoom` multiplies. Looking straight on from where it stands unless told
 * otherwise, `x` and `y` are the point of the scene at the middle of the picture, as they were
 * while the camera was flat.
 */
export interface View {
  x: number
  y: number
  z: number
  rotationX: number
  rotationY: number
  rotation: number
  zoom: number
  focal: number
  /** No perspective: a thing is one size at any distance, and `zoom` is the scale. */
  orthographic: boolean
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** A camera's own axes in the scene: to its right, up, and the way it looks. Without `roll`, as it would stand level. */
export function axesOf(view: { rotationX: number; rotationY: number; rotation: number }, roll = true): { right: Vec3; up: Vec3; forward: Vec3 } {
  const a = rad(view.rotationY)
  const b = rad(view.rotationX)
  const c = roll ? rad(view.rotation) : 0
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cc = Math.cos(c)
  const sc = Math.sin(c)
  return {
    right: { x: ca * cc + sa * sc * sb, y: sc * cb, z: -sa * cc + ca * sc * sb },
    up: { x: -ca * sc + sa * cc * sb, y: cc * cb, z: sa * sc + ca * cc * sb },
    forward: { x: -sa * cb, y: sb, z: -ca * cb },
  }
}

/** Whether a camera looks straight into the scene, neither panned nor tilted: every plane of one depth then faces it. */
export function looksStraight(view: { rotationX: number; rotationY: number }): boolean {
  return Math.abs(view.rotationX) < 1e-9 && Math.abs(view.rotationY) < 1e-9
}

/** How far ahead of the camera a thing shows at its own size: the picture's longer side by the lens and its zoom, over the sensor. */
export function fullDistance(view: View): number {
  return (longSide() * Math.max(0.1, view.focal) * Math.max(1e-6, view.zoom)) / SENSOR
}

/**
 * How far ahead a camera's frame is drawn, and where what is held on the screen sits (D362): where
 * its line of sight meets depth 0; looking along that plane or away from it, as far ahead as a
 * 50 mm lens frames the project.
 */
export function frameDistance(view: View): number {
  const f = axesOf(view).forward
  const t = Math.abs(f.z) > 1e-6 ? -view.z / f.z : -1
  return t > 1e-6 && t < 1e7 ? t : standDistance()
}

/** How many pixels of the picture a unit of the scene takes, a distance ahead of the camera. */
export function scaleAt(view: View, distance: number): number {
  return view.orthographic ? Math.max(1e-6, view.zoom) : fullDistance(view) / Math.max(1e-6, distance)
}

/** How many pixels of the picture a unit of the scene takes on the camera's frame: its zoom, while it stands where it does unless told. */
export function frameScale(view: View): number {
  return scaleAt(view, frameDistance(view))
}

/** How far a place in the scene is ahead of the camera, along its line of sight; behind it, less than nothing. */
export function aheadOf(view: View, place: Vec3): number {
  const f = axesOf(view).forward
  return (place.x - view.x) * f.x + (place.y - view.y) * f.y + (place.z - view.z) * f.z
}

/**
 * A camera's frame in the scene: the part of the plane facing it, as far ahead as its frame is
 * drawn, that its picture takes in. Its middle, its size, and its own axes, rolled.
 */
export function frameOf(view: View): { center: Vec3; width: number; height: number; right: Vec3; up: Vec3; forward: Vec3; distance: number } {
  const axes = axesOf(view)
  const distance = frameDistance(view)
  const k = 1 / scaleAt(view, distance)
  return {
    center: { x: view.x + axes.forward.x * distance, y: view.y + axes.forward.y * distance, z: view.z + axes.forward.z * distance },
    width: picture.width * k,
    height: picture.height * k,
    right: axes.right,
    up: axes.up,
    forward: axes.forward,
    distance,
  }
}

/**
 * The place a camera goes round (D428): `pivot` stays in the middle of the picture, at the
 * distance it is, while the camera's pan and tilt become `rotationY` and `rotationX`. Where the
 * camera then stands.
 */
export function roundPlace(pivot: Vec3, distance: number, rotationX: number, rotationY: number): Vec3 {
  const f = axesOf({ rotationX, rotationY, rotation: 0 }).forward
  return { x: pivot.x - f.x * distance, y: pivot.y - f.y * distance, z: pivot.z - f.z * distance }
}

/** The pan and the tilt, in degrees, with which a camera looks along a direction; the tilt alone when it looks straight up or down. */
export function anglesAlong(direction: Vec3): { rotationX: number; rotationY: number } {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1
  const y = Math.max(-1, Math.min(1, direction.y / length))
  const rotationX = (Math.asin(y) * 180) / Math.PI
  const flat = Math.hypot(direction.x, direction.z)
  const rotationY = flat < 1e-9 ? 0 : (Math.atan2(-direction.x, -direction.z) * 180) / Math.PI
  return { rotationX, rotationY }
}
