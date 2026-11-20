import { memo, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import * as THREE from 'three'
import { ColorPicker } from '../components/ColorPicker'
import { beginGesture, endGesture } from '../code/editor'
import { showMenu } from '../components/ContextMenu'
import { FontField } from '../components/FontField'
import { KindIcon } from '../components/KindIcon'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { groupMembers } from '../model/groups'
import { maskDrawnBy } from '../model/masks'
import { anchorIsSmooth, placeBetween, scalePathData, type AnchorKind, type Seg } from '../model/pathData'
import { attrSchema, CAMERA, GROUP, SHAPE, type AttrValue } from '../model/registry'
import { begun, existsAt, inView, keepInView, over as isOver, ownBounds, pathAngle, pathControlsWorld, pathInForce, pathOnlyBegun, positionAt, shapeOwnAnchors, shapeOwnPoints, shapeOwnSegs, shapeWorldCurve, shapeWorldFrame, shapeWorldOf, shapeWorldPoints, shownValue, travelFrame, type PathFrame, type Point } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { askSystemFonts } from '../project/fonts'
import { convertTextToShape } from '../project/textToShape'
import { cameraAt, camerasOf, journeyOf, NO_VIEW, parseColor, textPadding, textStyleAt, valueAt, viewOf, worldPose } from '../model/sample'
import { aheadOf, anglesAlong, axesOf, frameDistance, frameOf as cameraFrame, fullDistance, looksStraight, roundPlace, standDistance } from '../model/lens'
import { layoutOf, type TextStyle } from '../model/text'
import { DEFAULT_EASE_FRACTION, easingFor, unease } from '../model/easing'
import { addCamera, cameraInHand, resetCamera, roundAttr, cutHereItems, hideMenuItems, propertiesMenu, maskMenuItems, addMorph, addObject, addPath, beginFill, beginOutline, canEdit, paintFill, paintStroke, sketchLine, writeOnLine, setObjectProp, adjustDurations, appendPushedMove, addClassPath, appendShapePoints, beginShape, beginTimed, convertToShape, createGroup, deleteActions, deleteObjects, duplicateObjects, finishShape, insertPathAnchor, insertPathPoints, insertShapeAnchor, insertShapePoints, isShapeClosed, jumpToObject, lastActionIndex, overrideClassAction, pathAnchorCurved, pathAnchorKind, pathAnchorSmooth, recordShown, flushRecordedSoon, recordOutline, recordWriteOn, carryPath, pathBeginsAtObject, setPathAngle, pathEditable, pathEditableKind, pathOffset, pathSegmentKind, removePathPoints, removeShapePoints, requestRename, resizeAttrs, resizedValues, scaleShapeCurves, scaleShapePoints, setActionDestination, setActionTiming, setAttrsAtMany, setPathAnchorKind, setPathHandle, setPathPoints, setPathSegment, setPathShift, setShapeAnchorKind, setShapeClosed, setShapeHandle, setShapePoints, setShapeSegment, settleMorph, shapeAnchorCount, shapeAnchorCurved, shapeAnchorKind, shapeAnchorSmooth, shapeEditAnchors, shapeEditBase, shapeEditPieces, shapeEditable, shapeMorphRunning, shapeMorphSelected, shapeSegmentKind, smoothPath, smoothShape, smoothShapeRun, straightenPath, straightenShape, ungroup, type ShapeEditBase } from '../project/operations'
import { addUserObject, requestSavePreset } from '../project/userPresets'
import { noteGroup } from '../project/recording'
import { makeMover, outlineOf, resetMover, walk, type Mover, type Polygon, type Pushing } from '../preview/collide'
import { planeOfFrame, SceneRenderer, type ControlHandle, type Frame, type GuideLine, type Handle } from '../preview/SceneRenderer'
import { FLAT, lift, meet, samePlane, type Plane } from '../preview/planes'
import { Compass, type CompassAxis, type CompassHandle } from '../components/Compass'
import { CameraView } from '../preview/CameraView'
import { ROUND_RATE, Viewport, type Surface } from '../preview/Viewport'
import { dropTargets } from '../state/dropTargets'
import { animateHeld, animateKey, isAnimateKey, useAnimateKey } from '../state/animateKey'
import { matchHotkey, sayKey } from '../state/hotkeys'
import { OBJECT_KINDS, TRANSFORM_MODES, useStore, type ActionRef, type Pick, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const MODE_LABEL: Record<TransformMode, string> = { all: 'Transform', move: 'Move', rotate: 'Rotate', resize: 'Resize' }
const MODE_TIP: Record<TransformMode, string> = {
  all: 'Move, resize, and rotate by the handles; [animate] animates',
  move: 'Drag to move; [animate] animates',
  rotate: 'Drag to turn; [animate] animates',
  resize: 'Drag corners or edges; Alt keeps proportions; [animate] animates',
}
const BASE_ATTRS = ['x', 'y', 'z', 'rotation', 'rotationX', 'rotationY', 'scale', 'width', 'height', 'radius', 'fontSize', 'zoom']

/** A move of a view or of a camera (D428): across and up; round what is at the middle; closer; and for a camera alone, a turn on the spot. */
type CameraMove = 'across' | 'round' | 'closer' | 'turn'
/** How far a drag on a compass turns, in degrees for a pane pixel: its near side stays under the pointer (D428). */
const COMPASS_RATE = 180 / Math.PI / 24
/** How much closer a drag of a pane pixel brings a camera, as a share: half as far for each 140 pixels (D428). */
const CLOSER_RATE = 0.005
/** The nearest a camera is brought to what it looks at, in the scene's pixels: never through it. */
const NEAREST = 10

/** The side a view looks from to look along an end of an axis, as a camera's pan and tilt (D428): the front for z, the right for x, above for y. */
function facingOf(axis: CompassAxis): { yaw: number; pitch: number } {
  if (axis.axis === 'x') return { yaw: 90 * axis.sign, pitch: 0 }
  if (axis.axis === 'y') return { yaw: 0, pitch: -90 * axis.sign }
  return { yaw: axis.sign > 0 ? 0 : 180, pitch: 0 }
}

/** An angle as near another as it can be told, whole turns apart, so a camera animated to it takes the short way; half a turn either way, the smaller of the two. */
function nearAngle(angle: number, to: number): number {
  const turns = (to - angle) / 360
  const low = angle + 360 * Math.floor(turns)
  const high = low + 360
  const gap = Math.abs(to - low) - Math.abs(high - to)
  return Math.abs(gap) < 1e-9 ? (Math.abs(low) <= Math.abs(high) ? low : high) : gap < 0 ? low : high
}

/** The index of the point within `radius` of a place, the nearest when several are, or null. */
function nearestPoint(points: Point[], at: Point, radius: number): number | null {
  let best: number | null = null
  let bestDistance = radius
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i]!.x - at.x, points[i]!.y - at.y)
    if (d <= bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** How far along the segment from a to b the nearest point to p lies, 0 to 1. */
function fractionAlong(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  return length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
}

/** The index of the segment, from point i to point i + 1, within `radius` of a place, or null. */
function nearestSegment(points: Point[], at: Point, radius: number): number | null {
  let best: number | null = null
  let bestDistance = radius
  for (let i = 0; i + 1 < points.length; i++) {
    const d = distanceToSegment(at, points[i]!, points[i + 1]!)
    if (d <= bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

/** Whether two times are the same moment, to well under a frame. */
const sameMoment = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4

const NOTHING_KEPT: ReadonlySet<string> = new Set()

/**
 * What a recording keeps in view (D403): the things in hand, the selection and what its groups
 * carry, that are there now or were kept before. So a thing dragged or held as its life goes by
 * stays where it can be dragged again; let go of, it goes as its life says, and what was gone
 * before it was picked is not brought back.
 */
function keptInHand(s: { recording: boolean; model: SceneModel | null; selection: readonly string[] }, time: number, before: ReadonlySet<string>): ReadonlySet<string> {
  const model = s.model
  if (!s.recording || !model || s.selection.length === 0) return NOTHING_KEPT
  const next = new Set<string>()
  const take = (name: string): void => {
    const o = model.objects.find((x) => x.name === name)
    if (!o) return
    if (o.className === GROUP) {
      for (const member of groupMembers(model, name)) take(member)
      return
    }
    if (begun(o.at, time) && (before.has(name) || existsAt(model, o, time))) next.add(name)
  }
  for (const name of s.selection) take(name)
  return next.size === 0 ? NOTHING_KEPT : next
}

/**
 * The box around a path's line as the path lies (D394): its sides along the path's own axes,
 * turned by its `angle`, with room around a line that has no width; and the point the path turns
 * about, where it begins.
 */
function pathBoxOf(frame: PathFrame, angle: number, pixel: number): { frame: Frame; pivot: Point } | null {
  const pivot = frame.anchors[0] ?? frame.curve[0]
  if (!pivot) return null
  const a = (angle * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  let left = 0
  let right = 0
  let bottom = 0
  let top = 0
  for (const p of [...frame.curve, ...frame.anchors]) {
    const dx = p.x - pivot.x
    const dy = p.y - pivot.y
    const u = dx * cos + dy * sin
    const v = -dx * sin + dy * cos
    left = Math.min(left, u)
    right = Math.max(right, u)
    bottom = Math.min(bottom, v)
    top = Math.max(top, v)
  }
  const room = 14 * pixel
  const u = (left + right) / 2
  const v = (bottom + top) / 2
  return { frame: { x: pivot.x + u * cos - v * sin, y: pivot.y + u * sin + v * cos, rotation: angle, width: right - left + room * 2, height: top - bottom + room * 2 }, pivot: { x: pivot.x, y: pivot.y } }
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const first = points[0]!
  const last = points[points.length - 1]!
  let farthest = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last)
    if (d > farthest) {
      farthest = d
      index = i
    }
  }
  if (farthest <= tolerance) return [first, last]
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)]
}

type MenuItems = Parameters<typeof showMenu>[1]

/** What a press on an object picks (D247): the object, the outermost group that holds it, or every object of its first class. */
function pickTargets(model: SceneModel, name: string, pick: Pick): string[] {
  if (pick === 'group') {
    const holders = model.objects.filter((o) => o.className === GROUP && groupMembers(model, o.name).includes(name)).map((o) => o.name)
    const outer = holders.find((h) => !holders.some((other) => other !== h && groupMembers(model, other).includes(h)))
    return [outer ?? name]
  }
  if (pick === 'class') {
    const cls = model.objects.find((o) => o.name === name)?.classes[0]
    const members = cls ? (model.classes.get(cls) ?? []) : []
    return members.length > 0 ? members : [name]
  }
  return [name]
}

/** Space kept around the picture in the Camera view, in pane pixels: what the Preview view keeps around the frame when it fits it. */
const CAMERA_PAD = 40
const CAMERA_PAD_BESIDE = 14
/** How near a camera's frame a press picks it, in pane pixels (D361). */
const CAMERA_REACH_PX = 5


/** Where a press on a line puts a new point: after a span's point of a points shape or path (D233), or on a segment of curves, a fraction of the way along it (D240, D246). */
type LineInsert = { kind: 'points'; at: number } | { kind: 'curves'; seg: number; t: number }

/** A control shown for a picked anchor: whose, which side, and where (D240). */
type AnchorHandle = ControlHandle & { index: number; which: 'in' | 'out' }

/** The selected Shape in the Shape tool: its line where it is drawn, what can be edited, the pieces of its line with where each point came from, and the controls shown (D233, D240). */
interface ShownShape {
  name: string
  frame: PathFrame & { closed: boolean }
  editable: 'points' | 'curves' | null
  pieces: { curve: Point[]; at: { seg: number; t: number }[] }[]
  handles: AnchorHandle[]
}

interface Drag {
  /** `plain`: edit the values at the playhead. `timed`: Shift, make an action. `destination`: the selected action's end follows. `recorded`: a recording is running, and the drag is written as it is done (D397). */
  kind: 'plain' | 'timed' | 'destination' | 'recorded'
  op: 'move' | 'rotate' | 'resize'
  /** What the gesture changes: each of several selected objects, or the one object or group (D96, D124). */
  names: string[]
  primary: string
  /** The primary is a group: it turns and scales around the center of its box, which a plain drag keeps in place. */
  group: boolean
  /** Several objects a Shift-drag makes into a group on the first move (D124). */
  grouping: string[] | null
  handle: Handle | null
  /** Alt at the start: a corner keeps the proportions. */
  keepAspect: boolean
  /** The resize keeps the far side or the center in place (D104). */
  anchor: 'edge' | 'center'
  actionIndex: number
  /** The selected action came from a class statement; the object overrides it when the drag begins (D80). */
  derived: boolean
  /** Where the playhead goes when the drag begins, so the end state being written is what shows (D102). */
  showTime: number | null
  startX: number
  startY: number
  /** The gizmo frame when the drag began: what a turn or a scale happens around. */
  frame: Frame
  /** Each thing's values at the time being edited, when the drag began. */
  base: Map<string, Record<string, number>>
  /** Each thing's center in the frame's own axes when the drag began, for turning and scaling several at once. */
  locals: Map<string, { x: number; y: number }>
  /** The dragged things' upright box when the drag began, for edge snapping and collision; null for turns and resizes (D135, D136). */
  box0: Box | null
  /** Every other visible object's upright box when the drag began, and the camera frame's. */
  others: { name: string; box: Box }[]
  frameBox: Box
  /** The dragged outlines and everyone else's, moved along as the drag goes, for collision; null for turns and resizes (D136). */
  movers: { dragged: Mover; obstacles: Mover[] } | null
  /** How far the dragged thing's place at the time being edited is from where its animation starts: an animation's push sweeps from the start (D206). */
  sweepOrigin: Point
  /** A Shape being resized: its points, or its path, as the drag began, when they are written out, with the center of its box and its scale in its own space (D233, D240). */
  shapeBase: { points: Point[] | null; segs: Seg[] | null; center: Point; scale: number } | null
  /** The target of the morph a Shift resize of a Shape wrote, as it began, which the drag scales (D257). */
  morphBase?: ShapeEditBase | null
  /** The pointer's last angle around the gizmo center, and the turn so far, in radians; turns add up past a full circle (D105). */
  lastAngle: number
  turned: number
  /** Pointer position in the gizmo frame's own axes when the drag began. */
  local0: { x: number; y: number }
  moved: boolean
  /** The Shift-drag has written its action. */
  created: boolean
  /** The playhead has been moved to the end of what a Shift-drag made. */
  shown: boolean
  /** What a click without movement does. */
  click: 'object' | 'none'
  /** The values the drag has written so far, as name:attr, so one brought back to its start is still written. */
  touched: Set<string>
  /** The moves written for what this animation's drag has pushed, by object, and how far each was pushed last (D136). */
  pushedActions: Map<string, number>
  pushedShifts: Map<string, { x: number; y: number }>
  /** While a recording runs: the playhead's time when what the drag meets was last looked at, since things come, go, and move under it (D412). */
  metAt?: number
  /** While a recording runs: what a group in hand carries, of what is in view, whose lives go with its animation (D403). */
  carried?: string[]
  /** A move of the camera in its own view (D428): what the camera shows for a drag of so many pixels, in place of a move across the scene. On the Camera view the picture follows the pointer, so the camera goes the other way (D361). */
  custom?: (dx: number, dy: number) => Record<string, number>
  /** What decides together where such a move is written (D356): everything it changes. */
  together?: string[]
  /** A move that carries the thing in the plane that faces the view (D430): where the thing is as the drag begins, and whether the view looks straight into the scene, so nothing goes in depth. */
  lifted?: { at: THREE.Vector3; depth: boolean }
  /** Where the pointer is on the pane as the drag begins. */
  paneX: number
  paneY: number
  /** What a press let go of where it began does. */
  onClick?: () => void
}

/** What a box drawn on the pane holds, as the view it was drawn in has it (D89, D366). */
interface Boxed {
  has: (p: Point) => boolean
  objects: () => string[]
  /** The cameras whose frames it touches, for the Camera tool (D373); none in the Camera view, which draws no camera. */
  cameras: () => string[]
}

interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}

/** How close, in screen pixels, a dragged edge or center must come to another to snap to it (D135). */
const SNAP_REACH_PX = 8

/** An upright box in world coordinates. */
interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

function toBox(frame: Frame): Box {
  return { left: frame.x - frame.width / 2, right: frame.x + frame.width / 2, top: frame.y + frame.height / 2, bottom: frame.y - frame.height / 2 }
}

/**
 * The nearest alignment of a dragged span's low edge, center, or high edge with one of the
 * candidates' three marks, within reach: how far to shift, and where the guide goes (D135).
 */
function snapAxis(lo: number, hi: number, candidates: number[][], reach: number): { shift: number; at: number } | null {
  const mine = [lo, (lo + hi) / 2, hi]
  let best: { shift: number; at: number } | null = null
  for (const marks of candidates)
    for (const mark of marks)
      for (const m of mine) {
        const shift = mark - m
        if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: mark }
      }
  return best
}

/** A world point in a frame's own axes: relative to its center, unrotated. */
function toLocal(frame: Frame, p: { x: number; y: number }): { x: number; y: number } {
  const a = (-frame.rotation * Math.PI) / 180
  const dx = p.x - frame.x
  const dy = p.y - frame.y
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A point in a frame's own axes, back in the world. */
function toWorld(frame: Frame, l: { x: number; y: number }): { x: number; y: number } {
  const a = (frame.rotation * Math.PI) / 180
  return { x: frame.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: frame.y + l.x * Math.sin(a) + l.y * Math.cos(a) }
}

/** The values a drag starts from: as drawn, through the object's groups (D124). */
function baseValues(model: SceneModel, obj: SceneObject, time: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const attr of BASE_ATTRS) {
    const v = shownValue(model, obj, attr, time)
    out[attr] = typeof v === 'number' ? v : 0
  }
  return out
}

/** The group a selection of exactly one group is, or null. */
function groupOf(model: SceneModel, selection: string[]): SceneObject | null {
  return selection.length === 1 ? (model.objects.find((o) => o.name === selection[0] && o.className === GROUP) ?? null) : null
}

/** Where the playhead rests after a Shift gesture: where it was, or in Chain mode the end of the chain (D103, D127). */
function restingTime(gesture: { restore: number; from: number; editing?: boolean }): number {
  const s = useStore.getState()
  if (gesture.editing) return gesture.restore
  return s.chain && s.pin === 'start' ? gesture.from : gesture.restore
}

/**
 * The world view. The wheel zooms around the cursor, Shift and the wheel over an object with
 * selected actions changes their durations (D97), otherwise Shift and the wheel pan sideways,
 * Alt and the wheel pan up and down, the middle button drags the view, and scrollbars show
 * where the view sits in a stable area around the frame (D82, D85). Click selects, Ctrl-click
 * adds or removes, a drag on empty space selects what it touches, Ctrl extends (D89); the mode
 * is set by the buttons above alone (D79, revised by D282). The selection shows handles for its mode
 * (D86): on the one object, on a group's own box, or on the upright box around an ad-hoc
 * selection (D96, D124): the body moves, corners and edges resize keeping the far side or the
 * center in place (D104), the handle above rotates around the center of the box, past a full
 * turn if dragged on (D105). A drag writes end states directly and shows them: a running action
 * gets its end edited and the playhead moves to that end (D102). Shift-drag makes an animation
 * pinned to start or end here (D27, D103), the wheel then sets its length, and the playhead
 * returns when Shift is released, or rests at the end of the chain in Chain mode (D127). A plain
 * drag on several objects edits each of them; a plain drag on a group edits the group itself, a
 * Shift-drag on several objects makes them a group and animates it, and a Shift-drag on a group
 * animates the group (D124). Snap rounds positions and sizes to a grid and
 * angles to a step (D91). A tool button then a click places an object. Right-click adds objects
 * or acts on the one under the cursor.
 */
/** The readout of the playhead time under the view: it alone follows every frame. */
const PreviewTime = memo(function PreviewTime({ fps }: { fps: number }) {
  // The time of the frame that shows: the playhead's, or the one under the timeline's razor (D385).
  const time = useStore((s) => (s.playing ? s.time : (s.peekTime ?? s.time)))
  return <span>{formatTime(time, fps)}</span>
})

export function PreviewPane() {
  const animateName = useAnimateKey()
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** The Preview view's part of the pane, and the Camera view's, with its canvas and the name it shows (D359). */
  const worldRef = useRef<HTMLDivElement>(null)
  const cameraPanelRef = useRef<HTMLDivElement>(null)
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null)
  const cameraNameRef = useRef<HTMLElement>(null)
  /** The names of the cameras over the Preview view, each at its frame's corner (D361). */
  const tagsRef = useRef<HTMLDivElement>(null)
  /** The Camera view (D360, D366), and what fits it to its part of the pane again. */
  const cameraViewRef = useRef<{ view: CameraView; fit: () => void } | null>(null)
  /** The view the gesture in hand began in (D366): it keeps to it wherever the pointer goes. */
  const gestureSurfaceRef = useRef<Surface | null>(null)
  /** The plane the gesture in hand works on (D434), where that is not the plane of what is selected: the plane of what it took up, or the scene's own for what it makes. */
  const gesturePlaneRef = useRef<Plane | null>(null)
  /** Gives both views the plane in hand as it is now, before a place on the pane is asked for. */
  const freshPlaneRef = useRef<() => void>(() => undefined)
  /** The compasses in the views' corners (D428, D435). */
  const worldCompassRef = useRef<CompassHandle>(null)
  const cameraCompassRef = useRef<CompassHandle>(null)
  /** A drag with the right button has moved a view or a camera: the menu its release would open stays shut. */
  const menuShutRef = useRef(false)
  /** Lays out what is drawn over the scene for one of the views, when it was last laid out for the other: before a press looks for a handle there. */
  const layoutRef = useRef<(which: 'world' | 'camera') => void>(() => undefined)
  const viewportRef = useRef<Viewport | null>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /**
   * A Shift gesture in progress (D103): from the moment Shift is held over the pane with Starts at
   * playhead, the playhead shows where the proposed animation would end, so a drag is seen and
   * written at that end; it returns to `restore` when Shift is released. `from` is where the next
   * animation starts: where the playhead was, or in Chain mode the end of the last one made, where
   * the playhead then rests (D127). `duration` is the proposed length, which Shift and the wheel
   * change before the animation exists. With `editing`, an animation was selected when Shift was
   * held: the playhead shows its end, a drag sets its end state, and nothing new is chained (D157).
   */
  const gestureRef = useRef<{ restore: number; from: number; duration: number; editing?: boolean; editEnd?: 'start' | 'end' } | null>(null)
  /** Whether the pointer has moved over the pane since anything else took the focus, so Shift held here starts a gesture and Shift typed elsewhere does not. */
  const hoverRef = useRef(false)
  /** The turn plain drags have given the box's axes since the selection was made; the box stays turned until it changes (D116). */
  const axesRef = useRef(0)
  const paintRef = useRef<() => void>(() => undefined)
  const [dragging, setDragging] = useState<'aspect' | null>(null)
  /** The paths shown right now (D194, D209, D405): the Path tool's selected one, with its line and anchors and whether its points can be edited, and the others, lines only. */
  const pathRef = useRef<{ primary: { ref: ActionRef; frame: PathFrame; editable: boolean; kind: 'points' | 'curves' | null; handles: AnchorHandle[] } | null; others: { ref: ActionRef; frame: PathFrame }[] } | null>(null)
  /** What the recording keeps in view (D403): the things in hand whose lives have gone by while it runs. */
  const keptRef = useRef<ReadonlySet<string>>(NOTHING_KEPT)
  /** The selected Shape in Edit mode, with its line where it is drawn and what can be edited (D233, D240). */
  const shapeRef = useRef<ShownShape | null>(null)
  /** The Shape the Object tool is drawing, point by point (D233). */
  const shapeDraftRef = useRef<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  /** The path Create is drawing (D414): the one it made, or one taken up by its last point, and where the playhead was then. */
  const pathDraftRef = useRef<{ object: string; index: number; time: number } | null>(null)
  const [pathDraft, setPathDraft] = useState<{ object: string; index: number; time: number } | null>(null)
  /** A line being drawn for the selected path, in pane pixels, until the pointer is let go (D194). */
  const [sketch, setSketch] = useState<{ x: number; y: number }[] | null>(null)
  /** Whether the trail being drawn is a line of the pencil's, shown as it will be, rather than a path (D311). */
  const [sketchInk, setSketchInk] = useState<number | false>(false)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const settings = useStore((s) => s.settings)
  // The playhead matters to the pane's own markup only through the text bar, so it is followed only while Texts can be selected.
  const time = useStore((s) => (s.selection.length > 0 && s.tool === 'select' ? s.time : 0))
  const tool = useStore((s) => s.tool)
  // The Texts among the selection, for the text bar (D270), and a Text being edited in place.
  const fonts = useStore((s) => s.fonts)
  const systemFonts = useStore((s) => s.systemFonts)
  /** Paint's side (D299): the fill or the outline; the colors and the width are the shared style (D303, D304). */
  const [paintMode, setPaintMode] = useState<'fill' | 'stroke'>('fill')
  const paintModeRef = useRef(paintMode)
  paintModeRef.current = paintMode
  const style = useStore((s) => s.shapeStyle)
  const styleRef = useRef(style)
  styleRef.current = style
  const setShapeStyle = useStore((s) => s.setShapeStyle)
  const rememberColor = useStore((s) => s.rememberColor)
  /** The dropper (D294): the next click takes an object's fill as the color. */
  const [dropping, setDropping] = useState(false)
  const droppingRef = useRef(dropping)
  droppingRef.current = dropping
  const pickColor = (name: string, time: number) => {
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === name)
    const outline = paintModeRef.current === 'stroke'
    const fill = obj && s.model ? valueAt(s.model, obj, outline ? 'stroke' : 'fill', time) : undefined
    if (typeof fill === 'string' && parseColor(fill)) {
      setShapeStyle(outline ? { stroke: fill } : { fill })
      rememberColor(fill)
    } else s.setNotice('Nothing here has a color to take')
    setDropping(false)
  }
  const [textEdit, setTextEdit] = useState<{ name: string; original: string; value: string; left: number; top: number; width: number; height: number; style: TextStyle; zoom: number; padding: number; paddingTop: number; lineHeight: number; color: string } | null>(null)
  const textEditRef = useRef(textEdit)
  textEditRef.current = textEdit
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const selectedActions = useStore((s) => s.selectedActions)
  const transformMode = useStore((s) => s.transformMode)
  const anchor = useStore((s) => s.anchor)
  const setTool = useStore((s) => s.setTool)
  const addKind = useStore((s) => s.addKind)
  const addPreset = useStore((s) => s.addPreset)
  const setAddPreset = useStore((s) => s.setAddPreset)
  const userPresets = useStore((s) => s.userPresets)
  const pathMode = useStore((s) => s.pathMode)
  const shapeMode = useStore((s) => s.shapeMode)
  const setShapeMode = useStore((s) => s.setShapeMode)
  const notice = useStore((s) => s.notice)
  // A notice, about an import, stays for a moment (D241).
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useStore.getState().setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  // A Shape being drawn ends with Enter, closed, or Escape, as a line (D233); leaving the Shape tool's Create mode ends it as a line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shapeDraftRef.current) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return
      // The keys as the preferences have them (D260): close the shape, or leave it a line.
      const hit = matchHotkey(e, 'preview', useStore.getState().prefs.hotkeys ?? {})
      if (hit?.id !== 'closeShape' && hit?.id !== 'escape') return
      endShapeDraft(hit.id === 'closeShape')
      if (hit.id === 'closeShape') e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // The draft lives in a ref; the handler reads it when a key comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (shapeDraftRef.current && (tool !== 'shape' || shapeMode !== 'create')) endShapeDraft(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, shapeMode])
  const setPathMode = useStore((s) => s.setPathMode)
  // The path being drawn is Create's alone: another mode or tool lets it go (D414).
  useEffect(() => {
    if (pathDraftRef.current && (tool !== 'path' || pathMode !== 'create')) takeUpPath(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pathMode])
  /** Whether a press on empty space in Create goes on with the selected path (D414), which the hint says. */
  const drawingPath = useStore((s) => {
    const ref = s.selectedActions.length === 1 ? s.selectedActions[0]! : null
    if (ref) {
      const action = s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
      if (action?.verb !== 'path') return false
      return pathOnlyBegun(action) || (!!pathDraft && pathDraft.object === ref.object && pathDraft.index === ref.index && sameMoment(s.time, pathDraft.time))
    }
    // The path shown for the one thing selected (D411) is gone on with only while it has but its first point.
    if (s.selectedActions.length > 0 || s.selection.length !== 1) return false
    const one = s.model?.objects.find((o) => o.name === s.selection[0])
    const shown = one ? pathInForce(one.actions.map((action) => ({ action })).filter(({ action }) => action.verb === 'path' && !action.classAction && !action.overridden), s.time) : undefined
    return !!shown && pathOnlyBegun(shown.action)
  })
  const previewView = useStore((s) => s.previewView)
  const previewSplit = useStore((s) => s.previewSplit)
  const setAddKind = useStore((s) => s.setAddKind)
  const setTransformMode = useStore((s) => s.setTransformMode)
  const setAnchor = useStore((s) => s.setAnchor)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const world = worldRef.current
    const cameraPanel = cameraPanelRef.current
    const cameraCanvas = cameraCanvasRef.current
    if (!host || !canvas || !world || !cameraPanel || !cameraCanvas) return
    const viewport = new Viewport(canvas)
    const renderer = new SceneRenderer()
    viewport.content.add(renderer.group)
    // The Camera view (D360, D366): the same scene, drawn through the camera that has the picture, on a canvas of its own, fitted to its part of the pane.
    const cameraView = new CameraView(cameraCanvas)
    const fitCamera = () => {
      const s = useStore.getState()
      // Alone, the picture keeps the space the Preview view keeps around the frame, so it sits where the fitted frame sat; beside the Preview view it keeps less, to be as large as its part of the pane lets it.
      cameraView.fit(s.previewView !== 'preview', cameraPanel.getBoundingClientRect(), host.getBoundingClientRect(), s.settings, new THREE.Color(parseColor(s.settings.background) ? s.settings.background : '#1c1c1c'), s.previewView === 'camera' ? CAMERA_PAD : CAMERA_PAD_BESIDE)
    }
    cameraViewRef.current = { view: cameraView, fit: fitCamera }
    /** What is drawn over the scene, as each view has it: the selection but for the Shape tool, whose own handles show it; every handle of a camera with the Camera tool; and in the Camera view no camera, that view being the camera's own. */
    let laidOut: 'world' | 'camera' = 'world'
    const overlayFor = (which: 'world' | 'camera') => {
      const s = useStore.getState()
      const inHand = s.tool === 'shape' ? [] : s.selection
      const cameras = new Set(s.model ? camerasOf(s.model).map((c) => c.name) : [])
      // The Camera tool has the handles of cameras alone (D373): with anything else selected it shows what is selected and moves none of it.
      const camerasInHand = inHand.length > 0 && inHand.every((n) => cameras.has(n))
      const surface: Surface = which === 'camera' ? cameraView : viewport
      return {
        selection: which === 'camera' ? inHand.filter((n) => !cameras.has(n)) : inHand,
        mode: s.tool === 'camera' ? ('all' as const) : s.transformMode,
        pixel: 1 / surface.zoom,
        axes: axesRef.current,
        anchored: s.anchored,
        handles: s.tool === 'select' || (s.tool === 'camera' && camerasInHand),
        cameras: which === 'world',
        // What is in hand is laid out on its own plane (D434). In a view with perspective a pane pixel is more of the scene the farther a thing is, so each thing's lines are sized where it is; in a turned Preview view the cameras stand in the scene as bodies (D435).
        plane: surface.plane,
        scale: which === 'camera' || !viewport.flat ? (place: THREE.Vector3) => surface.scaleAt(place) : undefined,
        bodies: which === 'world' && !viewport.straight,
      }
    }
    /** The plane in hand (D434): the gesture's own while one runs, else the plane of the first thing selected, as it is drawn. */
    const planeInHand = (): Plane => {
      if (gesturePlaneRef.current) return gesturePlaneRef.current
      const first = useStore.getState().selection[0]
      return first ? renderer.planeOf(first) : FLAT
    }
    freshPlaneRef.current = () => {
      const plane = planeInHand()
      viewport.plane = plane
      cameraView.plane = plane
    }
    layoutRef.current = (which) => {
      if (laidOut === which) return
      renderer.layout(overlayFor(which))
      laidOut = which
    }
    // The masks' pictures are drawn through the view's camera before each drawing (D337).
    viewport.beforeRender = (gl, camera) => {
      renderer.orderFor(camera)
      renderer.renderMasks(gl, camera)
    }
    // How large a thing shows, in the pixels of the screen, in whichever view shows it larger: what the detail of a circle follows (D424).
    renderer.viewDetail = (place) => Math.max(useStore.getState().previewView !== 'camera' ? viewport.scaleAt(place) : 0, cameraView.shown ? cameraView.scaleAt(place) : 0) * window.devicePixelRatio
    viewportRef.current = viewport
    rendererRef.current = renderer
    if (import.meta.env.DEV) Object.assign((window as unknown as { __quickAnimator?: object }).__quickAnimator ?? {}, { getRenderer: () => renderer, getViewport: () => viewport, getCameraView: () => cameraView })

    const paint = () => {
      const s = useStore.getState()
      // The moment drawn: the playhead's, or while the timeline's razor is over the rows, the one it would cut at (D385).
      const now = s.playing ? s.time : (s.peekTime ?? s.time)
      // While Shift looks ahead, whatever was alive where the gesture began stays drawn (D138).
      // The selection shows in every tool but the Shape tool, whose handles show it; the box's handles belong to Select alone (D208, D236, D247).
      // The cameras' frames show when asked, and always with the Camera tool, which picks by them (D373, D374).
      // While a recording runs, what is in hand stays in view though its life has gone by (D403).
      keptRef.current = keptInHand(s, now, keptRef.current)
      keepInView(keptRef.current)
      renderer.setView({ hidden: s.hidden, held: s.selection, showMasks: s.showMasks, showCameras: s.showCameras || s.tool === 'camera' })
      const over = overlayFor('world')
      renderer.update(s.model, now, over.selection, over.mode, over.pixel, over.axes, gestureRef.current?.restore, over.anchored, over.handles)
      laidOut = 'world'
      // The plane in hand, for both views (D434): what is selected lies in it as it is drawn now, and places on the pane are places on it.
      freshPlaneRef.current()
      // Which paths show (D389, D405): with Show Paths, every path running at the moment drawn, of whatever is there then, the path of what is selected in the selection's own color; with the Path tool, also the path of what is selected, the one in force at that moment, and the selected path, which shows its shape and, with its points written out, a handle on each (D192, D194). No other tool shows a path of its own. One hidden for now stays hidden (D209).
      const found: { ref: ActionRef; frame: PathFrame; lead: boolean; held: boolean }[] = []
      if (s.model) {
        const ref = s.selectedActions.length === 1 ? s.selectedActions[0] : undefined
        const inPathTool = s.tool === 'path'
        for (const o of s.model.objects) {
          const own = o.actions.map((action, index) => ({ action, index })).filter(({ action }) => action.verb === 'path' && !action.overridden)
          if (own.length === 0) continue
          // Of a selected object's paths, the Path tool shows the one in force now.
          const inForce = inPathTool && s.selection.includes(o.name) ? (pathInForce(own, now)?.index ?? -1) : -1
          const there = inView(s.model, o, now) && !s.hidden.includes(o.name)
          for (const { action, index } of own) {
            // The path in hand is the Path tool's: the one selected, with its handles; or, with one thing selected and none of its animations, that thing's path in force, its points showing though nothing more is selected, so a press on one picks the path and moves the point (D411).
            const lead = inPathTool && (ref ? ref.object === o.name && ref.index === index : s.selectedActions.length === 0 && s.selection.length === 1 && s.selection[0] === o.name && inForce === index)
            const running = s.showPaths && there && begun(action.start, now) && !isOver(action.end, now)
            if (!lead && !running && inForce !== index) continue
            if (!lead && s.hiddenPaths.includes(`${o.name}:${index}`)) continue
            // The line the object actually travels, whatever else moves it (D223).
            const frame = travelFrame(s.model, o, action)
            if (!frame || frame.curve.length === 0) continue
            found.push({ ref: { object: o.name, index }, frame, lead, held: !inPathTool && s.selection.includes(o.name) })
          }
        }
      }
      const lead = found.find((p) => p.lead)
      let primary: NonNullable<typeof pathRef.current>['primary'] = null
      const pathRound: boolean[] = []
      if (lead && s.model) {
        const kind = pathEditableKind(lead.ref)
        const handles: AnchorHandle[] = []
        // A curves path shows the controls of its picked anchors (D246), and its smooth anchors round (D252).
        if (kind === 'curves') {
          const o = s.model.objects.find((x) => x.name === lead.ref.object)
          const action = o?.actions[lead.ref.index]
          if (o && action)
            pathControlsWorld(s.model, o, action).forEach((c, index) => {
              const at = lead.frame.anchors[index]
              if (!at) return
              pathRound[index] = anchorIsSmooth({ x: at.x, y: at.y, in: c.in, out: c.out })
              if (!s.pathPoints.includes(index)) return
              if (c.in) handles.push({ index, which: 'in', anchor: at, point: c.in })
              if (c.out) handles.push({ index, which: 'out', anchor: at, point: c.out })
            })
        }
        primary = { ref: lead.ref, frame: lead.frame, editable: kind !== null, kind, handles }
      }
      const others = found.filter((p) => !p.lead).map((p) => ({ ref: p.ref, frame: p.frame, held: p.held }))
      pathRef.current = primary || others.length > 0 ? { primary, others } : null
      // A path whose shape is code has no points to drag and is drawn dashed to say so (D226).
      renderer.setPath(primary ? primary.frame.curve : null, 1 / viewport.zoom, primary?.editable ? primary.frame.anchors : null, s.pathPoints, !!primary && !primary.editable, primary?.handles ?? [], pathRound)
      renderer.setOtherPaths(
        others.map((o) => {
          // Each line lies on the plane of the thing that goes along it (D434).
          const plane = renderer.planeOf(o.ref.object)
          return plane === FLAT ? { points: o.frame.curve, dashed: !pathEditable(o.ref), held: o.held } : { points: o.frame.curve, dashed: !pathEditable(o.ref), held: o.held, z: plane.z, turn: plane.turn }
        }),
        1 / viewport.zoom,
      )
      // With Move path, the path in hand wears a box, with the handle that turns it (D394).
      const turning = primary && s.tool === 'path' && s.pathMode === 'move' ? s.model?.objects.find((o) => o.name === primary.ref.object)?.actions[primary.ref.index] : undefined
      renderer.setPathBox(primary && turning ? pathBoxOf(primary.frame, pathAngle(turning), 1 / viewport.zoom) : null, 1 / viewport.zoom)
      // The Shape tool shows the selected Shape's points as handles when they are written out, in Create mode and in Edit mode (D233, D236), or its curves' anchors, with the controls of the picked ones (D240).
      let shape: ShownShape | null = null
      const shapeRound: boolean[] = []
      const model = s.model
      // With one of the shape's morphs selected, the handles are its target's (D257).
      if (model && s.tool === 'shape' && s.selection.length === 1 && (s.selectedActions.length === 0 || shapeMorphSelected(s.selection[0]!))) {
        const o = model.objects.find((x) => x.name === s.selection[0] && x.className === SHAPE)
        if (o) {
          const editable = shapeEditable(o.name)
          const frame = shapeWorldFrame(model, o, now)
          const handles: ShownShape['handles'] = []
          let pieces: ShownShape['pieces'] = [{ curve: frame.curve, at: [] }]
          if (editable === 'curves') {
            const world = (p: Point): Point => shapeWorldOf(model, o, now, p)
            const anchors = shapeEditAnchors(o.name)
            frame.anchors = anchors.map(world)
            pieces = shapeEditPieces(o.name).map((piece) => ({ curve: piece.curve.map(world), at: piece.at ?? [] }))
            frame.curve = pieces.flatMap((piece) => piece.curve)
            anchors.forEach((a, index) => {
              // A smooth anchor is drawn round (D252); a picked one shows its controls.
              shapeRound[index] = anchorIsSmooth(a)
              if (!s.pathPoints.includes(index)) return
              const at = frame.anchors[index]!
              if (a.in) handles.push({ index, which: 'in', anchor: at, point: world(a.in) })
              if (a.out) handles.push({ index, which: 'out', anchor: at, point: world(a.out) })
            })
          }
          shape = { name: o.name, frame, editable, pieces, handles }
        }
      }
      shapeRef.current = shape
      renderer.setShapeHandles(shape?.editable ? shape.frame.anchors : null, 1 / viewport.zoom, shape?.editable ? s.pathPoints : [], shape?.handles ?? [], shapeRound)
      // The frame sits where the camera that has the picture puts it (D357, D358); with none, at the scene's middle.
      const live = s.model ? cameraAt(s.model, now, gestureRef.current?.restore) : null
      const taken = live && s.model ? viewOf(s.model, live, now) : NO_VIEW
      viewport.setFrame(taken)
      const worldShown = s.previewView !== 'camera'
      // Each camera alive wears its name at its frame's top left corner, the one that has the picture lit (D361).
      const tags = tagsRef.current
      if (tags) {
        const frames = new Map(renderer.cameras().map((c) => [c.name, c]))
        for (const el of Array.from(tags.children) as HTMLElement[]) {
          const c = frames.get(el.dataset['camera'] ?? '')
          if (!c || !c.shown || !worldShown) {
            el.classList.remove('shown')
            continue
          }
          const a = (c.frame.rotation * Math.PI) / 180
          const lx = -c.frame.width / 2
          const ly = c.frame.height / 2
          const at = viewport.toPane(c.frame.x + lx * Math.cos(a) - ly * Math.sin(a), c.frame.y + lx * Math.sin(a) + ly * Math.cos(a), planeOfFrame(c.frame))
          el.classList.add('shown')
          el.style.left = `${at.x}px`
          el.style.top = `${at.y}px`
          el.classList.toggle('live', c.live)
          el.classList.toggle('selected', s.selection.includes(c.name))
        }
      }
      if (worldShown) {
        // Laid out again, now that where everything lies is known: on the plane in hand, each line as wide as its own depth makes a pixel (D434).
        renderer.layout(overlayFor('world'), false)
        viewport.render()
      }
      // Each compass shows the scene's axes as its view sees them (D428): the Preview view's, and the camera's with its roll.
      const seen = viewport.axes()
      worldCompassRef.current?.set(seen.right, seen.up, seen.forward)
      const through = axesOf(taken)
      cameraCompassRef.current?.set(through.right, through.up, through.forward)
      // What the camera sees (D360), with what is in hand laid out again in its own pixels (D366), and its name beside the view's. A scene with nothing off depth 0 is taken flat, as it always was (D434).
      cameraView.setView(taken, renderer.depthless)
      if (cameraView.shown) {
        renderer.layout(overlayFor('camera'))
        laidOut = 'camera'
        cameraView.draw(renderer, true)
        const named = cameraNameRef.current
        const text = live ? live.name : 'none'
        if (named && named.textContent !== text) named.textContent = text
        // Lit is for a camera that has the picture; with none, the word is dim.
        named?.classList.toggle('none', !live)
      }
    }
    paintRef.current = paint
    // Where a dragged preset lands in the preview, and the middle of the view for one dropped on the timeline (D219).
    dropTargets.preview = (clientX, clientY) => {
      // Whichever view it is dropped on takes it (D366).
      const bounds = host.getBoundingClientRect()
      const inside = clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
      const paneX = clientX - bounds.left
      const paneY = clientY - bounds.top
      const panel = cameraPanel.getBoundingClientRect()
      const inCamera = cameraView.shown && clientX >= panel.left && clientX <= panel.right && clientY >= panel.top && clientY <= panel.bottom
      const surface: Surface = inCamera ? cameraView : viewport
      // What is dropped lands on the scene's own plane, whatever is in hand (D434).
      const kept = surface.plane
      surface.plane = FLAT
      const world = surface.toWorld(paneX, paneY)
      const zoom = surface.zoom
      surface.plane = kept
      return { inside, world, hit: inside && (!inCamera || cameraView.holds(paneX, paneY)) ? renderer.pick(surface.camera, surface.toNdc(paneX, paneY)) : null, zoom }
    }
    dropTargets.previewCenter = () => {
      // The middle of what is looked at: the picture's, when the Camera view is alone.
      const v = (useStore.getState().previewView === 'camera' ? cameraView : viewport).viewRect()
      return { x: (v.left + v.right) / 2, y: (v.top + v.bottom) / 2 }
    }
    viewport.onChange = () => {
      setZoom(viewport.scale)
      paint()
      bump()
    }
    const unsubscribe = useStore.subscribe((s, prev) => {
      // The axes last as long as the same things stay selected; picking one of their actions is not a change of selection.
      if (s.selection.length !== prev.selection.length || s.selection.some((n, i) => n !== prev.selection[i])) axesRef.current = 0
      paint()
      if (s.model !== prev.model) bump()
    })
    paint()

    // Each view fits its own part of the pane (D359); the Preview view put away keeps its size for when it is back.
    const observer = new ResizeObserver(() => {
      const { width, height } = world.getBoundingClientRect()
      if (width > 0 && height > 0) viewport.resize(width, height, window.devicePixelRatio)
      fitCamera()
      paint()
    })
    observer.observe(world)
    observer.observe(cameraPanel)

    // The wheel over the Camera view (D361, D369): the camera zooms, whatever the tool. It is the lens that zooms and nothing else (D426): the camera stays where it is, so the picture grows from its middle, wherever the pointer is. A run of ticks is one undo step. A scene with no camera gets one.
    let wheelRun: ReturnType<typeof setTimeout> | null = null
    /** Through a run of ticks: the zoom the wheel has asked for, finer than what is written, so ticks too small to change the written zoom add up; and the zoom the view was left with, by which a change from elsewhere is told. */
    let wheelZoom: { name: string; asked: number; left: number } | null = null
    /** A tick of the wheel on the camera joins the run it is in, which is one undo step. */
    const wheelTick = () => {
      if (wheelRun === null) beginGesture()
      else clearTimeout(wheelRun)
      wheelRun = setTimeout(() => {
        wheelRun = null
        wheelZoom = null
        if (!dragRef.current) endGesture()
      }, 400)
    }
    /** Alt and the wheel over the Camera view (D428): the camera goes closer to what is at the middle of its picture, or farther, along its line of sight, a share of the way for each tick and never through it. Its lens is left alone, which is the wheel's own. */
    const closerCamera = (e: WheelEvent) => {
      if (!canEdit() || dragRef.current) return
      wheelTick()
      const name = cameraInHand()
      const s = useStore.getState()
      const camera = name ? s.model?.objects.find((o) => o.name === name) : undefined
      if (!name || !s.model || !camera) return
      const view = viewOf(s.model, camera, s.time)
      const m = cameraView.middle()
      const ray = cameraView.ray(m.x, m.y)
      const under = renderer.pick(cameraView.camera, cameraView.toNdc(m.x, m.y))
      const met = under ? meet(ray, renderer.planeOf(under)) : null
      const at = under && met ? lift(met.x, met.y, renderer.planeOf(under)) : null
      const ahead = Math.max(NEAREST, at ? aheadOf(view, at) : frameDistance(view))
      const go = ahead - Math.max(NEAREST, ahead * Math.exp(e.deltaY * 0.0015))
      const f = axesOf(view).forward
      const attrs: Record<string, number> = looksStraight(view) ? { z: view.z + f.z * go } : { x: view.x + f.x * go, y: view.y + f.y * go, z: view.z + f.z * go }
      setAttrsAtMany([{ name, attrs, together: Object.keys(attrs) }], s.time)
    }
    const zoomCamera = (e: WheelEvent) => {
      if (!canEdit() || dragRef.current) return
      wheelTick()
      const name = cameraInHand()
      const fresh = useStore.getState()
      const camera = name ? fresh.model?.objects.find((o) => o.name === name) : undefined
      if (!name || !fresh.model || !camera) return
      const view = viewOf(fresh.model, camera, fresh.time)
      const going = wheelZoom && wheelZoom.name === name && Math.abs(wheelZoom.left - view.zoom) <= 1e-9 * view.zoom ? wheelZoom.asked : view.zoom
      const asked = Math.min(64, Math.max(0.02, going * Math.exp(-e.deltaY * 0.0015)))
      const shown = useStore.getState()
      const own = shown.model?.objects.find((o) => o.name === name)
      if (!shown.model || !own) return
      const z0 = valueAt(shown.model, own, 'zoom', shown.time)
      const ownZoom = typeof z0 === 'number' && z0 > 0 ? z0 : 1
      // The zoom as it will be written, and the view's zoom with it: a tick that does not change what is written changes nothing, and adds up with the next.
      const written = roundAttr('zoom', ownZoom * (asked / view.zoom))
      if (written === roundAttr('zoom', ownZoom)) {
        wheelZoom = { name, asked, left: view.zoom }
        return
      }
      wheelZoom = { name, asked, left: view.zoom * (written / ownZoom) }
      setAttrsAtMany([{ name, attrs: { zoom: written } }], shown.time)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const bounds = host.getBoundingClientRect()
      const paneX = e.clientX - bounds.left
      const paneY = e.clientY - bounds.top
      const overCamera = e.target instanceof Node && cameraPanel.contains(e.target)
      if (overCamera && !animateHeld(e)) {
        // The Camera view never zooms as a view: it shows what the camera sees, so the wheel there zooms the camera itself (D369), and with Alt moves it closer (D428).
        if (e.altKey) closerCamera(e)
        else zoomCamera(e)
        return
      }
      if (animateHeld(e)) {
        // Shift and the wheel lengthen or shorten the selected actions, wherever the pointer is
        // (D97, D111). During a Shift gesture the playhead keeps showing the end of what is being made (D103).
        const s = useStore.getState()
        if (s.selectedActions.length === 0) {
          // Nothing exists yet: the wheel sets the proposed length, and the playhead shows the proposed end.
          const gesture = gestureRef.current
          if (!gesture || dragRef.current) return
          gesture.duration = Math.max(1 / s.settings.fps, gesture.duration - (Math.sign(e.deltaY) * s.wheelStep) / s.settings.fps)
          s.setTime(gesture.from + gesture.duration)
          return
        }
        adjustDurations(s.selectedActions, (-Math.sign(e.deltaY) * s.wheelStep) / s.settings.fps, s.pin)
        const after = useStore.getState()
        const primary = after.selectedActions[0]
        const action = primary ? after.model?.objects.find((o) => o.name === primary.object)?.actions[primary.index] : undefined
        if (gestureRef.current?.editing && action) {
          // The animation being edited grew or shrank: the playhead stays at its end, and its span is what a new animation would take (D157).
          gestureRef.current.from = action.start
          gestureRef.current.duration = action.end - action.start
          after.setTime(action.end)
        } else if (gestureRef.current && action && after.pin === 'start') {
          // In Chain mode the next animation follows the adjusted end, and the playhead looks ahead from there (D127).
          if (after.chain) {
            gestureRef.current.from = action.end
            after.setTime(action.end + gestureRef.current.duration)
          } else after.setTime(action.end)
        }
        return
      }
      if (e.altKey) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) viewport.panBy(e.deltaX, 0)
      else viewport.zoomAt(Math.exp(-e.deltaY * 0.0015), paneX, paneY)
    }
    host.addEventListener('wheel', onWheel, { passive: false })

    // Releasing Shift ends the gesture: the playhead goes back to where it was.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isAnimateKey(e) || !gestureRef.current || dragRef.current) return
      useStore.getState().setTime(restingTime(gestureRef.current))
      gestureRef.current = null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Alt alone would open the window's menu: here it is held with the pointer, to keep proportions or to move a view (D113, D427).
      if (e.key === 'Alt') e.preventDefault()
      // Shift held over the pane, with Starts at playhead: look ahead to the proposed animation's end
      // before anything is dragged, so what is dragged is what is written (D103).
      if (!isAnimateKey(e) || e.repeat || gestureRef.current || dragRef.current) return
      if (e.target instanceof Element && e.target.closest('input, textarea')) return
      const s = useStore.getState()
      // A recording has the playhead: Shift means nothing more while it runs (D397).
      if (s.recording) return
      // Over the preview, or over the timeline with an animation selected (D180).
      if (!s.model || (!hoverRef.current && !s.hoverTimeline)) return
      // With an animation selected, Shift jumps to its end: what is dragged then is its end state, and nothing new is made (D157).
      const picked = s.selectedActions.find((r) => s.selection.includes(r.object)) ?? s.selectedActions[0]
      const editing = picked ? s.model.objects.find((o) => o.name === picked.object)?.actions[picked.index] : undefined
      // In Chain mode, with the playhead resting at the selected animation's end, Shift goes on with the chain (D310): the next animation follows that one, as long as it was, and nothing is edited.
      const last = editing && hoverRef.current && s.chain && s.pin === 'start' && Math.abs(editing.end - s.time) < 0.5 / s.settings.fps ? editing : null
      // Past the selected animation's end, Shift looks ahead from the playhead as with nothing selected, and what is made is new (D329).
      const past = !!editing && s.time > editing.end + 0.5 / s.settings.fps
      if (editing && !last && !past) {
        if (e.target instanceof Element && e.target.closest('.cm-editor')) (document.activeElement as HTMLElement | null)?.blur()
        // Shift previews the end the pin does not name: the end with Starts at playhead, the start with Ends at playhead (D187).
        const editEnd = s.pin === 'end' ? 'start' : 'end'
        gestureRef.current = { restore: s.time, from: editing.start, duration: editing.end - editing.start, editing: true, editEnd }
        s.setTime(editEnd === 'end' ? editing.end : editing.start)
        return
      }
      if (!hoverRef.current || s.pin !== 'start') return
      // The code pane may still hold the focus from an earlier click; the pointer being here says what Shift is for.
      if (e.target instanceof Element && e.target.closest('.cm-editor')) (document.activeElement as HTMLElement | null)?.blur()
      const from = last ? last.end : s.time
      const duration = last ? Math.max(1 / s.settings.fps, journeyOf(last)) : 1
      gestureRef.current = { restore: s.time, from, duration }
      s.setTime(from + duration)
    }
    // Shift held with another key is that key's hotkey, not a gesture (D310): the look ahead ends first, as letting go of Shift ends it, so the hotkey acts where the playhead rests.
    const onOtherKey = (e: KeyboardEvent) => {
      if (isAnimateKey(e) || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta' || !gestureRef.current || dragRef.current) return
      useStore.getState().setTime(restingTime(gestureRef.current))
      gestureRef.current = null
    }
    // Typing in the code pane or a field takes the pointer's say away until it moves over the pane again.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('.cm-editor, input, textarea')) hoverRef.current = false
    }
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onOtherKey, true)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onOtherKey, true)
      document.removeEventListener('focusin', onFocusIn)
      unsubscribe()
      observer.disconnect()
      if (wheelRun !== null) clearTimeout(wheelRun)
      delete dropTargets.preview
      delete dropTargets.previewCenter
      cameraViewRef.current = null
      renderer.dispose()
      cameraView.dispose()
      viewport.dispose()
      viewportRef.current = null
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    viewportRef.current?.setComposition(settings.width, settings.height, settings.background)
    rendererRef.current?.setComposition(settings.width, settings.height)
    cameraViewRef.current?.fit()
    paintRef.current()
  }, [settings.width, settings.height, settings.background])

  // The views take their parts of the pane when the switch or the divider changes, and a camera's name is put at its frame once it is there to place (D359, D361).
  useEffect(() => {
    cameraViewRef.current?.fit()
    paintRef.current()
  }, [previewView, previewSplit, model])

  // A project just opened is fitted by its own camera's frame, which is known once its scene is read (D367).
  const projectPath = project?.path
  useEffect(() => {
    paintRef.current()
    viewportRef.current?.fit()
  }, [projectPath])

  /** The view a place on the screen is in (D366): the Camera view where it shows and the place is in its part of the pane, else the Preview view. */
  const surfaceAt = (clientX: number, clientY: number): Surface | null => {
    const cam = cameraViewRef.current?.view
    const panel = cameraPanelRef.current
    if (cam?.shown && panel) {
      const r = panel.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return cam
    }
    return viewportRef.current
  }

  /** The view the gesture in hand began in, which it keeps to wherever the pointer goes; with none in hand, the Preview view. */
  const surfaceOf = (): Surface | null => gestureSurfaceRef.current ?? viewportRef.current

  /**
   * The place in the scene and the object under a pointer position, through the view it is in,
   * or through `on` when a gesture keeps to its own (D366). Places on the pane are from the
   * preview's top left corner in either view.
   */
  const locate = (host: HTMLDivElement, clientX: number, clientY: number, on?: Surface | null) => {
    const own = viewportRef.current
    const renderer = rendererRef.current
    if (!own || !renderer) return null
    // A pane that has never been painted (hidden since load) has not reported its size yet.
    const part = (worldRef.current ?? host).getBoundingClientRect()
    if (!own.sized && part.width > 0 && part.height > 0) own.resize(part.width, part.height, window.devicePixelRatio)
    const viewport: Surface = on ?? surfaceAt(clientX, clientY) ?? own
    // A gesture just over may have left its own plane in hand.
    freshPlaneRef.current()
    const bounds = host.getBoundingClientRect()
    const paneX = clientX - bounds.left
    const paneY = clientY - bounds.top
    const cam = cameraViewRef.current?.view
    // Past the picture's edge the Camera view draws nothing, so nothing is picked there.
    const drawn = viewport === cam && !cam.holds(paneX, paneY) ? null : renderer.pick(viewport.camera, viewport.toNdc(paneX, paneY))
    // In a turned Preview view a flat thing seen on edge has no face to press: it is found by the line of its box (D435).
    const hit = drawn ?? (viewport === own && !own.straight ? renderer.pickEdge(paneX, paneY, 5, (x, y, plane) => own.toPane(x, y, plane)) : null)
    return { viewport, renderer, bounds, paneX, paneY, world: viewport.toWorld(paneX, paneY), hit }
  }

  const capture = (el: HTMLElement, pointerId: number, onMove: (ev: PointerEvent) => void, onEnd: (ev: PointerEvent) => void) => {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      onEnd(ev)
      // The gesture is over: the next one finds its own view, and its own plane, and the views have the plane of what is selected again.
      gestureSurfaceRef.current = null
      gesturePlaneRef.current = null
      freshPlaneRef.current()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  /** A place on the grid when the grid is on (D91). */
  const gridded = (w: Point): Point => {
    const snap = useStore.getState().previewSnap
    if (!snap.on || snap.grid <= 0) return w
    return { x: Math.round(w.x / snap.grid) * snap.grid, y: Math.round(w.y / snap.grid) * snap.grid }
  }

  /** The line an object travels along a path as it stands now, by the path's reference (D223). */
  const frameOf = (ref: ActionRef): PathFrame | null => {
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === ref.object)
    const action = obj?.actions[ref.index]
    return s.model && obj && action ? travelFrame(s.model, obj, action) : null
  }

  /** Take a path up as the one Create is drawing, or with null let it go (D414). */
  const takeUpPath = (ref: ActionRef | null) => {
    const draft = ref ? { object: ref.object, index: ref.index, time: useStore.getState().time } : null
    pathDraftRef.current = draft
    setPathDraft(draft)
  }

  /**
   * Whether Create goes on with a path (D414): it is the one being drawn, with the playhead where
   * it was when the path was made or taken up, or it has only its first point, so is not drawn
   * yet. Any other path is left as it is, and a press on empty space begins a new one.
   */
  const goesOn = (ref: ActionRef): boolean => {
    const s = useStore.getState()
    const action = s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
    if (!action || action.verb !== 'path') return false
    if (pathOnlyBegun(action)) return true
    const draft = pathDraftRef.current
    return !!draft && draft.object === ref.object && draft.index === ref.index && sameMoment(s.time, draft.time)
  }

  /**
   * Draw for a path (D194, D199): a stroke from `from` adds the corners of the drawn line after
   * the last anchor and makes the path smooth; a press that does not move adds one corner where
   * it lands when `clickAdds`, else nothing. A path started on an object draws from the object's
   * own place, its first anchor. With `begun`, the press that made the path opened a gesture, and
   * it ends here: the path, its first points, and the line drawn are one undo step.
   */
  const beginStroke = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, from: Point, clickAdds: boolean, begun = false) => {
    const viewport = surfaceOf()
    if (!viewport) {
      if (begun) endGesture()
      return
    }
    const bounds = host.getBoundingClientRect()
    const samples: Point[] = [from]
    const pane: { x: number; y: number }[] = [{ x: e.clientX - bounds.left, y: e.clientY - bounds.top }]
    let moved = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
        samples.push(viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top))
        pane.push({ x: ev.clientX - bounds.left, y: ev.clientY - bounds.top })
        setSketch([...pane])
      },
      () => {
        setSketch(null)
        const frame = frameOf(ref)
        const count = frame?.anchors.length ?? 0
        const points = !moved && !clickAdds ? [] : moved ? simplify(samples, 4 / viewport.zoom) : [gridded(from)]
        // A line drawn from the last anchor goes on from it rather than doubling it.
        const last = frame?.anchors[count - 1]
        if (last && points.length > 1 && Math.hypot(points[0]!.x - last.x, points[0]!.y - last.y) < 4 / viewport.zoom) points.shift()
        if (points.length > 0) {
          if (!begun) beginGesture()
          insertPathPoints(ref, count, points)
          // A drawn line is a curve: the path turns smooth, as curves with handles (D249).
          if (moved) smoothPath(ref)
        }
        if (begun || points.length > 0) endGesture()
        if (points.length > 0) useStore.getState().setPathPoints([count + points.length - 1])
      },
    )
  }

  /**
   * Move a whole path with the Path tool (D203): the drag carries every anchor by how far the
   * pointer goes, as one undo step; a press that does not move puts a point at `insertAt`
   * instead, when there is one. A path that begins where its object is goes with its object
   * (D387), so the drag moves the object as the path begins, whatever the shape is written as.
   */
  const beginPathMove = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, world: Point, insertAt: number | null) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const frame = frameOf(ref)
    const starts = frame?.anchors ?? []
    // Where the path begins, which is where its object is then: the line's first point, for a shape with no anchors.
    const origin = pathBeginsAtObject(ref) ? (starts[0] ?? frame?.curve[0]) : undefined
    let dragged = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!dragged) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
          dragged = true
          beginGesture()
        }
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const dx = now.x - world.x
        const dy = now.y - world.y
        if (origin) carryPath(ref, gridded({ x: origin.x + dx, y: origin.y + dy }))
        else setPathPoints(ref, starts.map((p, index) => ({ index, world: gridded({ x: p.x + dx, y: p.y + dy }) })))
      },
      () => {
        if (dragged) endGesture()
        else if (insertAt !== null) {
          insertPathPoints(ref, insertAt, [gridded(world)])
          useStore.getState().setPathPoints([insertAt])
        }
      },
    )
  }

  /**
   * Turn a whole path with the Path tool (D394): the handle above its box goes round the point
   * the path begins at, and the path's `angle` takes the turn, by the angle step when snapping
   * is on, as one undo step.
   */
  const beginPathTurn = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, frame: PathFrame, world: Point) => {
    const viewport = surfaceOf()
    const pivot = frame.anchors[0] ?? frame.curve[0]
    const s = useStore.getState()
    const action = s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
    if (!viewport || !pivot || !action) return
    const bounds = host.getBoundingClientRect()
    const base = pathAngle(action)
    const from = Math.atan2(world.y - pivot.y, world.x - pivot.x)
    let dragged = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!dragged) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
          dragged = true
          beginGesture()
        }
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const turned = base + ((Math.atan2(now.y - pivot.y, now.x - pivot.x) - from) * 180) / Math.PI
        const snap = useStore.getState().previewSnap
        setPathAngle(ref, snap.on ? snapTo(turned, snap.angle) : turned)
      },
      () => {
        if (dragged) endGesture()
      },
    )
  }

  /**
   * Move a whole path whose shape is code, a function or a link, with the Path tool (D223): the
   * drag carries it by how far the pointer goes, written into its `offset`, as one undo step.
   */
  const beginPathShift = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, world: Point) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const base = pathOffset(ref)
    let dragged = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!dragged) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
          dragged = true
          beginGesture()
        }
        setPathShift(ref, base, world, viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top))
      },
      () => {
        if (dragged) endGesture()
      },
    )
  }

  /**
   * Edit a path's points (D194, D197, D198): drag the anchor `point`, with every other picked
   * anchor when it is one of them; or put a new anchor in at `insertAt`, where the pointer is,
   * and drag it. A drag moves by how far the pointer goes, so an object dragged by its body
   * carries its anchor along, and it is one undo step. With `toggle`, a click adds the anchor to
   * the picked ones or takes it out, and nothing moves. With `follow`, the anchor goes to the
   * pointer rather than by how far it went: for an object pressed mid-path and shown at the
   * path's end, which then lands where the pointer is, as a move's end does (D102, D205).
   */
  const beginPathEdit = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, world: Point, point: number | null, insert: LineInsert | null, toggle: boolean, follow = false) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const s = useStore.getState()
    let indices: number[]
    if (point !== null) {
      if (toggle) {
        // Ctrl: into the picked anchors or out of them, and no drag.
        s.setPathPoints(s.pathPoints.includes(point) ? s.pathPoints.filter((i) => i !== point) : [...s.pathPoints, point])
        return
      }
      beginGesture()
      indices = s.pathPoints.includes(point) ? s.pathPoints : [point]
    } else if (insert !== null) {
      // A click on the line between two anchors puts a new anchor there, which the drag then carries; on curves the curve is kept (D246).
      beginGesture()
      if (insert.kind === 'points') {
        insertPathPoints(ref, insert.at, [gridded(world)])
        indices = [insert.at]
      } else {
        const index = insertPathAnchor(ref, insert.seg, insert.t)
        if (index === null) {
          endGesture()
          return
        }
        indices = [index]
      }
    } else return
    useStore.getState().setPathPoints(indices)
    const frame0 = frameOf(ref)
    const starts = indices.map((i) => (follow ? world : (frame0?.anchors[i] ?? world)))
    // A point not dragged, where it is as the drag begins: with the first point among those dragged, it is what the rest of the path is held still by (D388).
    const still = frame0 ? frame0.anchors.findIndex((_, i) => !indices.includes(i)) : -1
    const stay = frame0 && still >= 0 ? { index: still, world: frame0.anchors[still]! } : undefined
    let dragged = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
        dragged = true
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const dx = now.x - world.x
        const dy = now.y - world.y
        setPathPoints(ref, indices.map((index, k) => ({ index, world: gridded({ x: starts[k]!.x + dx, y: starts[k]!.y + dy }) })), stay)
      },
      () => endGesture(),
    )
  }

  /**
   * Draw a Shape with the Object tool (D233): the first press starts one where the pointer is,
   * each press after adds a corner there, a drag draws a curve kept as its corners, and a press
   * on the first corner closes it. Enter closes, Escape leaves it a line.
   */
  /** A press on empty space (D89, D255): a drag draws a box in pane pixels and hands over what it holds, as the view it is drawn in has it, or null for a click. */
  const beginMarquee = (host: HTMLDivElement, e: ReactPointerEvent<Element>, located: { paneX: number; paneY: number }, onEnd: (box: Boxed | null) => void) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const start = { x: located.paneX, y: located.paneY }
    let moved = false
    let rect: Marquee | null = null
    capture(
      host,
      e.pointerId,
      (ev) => {
        const bounds = host.getBoundingClientRect()
        const p = { x: ev.clientX - bounds.left, y: ev.clientY - bounds.top }
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return
        moved = true
        rect = { x0: start.x, y0: start.y, x1: p.x, y1: p.y }
        setMarquee(rect)
      },
      () => {
        let box: Boxed | null = null
        const renderer = rendererRef.current
        if (moved && rect && renderer) {
          const pane = { left: Math.min(rect.x0, rect.x1), right: Math.max(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), bottom: Math.max(rect.y0, rect.y1) }
          // Either view may be turned (D366, D435): what the box holds is told on the pane itself, each thing by the plane it lies in, a point by the plane in hand.
          const onPane = (x: number, y: number, plane?: Plane) => viewport.toPane(x, y, plane)
          const inHand = viewport.plane
          box = {
            has: (p) => {
              const q = onPane(p.x, p.y, inHand)
              return q.x >= pane.left && q.x <= pane.right && q.y >= pane.top && q.y <= pane.bottom
            },
            objects: () => renderer.objectsOnPane(pane, onPane),
            // The Camera view draws no camera, being one's own.
            cameras: () => (viewport === viewportRef.current ? renderer.camerasOnPane(pane, onPane) : []),
          }
        }
        onEnd(box)
        setMarquee(null)
      },
    )
  }


  const beginShapeDraw = (host: HTMLDivElement, e: ReactPointerEvent<Element>, at: Point) => {
    let world = at
    const viewport = surfaceOf()
    if (!viewport) return
    const s = useStore.getState()
    let name = shapeDraftRef.current
    if (name && !s.model?.objects.some((o) => o.name === name)) name = null
    if (!name) {
      // A new shape is drawn on the scene's own plane, whatever is in hand (D434).
      const b = host.getBoundingClientRect()
      gesturePlaneRef.current = FLAT
      viewport.plane = FLAT
      world = viewport.toWorld(e.clientX - b.left, e.clientY - b.top)
    }
    if (name && s.model) {
      const obj = s.model.objects.find((o) => o.name === name)!
      const anchor = shapeOwnAnchors(s.model, obj, s.time)[0]
      const first = anchor ? shapeWorldOf(s.model, obj, s.time, anchor) : shapeWorldPoints(s.model, obj, s.time)[0]
      if (first && shapeAnchorCount(name) >= 3 && Math.hypot(first.x - world.x, first.y - world.y) <= 8 / viewport.zoom) {
        finishShape(name, true)
        shapeDraftRef.current = null
        setDrafting(false)
        return
      }
      appendShapePoints(name, [gridded(world)])
    } else {
      name = beginShape(world.x, world.y)
      if (!name) return
      shapeDraftRef.current = name
      setDrafting(true)
    }
    const drawn = name
    const bounds = host.getBoundingClientRect()
    const samples: Point[] = [world]
    const pane: { x: number; y: number }[] = [{ x: e.clientX - bounds.left, y: e.clientY - bounds.top }]
    let moved = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
        samples.push(viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top))
        pane.push({ x: ev.clientX - bounds.left, y: ev.clientY - bounds.top })
        setSketch([...pane])
      },
      () => {
        setSketch(null)
        if (!moved) return
        // A drawn line is its corners, smoothed as a run from the corner it left (D249).
        const points = simplify(samples, 4 / viewport.zoom).slice(1)
        if (points.length === 0) return
        const before = shapeAnchorCount(drawn)
        beginGesture()
        appendShapePoints(drawn, points)
        const after = shapeAnchorCount(drawn)
        const from = Math.max(0, before - 1)
        if (after > before) smoothShapeRun(drawn, Array.from({ length: after - from }, (_, k) => from + k))
        endGesture()
      },
    )
  }

  /** Finish the Shape being drawn, closed when it can be and `close` says so, else as a line (D233). */
  const endShapeDraft = (close: boolean) => {
    const name = shapeDraftRef.current
    shapeDraftRef.current = null
    setDrafting(false)
    if (!name) return
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === name)
    if (!obj || !s.model) return
    finishShape(name, close && shapeAnchorCount(name) >= 3)
  }

  /**
   * Edit a Shape's points as a path's (D233): drag the point `point`, with every other picked
   * one; or put a new point in at `insertAt`, where the pointer is, and drag it. With `toggle`,
   * a click picks the point or lets it go, and nothing moves.
   */
  const beginShapePointEdit = (host: HTMLDivElement, e: ReactPointerEvent<Element>, name: string, world: Point, point: number | null, insert: LineInsert | null, toggle: boolean, morph = false) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const s = useStore.getState()
    let indices: number[]
    if (point !== null) {
      if (toggle) {
        s.setPathPoints(s.pathPoints.includes(point) ? s.pathPoints.filter((i) => i !== point) : [...s.pathPoints, point])
        return
      }
      beginGesture()
      // The pressed point, with every other picked one (D233), whatever the drag writes.
      indices = s.pathPoints.includes(point) ? s.pathPoints : [point]
      if (morph && !shapeMorphRunning(name)) {
        // Shift with a point writes a morph from the playhead, for the proposed length, and the drag shapes its target (D257).
        const gesture = gestureRef.current
        if (addMorph(name, gesture ? gesture.from : s.time, gesture?.duration) === null) {
          endGesture()
          return
        }
      } else {
        // In the middle of a morph, a morph from its start to the playhead is written first, whose target the drag then shapes (D263).
        settleMorph(name)
      }
    } else if (insert !== null) {
      settleMorph(name)
      beginGesture()
      if (insert.kind === 'points') {
        insertShapePoints(name, insert.at, [gridded(world)])
        indices = [insert.at]
      } else {
        const index = insertShapeAnchor(name, insert.seg, insert.t)
        if (index === null) {
          endGesture()
          return
        }
        indices = [index]
      }
    } else return
    useStore.getState().setPathPoints(indices)
    const fresh = useStore.getState()
    const freshModel = fresh.model
    const obj = freshModel?.objects.find((o) => o.name === name)
    const anchors = obj && freshModel ? (shapeEditable(name) === 'curves' ? shapeEditAnchors(name).map((a) => shapeWorldOf(freshModel, obj, fresh.time, a)) : shapeWorldPoints(freshModel, obj, fresh.time)) : []
    const starts = indices.map((i) => anchors[i] ?? world)
    // Every write of the drag is computed from where it began, so nothing drifts (D243).
    const base = shapeEditBase(name) ?? undefined
    let dragged = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
        dragged = true
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const dx = now.x - world.x
        const dy = now.y - world.y
        setShapePoints(
          name,
          indices.map((index, k) => ({ index, world: gridded({ x: starts[k]!.x + dx, y: starts[k]!.y + dy }) })),
          base,
        )
      },
      () => endGesture(),
    )
  }

  /** Drag a control of an anchor of a curves shape (D240): a smooth anchor's other control turns to stay in line, except while Alt is held, whenever in the drag that is, when this one moves alone; a corner's moves alone (D252). */
  const beginShapeHandleDrag = (host: HTMLDivElement, e: ReactPointerEvent<Element>, name: string, pressed: AnchorHandle, at: Point) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    let handle = pressed
    let world = at
    // In the middle of a morph, a morph from its start to the playhead is written first, and the handle is its target's (D263).
    if (settleMorph(name)) {
      const s = useStore.getState()
      const obj = s.model?.objects.find((o) => o.name === name)
      const anchor = shapeEditAnchors(name)[handle.index]
      const control = anchor ? (handle.which === 'in' ? anchor.in : anchor.out) : null
      if (!s.model || !obj || !anchor || !control) return
      handle = { ...handle, anchor: shapeWorldOf(s.model, obj, s.time, anchor), point: shapeWorldOf(s.model, obj, s.time, control) }
      world = handle.point
    }
    const base = shapeEditBase(name) ?? undefined
    const joined = shapeAnchorSmooth(name, handle.index)
    beginGesture()
    capture(
      host,
      e.pointerId,
      (ev) => {
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        setShapeHandle(name, handle.index, handle.which, { x: handle.point.x + (now.x - world.x), y: handle.point.y + (now.y - world.y) }, base, joined && !ev.altKey)
      },
      () => endGesture(),
    )
  }

  /** Drag a control of an anchor of a curves path (D246), with the same rules, Alt included. */
  const beginPathHandleDrag = (host: HTMLDivElement, e: ReactPointerEvent<Element>, ref: ActionRef, handle: AnchorHandle, world: Point) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const joined = pathAnchorSmooth(ref, handle.index)
    beginGesture()
    capture(
      host,
      e.pointerId,
      (ev) => {
        const now = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        setPathHandle(ref, handle.index, handle.which, { x: handle.point.x + (now.x - world.x), y: handle.point.y + (now.y - world.y) }, joined && !ev.altKey)
      },
      () => endGesture(),
    )
  }

  /** Where a press on a path's line puts a new point: on a curves path, on the segment there, a fraction of the way along it; else after the span's anchor (D194, D246). */
  const pathInsertionAt = (frame: PathFrame, segment: number, world: Point): LineInsert => {
    if (frame.at) {
      const place = placeBetween(frame.at[segment], frame.at[segment + 1], fractionAlong(frame.curve[segment]!, frame.curve[segment + 1]!, world))
      if (place) return { kind: 'curves', seg: place.seg, t: place.t }
    }
    return { kind: 'points', at: (frame.spans[segment + 1] ?? 0) + 1 }
  }

  /** Where a press within `radius` of a shape's line puts a new point, or null (D233, D240). */
  const insertionAt = (shape: ShownShape, world: Point, radius: number): LineInsert | null => {
    if (shape.editable === 'points') {
      const segment = nearestSegment(shape.frame.curve, world, radius)
      return segment === null ? null : { kind: 'points', at: (shape.frame.spans[segment + 1] ?? 0) + 1 }
    }
    if (shape.editable !== 'curves') return null
    for (const piece of shape.pieces) {
      const segment = nearestSegment(piece.curve, world, radius)
      if (segment === null) continue
      // How far along the drawn piece the press is, then along the segment it came from.
      const place = placeBetween(piece.at[segment], piece.at[segment + 1], fractionAlong(piece.curve[segment]!, piece.curve[segment + 1]!, world))
      return place ? { kind: 'curves', seg: place.seg, t: place.t } : null
    }
    return null
  }

  /** What a Shape's menu adds (D233, D234, D252, D253): Smooth or Straighten the whole shape, and on a line, one with no fill, Close or Open it; a Rect or a Circle offers to become one. */
  const shapeItems = (name: string): MenuItems => {
    const obj = useStore.getState().model?.objects.find((o) => o.name === name)
    if (!obj) return []
    if (obj.className === 'Rect' || obj.className === 'Circle') return [{ label: 'Convert to shape', run: () => convertToShape(name) }]
    // A Text becomes its letters as curves, from its font's file (D273).
    if (obj.className === 'Text') return [{ label: 'Convert to shape', run: () => void convertTextToShape(name) }]
    if (obj.className !== SHAPE || shapeEditable(name) === null) return []
    const closed = isShapeClosed(name)
    const line = obj.attrs['fill'] === 'none'
    return [
      { label: 'Smooth shape', run: () => smoothShape(name) },
      { label: 'Straighten shape', run: () => straightenShape(name) },
      ...(line ? [{ label: closed ? 'Open line' : 'Close line', run: () => setShapeClosed(name, !closed) }] : []),
    ]
  }

  /** The items of a point's menu, by what it is (D252): Smooth point, with its controls in one line; Corner point, each control turned toward its neighbour, to move alone; Straighten point, lines on both sides. An end of a line has one side, so it offers only Straighten point, when that side is a curve. */
  const pointItems = (kind: AnchorKind, curved: boolean, set: (kind: 'smooth' | 'corner' | 'straight') => void): MenuItems => {
    if (kind === 'end') return curved ? [{ label: 'Straighten point', run: () => set('straight') }] : []
    return [
      ...(kind !== 'smooth' ? [{ label: 'Smooth point', run: () => set('smooth') }] : []),
      ...(kind === 'smooth' ? [{ label: 'Corner point', run: () => set('corner') }] : []),
      ...(kind !== 'straight' ? [{ label: 'Straighten point', run: () => set('straight') }] : []),
    ]
  }

  /** The item of a segment's menu (D252): Curve segment, or Straighten segment. */
  const segmentItems = (kind: 'curve' | 'line', set: (kind: 'curve' | 'line') => void): MenuItems => [kind === 'line' ? { label: 'Curve segment', run: () => set('curve') } : { label: 'Straighten segment', run: () => set('line') }]

  /** Edit path for each path an object has, and Add path (D194). */
  const pathItems = (name: string): MenuItems => {
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === name)
    const paths = obj ? obj.actions.map((a, index) => ({ a, index })).filter(({ a }) => a.verb === 'path' && !a.classAction && !a.overridden) : []
    // The path is selected with the Path tool in hand, in Edit, where its handles show (D405). The playhead stays (D388): a path's points drag at any time.
    const edit = (index: number) => {
      const fresh = useStore.getState()
      fresh.selectAction(name, index)
      fresh.setTool('path')
      fresh.setPathMode('edit')
    }
    const items: MenuItems = []
    if (paths.length === 1) items.push({ label: 'Edit path', run: () => edit(paths[0]!.index) })
    else if (paths.length > 1) items.push({ label: 'Edit path', children: paths.map(({ a, index }) => ({ label: `at ${formatTime(a.start, s.settings.fps)}`, run: () => edit(index) })) })
    items.push({
      label: 'Add path',
      run: () => {
        // One point, where the object is; the Path tool adds the rest.
        if (addPath(name, useStore.getState().time) !== null) {
          useStore.getState().setTool('path')
          useStore.getState().setPathMode('create')
        }
      },
    })
    return items
  }

  /** The camera a press in the Preview view is on (D361, D373, D435): in a turned view by its body, where it stands; else by its frame's line, on the frame's own plane; and with `inside`, the Camera tool's, by all of its frame. */
  const cameraUnder = (located: { viewport: Surface; renderer: SceneRenderer; paneX: number; paneY: number }, inside: boolean, prefer: readonly string[]): string | null => {
    const { viewport, renderer, paneX, paneY } = located
    const ray = viewport.ray(paneX, paneY)
    const onFrame = (frame: Frame) => {
      const plane = planeOfFrame(frame)
      const p = meet(ray, plane)
      return p ? { x: p.x, y: p.y, pixel: 1 / viewport.zoomOn(p.x, p.y, plane) } : null
    }
    const body = viewport.straight ? null : renderer.pickCameraBody(paneX, paneY, (place) => viewport.project(place))
    return body ?? renderer.pickCamera(onFrame, CAMERA_REACH_PX) ?? (inside ? renderer.pickCameraInside(onFrame, prefer) : null)
  }

  /** The place on the scene's own plane under a place on the pane, whatever plane is in hand: where what is made goes (D434). */
  const onFlat = (surface: Surface, paneX: number, paneY: number): Point => {
    const kept = surface.plane
    surface.plane = FLAT
    const p = surface.toWorld(paneX, paneY)
    surface.plane = kept
    return p
  }

  /** What a view looks at under a place on its pane (D428): the thing its line of sight meets there, on that thing's own plane; else where the line meets depth 0; null when it meets neither. */
  const lookedAt = (surface: Surface, paneX: number, paneY: number): THREE.Vector3 | null => {
    const renderer = rendererRef.current
    if (!renderer) return null
    const ray = surface.ray(paneX, paneY)
    const name = renderer.pick(surface.camera, surface.toNdc(paneX, paneY))
    const plane = name ? renderer.planeOf(name) : FLAT
    const met = meet(ray, plane) ?? (name ? meet(ray, FLAT) : null)
    return met ? lift(met.x, met.y, meet(ray, plane) ? plane : FLAT) : null
  }

  /** Whether a press is on a handle Alt has its say on (D113, D246), and so is not a move of the view: one of the selection's box, or a control of a curve's point. */
  const onHandle = (located: { world: Point; viewport: Surface; renderer: SceneRenderer }, inCameraView: boolean): boolean => {
    const s = useStore.getState()
    const pixel = 1 / located.viewport.zoom
    if ((s.tool === 'select' || s.tool === 'camera') && s.selection.length > 0) {
      layoutRef.current(inCameraView ? 'camera' : 'world')
      if (located.renderer.pickHandle(located.world)) return true
    }
    const shape = shapeRef.current
    if (s.tool === 'shape' && shape?.editable && nearestPoint(shape.handles.map((h) => h.point), located.world, 8 * pixel) !== null) return true
    const path = pathRef.current?.primary
    return !!path && path.handles.length > 0 && nearestPoint(path.handles.map((h) => h.point), located.world, 8 * pixel) !== null
  }

  /**
   * Move the Preview view (D428): go round what is at its middle, or zoom it, to the right or up
   * for closer. Nothing is written: a view is not a camera. A drag with the right button keeps
   * the menu shut.
   */
  const moveView = (host: HTMLDivElement, e: ReactPointerEvent<Element>, kind: 'round' | 'closer', rate = ROUND_RATE, onClick?: () => void) => {
    const own = viewportRef.current
    if (!own) return
    e.preventDefault()
    const m = own.middle()
    if (kind === 'round') {
      const at = lookedAt(own, m.x, m.y)
      if (at) own.lookAt(at)
    }
    let last = { x: e.clientX, y: e.clientY }
    let moved = false
    capture(
      host,
      e.pointerId,
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
        if (!moved) host.classList.add('panning')
        moved = true
        const dx = ev.clientX - last.x
        const dy = ev.clientY - last.y
        last = { x: ev.clientX, y: ev.clientY }
        if (kind === 'round') own.roundBy(dx, dy, rate)
        else own.zoomAt(Math.exp((dx - dy) * CLOSER_RATE), m.x, m.y)
      },
      () => {
        host.classList.remove('panning')
        if (moved && e.button === 2) menuShutRef.current = true
        if (!moved) onClick?.()
      },
    )
  }

  /** A press on the Preview view's compass (D428, D435): a drag turns the view round what is at its middle, the compass's near side following the pointer; a press on an end of an axis looks along it, from the other side when it already does, with everything in view. */
  const pressViewCompass = (e: ReactPointerEvent<Element>, axis: CompassAxis | null) => {
    const host = hostRef.current
    if (!host || e.button !== 0) return
    moveView(host, e, 'round', COMPASS_RATE, () => {
      const own = viewportRef.current
      const renderer = rendererRef.current
      if (!own || !renderer || !axis) return
      const now = own.facing
      let to = facingOf(axis)
      if (Math.abs(to.pitch - now.pitch) < 0.5 && (Math.abs(to.pitch) > 89.5 || Math.abs(nearAngle(to.yaw, now.yaw) - now.yaw) < 0.5)) to = facingOf({ axis: axis.axis, sign: axis.sign > 0 ? -1 : 1 })
      own.face(to.yaw, to.pitch)
      const all = renderer.extent()
      if (all.length > 0) own.showAll(all)
      else own.fit()
    })
  }

  /** Write what the camera that has the picture shows (D436): as it is at the playhead, or with the key that animates held, as an animation from the playhead, as any change made with it is (D103, D423). One undo step; a scene with no camera gets one in it. */
  const writeCamera = (values: Record<string, number>, animate: boolean) => {
    if (!canEdit() || Object.keys(values).length === 0) return
    beginGesture()
    try {
      const name = cameraInHand()
      const s = useStore.getState()
      if (!name) return
      if (animate && !s.recording) {
        const gesture = gestureRef.current
        const pinNow = gesture?.editing ? 'start' : s.pin
        const end = beginTimed(name, Object.keys(values), pinNow, gesture?.from ?? s.time, gesture?.duration ?? 1)
        const index = end === null ? null : lastActionIndex(name)
        if (end !== null && index !== null) {
          setActionDestination(name, index, values)
          madeWithShift(end, pinNow)
        }
      } else setAttrsAtMany([{ name, attrs: values, together: Object.keys(values) }], s.time)
    } finally {
      endGesture()
    }
  }

  /** What the camera that has the picture is taken through at the playhead; with none, as the picture is with no camera. */
  const liveView = () => {
    const s = useStore.getState()
    const live = s.model ? cameraAt(s.model, s.time) : null
    return live && s.model ? viewOf(s.model, live, s.time) : NO_VIEW
  }

  /** Of what a camera would be told, what is not so already. */
  const differing = (values: Record<string, number>, now: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(values).filter(([attr, value]) => Math.abs(value - (now[attr] ?? 0)) > 1e-6))

  /** A press on an end of an axis of the Camera view's compass (D428): the camera faces along it from where it stands, the other way when it already does; its roll is its own. */
  const faceCamera = (axis: CompassAxis, animate: boolean) => {
    const view = liveView()
    const along = (sign: number) => anglesAlong({ x: axis.axis === 'x' ? -sign : 0, y: axis.axis === 'y' ? -sign : 0, z: axis.axis === 'z' ? -sign : 0 })
    let to = along(axis.sign)
    if (Math.abs(to.rotationX - view.rotationX) < 0.5 && (Math.abs(to.rotationX) > 89.5 || Math.abs(nearAngle(to.rotationY, view.rotationY) - view.rotationY) < 0.5)) to = along(-axis.sign)
    writeCamera(differing({ rotationX: to.rotationX, rotationY: nearAngle(to.rotationY, view.rotationY) }, { rotationX: view.rotationX, rotationY: view.rotationY }), animate)
  }

  /** The Preview view stands where the camera that has the picture stands, and looks the way it looks (D436). Nothing is written. */
  const viewFromCamera = () => {
    const view = liveView()
    viewportRef.current?.standAt({ x: view.x, y: view.y, z: view.z }, view.rotationY, view.rotationX, frameDistance(view))
  }

  /** The camera that has the picture stands where the Preview view's eye is, and looks the way it looks (D436): written, and with the key that animates held, animated. Its roll and its lens are its own. */
  const cameraFromView = (animate: boolean) => {
    const own = viewportRef.current
    if (!own) return
    const view = liveView()
    const eye = own.eye()
    const { yaw, pitch } = own.facing
    writeCamera(differing({ x: eye.x, y: eye.y, z: eye.z, rotationX: pitch, rotationY: nearAngle(yaw, view.rotationY) }, { x: view.x, y: view.y, z: view.z, rotationX: view.rotationX, rotationY: view.rotationY }), animate)
  }

  /** The camera that has the picture goes back to where a camera is unless told (D436): with the key that animates held, by an animation; else what it was told is taken away. */
  const cameraHome = (animate: boolean) => {
    if (!canEdit()) return
    const name = cameraInHand(false)
    if (!name) return
    if (!animate) {
      resetCamera(name)
      return
    }
    const view = liveView()
    writeCamera(differing({ x: 0, y: 0, z: standDistance(), rotationX: 0, rotationY: nearAngle(0, view.rotationY), rotation: nearAngle(0, view.rotation) }, { x: view.x, y: view.y, z: view.z, rotationX: view.rotationX, rotationY: view.rotationY, rotation: view.rotation }), true)
  }

  /** What a move of a camera changes (D428), so an animation of it is made to hold all of it: a camera that looks straight on goes across by x and y, and closer by z alone. */
  const cameraKeys = (kind: CameraMove, straight: boolean): string[] => (kind === 'round' ? ['x', 'y', 'z', 'rotationX', 'rotationY'] : kind === 'turn' ? ['rotationX', 'rotationY'] : kind === 'closer' ? (straight ? ['z'] : ['x', 'y', 'z']) : straight ? ['x', 'y'] : ['x', 'y', 'z'])

  /**
   * A move of the camera that has the picture, made in its own view (D428): what the camera shows
   * for a drag of so many pane pixels from where the drag began. Across, the thing pressed stays
   * under the pointer, by its own depth, so the camera goes the other way (D361, D369). Round, it
   * goes round what is at the middle of its picture, which stays there: a drag to the right turns
   * it to its right, so the near side of what is seen follows the pointer. Closer, it goes along
   * its line of sight, to the right or up for closer, half as far for each 140 pixels and never
   * through what it nears. A turn is on the spot. The zoom is the lens's and no move's (D426).
   */
  const cameraMover = (kind: CameraMove, name: string, time: number, located: { paneX: number; paneY: number }): ((dx: number, dy: number) => Record<string, number>) | null => {
    const s = useStore.getState()
    const cam = cameraViewRef.current?.view
    const obj = s.model?.objects.find((o) => o.name === name)
    if (!s.model || !obj || !cam) return null
    const view = viewOf(s.model, obj, time)
    const { right, up, forward } = axesOf(view)
    const straight = looksStraight(view)
    if (kind === 'turn') return (dx, dy) => ({ rotationX: Math.max(-90, Math.min(90, view.rotationX - dy * COMPASS_RATE)), rotationY: view.rotationY - dx * COMPASS_RATE })
    if (kind === 'across') {
      const pressed = lookedAt(cam, located.paneX, located.paneY)
      const ahead = Math.max(1e-3, pressed && aheadOf(view, pressed) > 1e-3 ? aheadOf(view, pressed) : frameDistance(view))
      // How much of the scene a pane pixel is, as far ahead as what was pressed.
      const per = (view.orthographic ? 1 / Math.max(1e-6, view.zoom) : ahead / fullDistance(view)) / (cam.scale || 1)
      return (dx, dy) => {
        const u = -dx * per
        const v = dy * per
        const out: Record<string, number> = { x: view.x + right.x * u + up.x * v, y: view.y + right.y * u + up.y * v }
        if (!straight) out['z'] = view.z + right.z * u + up.z * v
        return out
      }
    }
    // What is at the middle of the picture: the thing the line of sight meets; else where it meets depth 0; else as far ahead as a 50 mm lens frames the project, which is where the frame is drawn.
    const m = cam.middle()
    const middle = lookedAt(cam, m.x, m.y)
    const ahead = Math.max(NEAREST, middle && aheadOf(view, middle) > 1e-3 ? aheadOf(view, middle) : cameraFrame(view).distance)
    const pivot = { x: view.x + forward.x * ahead, y: view.y + forward.y * ahead, z: view.z + forward.z * ahead }
    if (kind === 'round')
      return (dx, dy) => {
        const rotationY = view.rotationY - dx * ROUND_RATE
        const rotationX = Math.max(-90, Math.min(90, view.rotationX - dy * ROUND_RATE))
        const at = roundPlace(pivot, ahead, rotationX, rotationY)
        return { x: at.x, y: at.y, z: at.z, rotationX, rotationY }
      }
    return (dx, dy): Record<string, number> => {
      const go = ahead - Math.max(NEAREST, ahead * Math.exp(-(dx - dy) * CLOSER_RATE))
      return straight ? { z: view.z + forward.z * go } : { x: view.x + forward.x * go, y: view.y + forward.y * go, z: view.z + forward.z * go }
    }
  }

  const onPointerDown = (e: ReactPointerEvent<Element>) => press(e, null)

  /**
   * A press on the pane: in the Preview view; in the Camera view, `on.view`, where everything is
   * worked on through the camera as it is in the Preview view (D366); or on a camera's name,
   * `on.camera`, which is that camera pressed (D361). The gesture keeps to the view it began in.
   * The middle button drags the Preview view, and in the Camera view the camera itself, the
   * picture following the pointer (D369).
   */
  const press = (e: ReactPointerEvent<Element>, on: { view: 'camera'; move?: CameraMove; axis?: CompassAxis | null } | { camera: string } | null) => {
    const host = hostRef.current
    const own = viewportRef.current
    const cam = cameraViewRef.current?.view
    if (!host || !own) return
    const inCameraView = !!on && 'view' in on && !!cam
    const viewport: Surface = inCameraView && cam ? cam : own
    gestureSurfaceRef.current = viewport
    gesturePlaneRef.current = null
    // What the buttons ask of a view or a camera (D427, D428): the middle button across, with Ctrl round; Alt and the right button closer. Alt and the left button go round too, looked at below, since a press on a handle with Alt is the handle's.
    let move: CameraMove | null = on && 'view' in on && on.move ? on.move : e.button === 1 ? (e.ctrlKey || e.metaKey ? 'round' : 'across') : e.button === 2 && e.altKey ? 'closer' : null
    // The right button alone is the menu's.
    if (e.button !== 0 && !move) return
    if (move && !inCameraView && e.button !== 0) {
      // The Preview view's own moves change what is seen and write nothing.
      if (move !== 'across') {
        moveView(host, e, move === 'closer' ? 'closer' : 'round')
        return
      }
      e.preventDefault()
      host.classList.add('panning')
      let last = { x: e.clientX, y: e.clientY }
      capture(
        host,
        e.pointerId,
        (ev) => {
          own.panBy(last.x - ev.clientX, last.y - ev.clientY)
          last = { x: ev.clientX, y: ev.clientY }
        },
        () => host.classList.remove('panning'),
      )
      return
    }

    const located = locate(host, e.clientX, e.clientY, viewport)
    if (!located) return
    const { renderer } = located
    let store = useStore.getState()
    // Alt and the left button go round (D427), but for what Alt already means under the pointer: a handle, which it keeps in proportion or moves alone (D113, D246), and with Paint a click, which takes a color (D294). Where Alt is the key that animates, a drag with it is an animation, as the one who chose it asked, and going round is the middle button's with Ctrl (D432).
    if (e.button === 0 && e.altKey && !move && animateKey() !== 'Alt' && !(on && 'camera' in on) && store.tool !== 'paint' && !onHandle(located, inCameraView)) {
      if (!inCameraView) {
        moveView(host, e, 'round')
        return
      }
      move = 'round'
    }
    // A move of the camera made in its own view (D369, D428): the picture is the camera's, and the move is written, whatever the tool.
    const panCamera = inCameraView && move !== null
    if (panCamera) e.preventDefault()
    // Such a move is the Camera tool's for that drag.
    const toolNow = panCamera ? 'camera' : store.tool

    // The Object tool places one object per click and stays on (D163, D203).
    if (toolNow === 'object') {
      // A preset chosen in the bar is placed instead of a kind (D300).
      const preset = store.addPreset ? store.userPresets.find((u) => u.id === store.addPreset) : undefined
      // What is made goes on the scene's own plane, under the pointer (D434).
      const at = onFlat(viewport, located.paneX, located.paneY)
      if (preset) addUserObject(preset, at.x, at.y)
      else addObject(store.addKind, at.x, at.y)
      return
    }
    // The Paint tool (D293, D294): a click fills what is under it with the color; Alt, or the dropper, takes the color under it instead.
    if (toolNow === 'paint') {
      if (!located.hit || !canEdit()) return
      if (e.altKey || droppingRef.current) {
        pickColor(located.hit, store.time)
        return
      }
      const st = styleRef.current
      const outline = paintModeRef.current === 'stroke'
      const color = outline ? st.stroke : st.fill
      if (animateHeld(e)) {
        // A color change made as any Shift-made animation is (D103, D127): from where the playhead was before Shift looked ahead, for the proposed length, pinned as the pin says, the next one following in Chain mode.
        const gesture = gestureRef.current
        const pinNow = gesture?.editing ? 'start' : store.pin
        const from = gesture?.from ?? store.time
        const length = gesture?.duration ?? 1
        const end = outline ? beginOutline(located.hit, color, st.strokeWidth, pinNow, from, length) : beginFill(located.hit, color, pinNow, from, length)
        if (end !== null) madeWithShift(end, pinNow)
      } else if (outline) paintStroke(located.hit, color, st.strokeWidth, store.time)
      else paintFill(located.hit, color, store.time)
      rememberColor(color)
      return
    }
    // The Pencil (D297, D320): a line wherever it is drawn, over an object as over empty space; Shift writes it on as any Shift-made animation.
    if (toolNow === 'pencil') {
      if (canEdit()) {
        // A line is drawn on the scene's own plane, whatever is in hand (D434).
        gesturePlaneRef.current = FLAT
        viewport.plane = FLAT
        beginSketch(host, e, viewport.toWorld(located.paneX, located.paneY), located.paneX, located.paneY)
      }
      return
    }
    // The Shape tool (D236): Create draws a shape point by point; Edit works on the selected shape's points, a press on a Shape picks it, and empty space lets the points go.
    if (toolNow === 'shape') {
      const shown = shapeRef.current
      const pixel = 1 / viewport.zoom
      const creating = store.shapeMode === 'create'
      if (shown?.editable && (!animateHeld(e) || !creating)) {
        // A control of a picked anchor first, then a point, then, in Edit mode, the line (D240). In Create mode a press on the first corner of the shape being drawn closes it (D233); any other point drags, in either mode. Shift with a point in Edit mode writes a morph and drags its target (D257).
        const control = animateHeld(e) ? null : nearestPoint(shown.handles.map((h) => h.point), located.world, 8 * pixel)
        if (control !== null) {
          beginShapeHandleDrag(host, e, shown.name, shown.handles[control]!, located.world)
          return
        }
        const point = nearestPoint(shown.frame.anchors, located.world, 8 * pixel)
        const closing = creating && shapeDraftRef.current === shown.name && point === 0 && shown.frame.anchors.length >= 3
        if (point !== null && !closing) {
          beginShapePointEdit(host, e, shown.name, located.world, point, null, e.ctrlKey || e.metaKey, animateHeld(e))
          return
        }
        const insert = creating || animateHeld(e) ? null : insertionAt(shown, located.world, 6 * pixel)
        if (insert && !(e.ctrlKey || e.metaKey)) {
          beginShapePointEdit(host, e, shown.name, located.world, null, insert, false)
          return
        }
        if (animateHeld(e)) return
      }
      if (creating) {
        beginShapeDraw(host, e, located.world)
        return
      }
      const under = located.hit ? store.model?.objects.find((o) => o.name === located.hit) : undefined
      if (under?.className === SHAPE) {
        // A press on the shape picks it; one of its morphs, when selected, stays selected, so its target stays in hand (D257).
        if (!store.selection.includes(under.name) || (store.selectedActions.length > 0 && !shapeMorphSelected(under.name))) store.select([under.name])
        return
      }
      // Empty space in Edit mode (D255): a drag boxes the points of the shape in hand, or, past them, the shapes it touches; a click deselects (D236 revised).
      const extend = e.ctrlKey || e.metaKey
      beginMarquee(host, e, located, (box) => {
        const s = useStore.getState()
        const edited = shapeRef.current
        if (!box) {
          s.select([])
          return
        }
        const inside = edited?.editable ? edited.frame.anchors.map((p, i) => (box.has(p) ? i : -1)).filter((i) => i >= 0) : []
        if (inside.length > 0) {
          s.setPathPoints(extend ? [...new Set([...s.pathPoints, ...inside])] : inside)
          return
        }
        const names = box.objects().filter((n) => s.model?.objects.find((o) => o.name === n)?.className === SHAPE)
        if (names.length > 0 || !extend) s.select(extend ? [...s.selection, ...names.filter((n) => !s.selection.includes(n))] : names)
      })
      return
    }
    // The Camera tool is Select for cameras alone (D373): a press picks the camera under it, and nothing else is picked or moved. In the Camera view the picture is the camera's own, so a press there is a press on the camera that has the picture. A move of the camera there, by the middle button or with Alt, moves that camera with any tool, and a scene with no camera gets one first, in the same undo step (D369, D428).
    const camerasOnly = toolNow === 'camera' && !panCamera
    /** The camera dragged as the picture, in its own view. */
    let pictured: string | null = null
    let madeCamera = false
    if (toolNow === 'camera') {
      if (!store.model || !canEdit()) return
      if (inCameraView) {
        if (panCamera && camerasOf(store.model).length === 0) {
          beginGesture()
          madeCamera = true
        }
        pictured = cameraInHand(panCamera)
        if (!pictured) {
          if (madeCamera) endGesture()
          return
        }
        // Pressed, it is selected, as whatever Select presses is; the middle button leaves what is selected as it is.
        const now = useStore.getState()
        if (!panCamera && !(now.selection.length === 1 && now.selection[0] === pictured)) now.select([pictured])
        store = useStore.getState()
      }
    }
    const model = store.model
    if (!model) return

    // A new gesture without Shift ends any Shift gesture still waiting for its key release.
    if (!animateHeld(e) && gestureRef.current) {
      store.setTime(gestureRef.current.restore)
      gestureRef.current = null
    }

    // With the Path tool, a path under the pointer comes first (D194, D203, D208): a point of it or its line, of any path shown, which the press picks. No other tool takes a press on a path (D405): the path in hand is the Path tool's alone, so a press on an object at the end of its path is a press on the object.
    // A camera in hand is all the press is about: no path under the pointer comes before it. The Camera tool works on a camera's own path, and no other.
    const aCamera = (name: string | undefined): boolean => !!name && model.objects.find((o) => o.name === name)?.className === CAMERA
    const shown = pictured || (on && 'camera' in on) || (camerasOnly && !aCamera(pathRef.current?.primary?.ref.object)) ? null : pathRef.current
    const pathAction = store.selectedActions.length === 1 ? store.selectedActions[0]! : null
    const pathTool = toolNow === 'path'
    const pixel = 1 / viewport.zoom
    // A control of a picked anchor of the selected curves path comes first (D246).
    if (shown?.primary && shown.primary.handles.length > 0 && !animateHeld(e) && !(pathTool && store.pathMode === 'move')) {
      const control = nearestPoint(shown.primary.handles.map((h) => h.point), located.world, 8 * pixel)
      if (control !== null) {
        beginPathHandleDrag(host, e, shown.primary.ref, shown.primary.handles[control]!, located.world)
        return
      }
    }
    // With Move path, the handle above the path's box turns the path about the point it begins at (D394).
    if (pathTool && store.pathMode === 'move' && shown?.primary && !animateHeld(e)) {
      layoutRef.current(inCameraView ? 'camera' : 'world')
      if (renderer.onPathTurnHandle(located.world)) {
        beginPathTurn(host, e, shown.primary.ref, shown.primary.frame, located.world)
        return
      }
    }
    const candidates = [...(shown?.primary ? [shown.primary] : []), ...(pathTool ? (shown?.others ?? []) : [])]
    let hitPath: { ref: ActionRef; frame: PathFrame; point: number | null; segment: number | null } | null = null
    for (const p of candidates) {
      const point = nearestPoint(p.frame.anchors, located.world, 8 * pixel)
      const segment = point === null ? nearestSegment(p.frame.curve, located.world, 6 * pixel) : null
      if (point !== null || segment !== null) {
        hitPath = { ref: p.ref, frame: p.frame, point, segment }
        break
      }
    }
    if (hitPath && !animateHeld(e)) {
      const ctrlHeld = e.ctrlKey || e.metaKey
      const isSelected = !!pathAction && pathAction.object === hitPath.ref.object && pathAction.index === hitPath.ref.index
      if (!isSelected) store.selectAction(hitPath.ref.object, hitPath.ref.index)
      if (pathTool && store.pathMode === 'move') {
        // Move path: any point or the line carries the whole path (D208): one that begins where its object is by its object (D387), another whose shape is code by its offset (D223).
        if (pathEditable(hitPath.ref) || pathBeginsAtObject(hitPath.ref)) beginPathMove(host, e, hitPath.ref, located.world, null)
        else beginPathShift(host, e, hitPath.ref, located.world)
        return
      }
      if (pathEditable(hitPath.ref)) {
        if (hitPath.point !== null) {
          // In Create a press on a path's last point takes the path up, as a pen does: the presses after it go on from there (D414).
          if (pathTool && store.pathMode === 'create' && !ctrlHeld && hitPath.point === hitPath.frame.anchors.length - 1) takeUpPath(hitPath.ref)
          beginPathEdit(host, e, hitPath.ref, located.world, hitPath.point, null, ctrlHeld)
          return
        }
        if (!ctrlHeld) {
          // A click on the line puts a point there and drags it.
          beginPathEdit(host, e, hitPath.ref, located.world, null, pathInsertionAt(hitPath.frame, hitPath.segment!, located.world), false)
          return
        }
      }
      return
    }
    // The Path tool elsewhere (D203, D208, D411): on an object, its path, the one in force at the playhead (D389), is picked. The rest is by mode. Create draws (D414): on an object with no path, one starts where the object is and the same press draws on from it; on empty space, the path being drawn takes a corner or a drawn line, and with none being drawn a new path begins at the playhead for the thing in hand, the press its second point, whatever paths that thing has. Edit makes nothing: an object with no path is picked itself, a drag from empty space boxes the points of the path in hand, and a click there lets everything go, as with the Shape tool (D255).
    if (pathTool) {
      const creating = store.pathMode === 'create'
      /** A new path of a class, for every member, reached through the member `member` (D247): its place among that member's animations. */
      const newClassPath = (member: string, cls: string): ActionRef | null => {
        // Selected through that member in the step that makes it, so undo takes both back together.
        addClassPath(cls, store.time, member)
        const fresh = useStore.getState()
        const made = fresh.model?.objects.find((o) => o.name === member)?.actions.map((a, index) => ({ a, index })).filter(({ a }) => a.verb === 'path' && a.classAction?.className === cls && !a.overridden).pop()
        if (!made) return null
        fresh.selectAction(member, made.index)
        return { object: member, index: made.index }
      }
      if (located.hit) {
        const pressed = model.objects.find((o) => o.name === located.hit)
        if (!pressed) return
        // What the press picks (D247): the object's own path, its outermost group's, or its class's, a relative path every member follows.
        const cls = store.pick === 'class' ? pressed.classes[0] : undefined
        if (cls) {
          const classPaths = pressed.actions.map((action, index) => ({ action, index })).filter(({ action }) => action.verb === 'path' && action.classAction?.className === cls && !action.overridden)
          const found = pathInForce(classPaths, store.time)
          if (found) {
            if (!(pathAction && pathAction.object === pressed.name && pathAction.index === found.index)) store.selectAction(pressed.name, found.index)
            return
          }
          if (!creating) return
          // One gesture from the press to the release: the path and the line drawn from it are one undo step.
          beginGesture()
          const made = newClassPath(pressed.name, cls)
          const fresh = useStore.getState()
          const again = fresh.model?.objects.find((o) => o.name === pressed.name)
          if (made && again && fresh.model) {
            takeUpPath(made)
            beginStroke(host, e, made, positionAt(fresh.model, again, store.time), false, true)
          } else endGesture()
          return
        }
        const owner = store.pick === 'group' ? model.objects.find((o) => o.name === pickTargets(model, pressed.name, 'group')[0]) : pressed
        if (!owner) return
        const chosen = pathInForce(owner.actions.map((action, index) => ({ action, index })).filter(({ action }) => action.verb === 'path' && !action.classAction && !action.overridden), store.time)
        if (chosen) {
          if (!(pathAction && pathAction.object === owner.name && pathAction.index === chosen.index)) store.selectAction(owner.name, chosen.index)
          return
        }
        if (!creating) {
          if (store.pathMode === 'edit' && !(store.selection.length === 1 && store.selection[0] === owner.name && store.selectedActions.length === 0)) store.select([owner.name])
          return
        }
        beginGesture()
        const index = addPath(owner.name, store.time)
        // A group's line runs from the middle of its members (D247).
        const from = owner.className === GROUP ? (renderer.frameOf(owner.name) ?? positionAt(model, owner, store.time)) : positionAt(useStore.getState().model ?? model, owner, store.time)
        if (index !== null) {
          takeUpPath({ object: owner.name, index })
          beginStroke(host, e, { object: owner.name, index }, { x: from.x, y: from.y }, false, true)
        } else endGesture()
        return
      }
      if (store.pathMode === 'edit') {
        const extend = e.ctrlKey || e.metaKey
        beginMarquee(host, e, located, (box) => {
          const s = useStore.getState()
          if (!box) {
            if (!extend) s.select([])
            return
          }
          const edited = pathRef.current?.primary
          const inside = edited?.editable ? edited.frame.anchors.map((p, i) => (box.has(p) ? i : -1)).filter((i) => i >= 0) : []
          // The path whose points the box holds is picked with them, where it was only shown.
          const picked = s.selectedActions.length === 1 && !!edited && s.selectedActions[0]!.object === edited.ref.object && s.selectedActions[0]!.index === edited.ref.index
          if (edited && inside.length > 0 && !picked) s.selectAction(edited.ref.object, edited.ref.index)
          useStore.getState().setPathPoints(extend && picked ? [...new Set([...s.pathPoints, ...inside])] : inside)
        })
        return
      }
      if (!creating) return
      // The path in hand: the one selected, or the one shown for the thing selected. Being drawn, it takes the corner or the line, picked by the press where it was only shown.
      const inHand = shown?.primary?.editable ? shown.primary.ref : null
      const held = inHand && (!pathAction || (pathAction.object === inHand.object && pathAction.index === inHand.index)) ? inHand : null
      if (held && goesOn(held)) {
        if (!pathAction) store.selectAction(held.object, held.index)
        takeUpPath(held)
        beginStroke(host, e, held, located.world, true)
        return
      }
      // Any other path is left as it is (D414): a new one begins at the playhead, for the thing the path in hand belongs to, a class's for the class, or for the one thing selected, and the press is its second point.
      const of = held ? model.objects.find((o) => o.name === held.object)?.actions[held.index] : undefined
      const name = held ? held.object : !pathAction && store.selection.length === 1 ? store.selection[0]! : null
      if (name === null) return
      const cls = of?.classAction?.className
      // One gesture from the press to the release: the path, the point pressed, and the line drawn on are one undo step.
      beginGesture()
      const index = cls ? null : addPath(name, store.time)
      const made = cls ? newClassPath(name, cls) : index !== null ? { object: name, index } : null
      if (made) {
        insertPathPoints(made, 1, [gridded(located.world)])
        takeUpPath(made)
        beginStroke(host, e, made, located.world, false, true)
      } else endGesture()
      return
    }

    const mode = toolNow === 'camera' ? 'all' : store.transformMode
    const selection = store.selection
    const ctrl = !pictured && (e.ctrlKey || e.metaKey)
    // The handles are where this view has them, laid out here since the press may just have changed what is selected, and every drawing ends laid out for the Camera view.
    layoutRef.current(inCameraView ? 'camera' : 'world')
    // A handle of the selection wins over whatever is drawn under it; the camera dragged in its own view has none there, and the Camera tool has the handles of cameras alone.
    const handle = selection.length > 0 && !ctrl && !pictured && (!camerasOnly || selection.every(aCamera)) ? renderer.pickHandle(located.world) : null
    // A selected group is one thing: its members stand for it (D124).
    const selectedGroup = groupOf(model, selection)
    const members = selectedGroup ? groupMembers(model, selectedGroup.name) : []
    // A camera is picked by its frame's line or by its name, before anything drawn under it, and with Select never by what it frames (D361). The Camera tool picks it by all of its frame, and picks nothing else (D373).
    const cameraHit = pictured ?? (on && 'camera' in on ? on.camera : inCameraView ? null : cameraUnder(located, camerasOnly, selection))
    const under = cameraHit ?? (camerasOnly ? null : located.hit)
    // What the press picks (D247): the object, its outermost group, or every object of its class; a camera is itself.
    const picked = cameraHit ? [cameraHit] : under ? pickTargets(model, under, store.pick) : []
    const hit = handle ? (selectedGroup ? selectedGroup.name : selection.includes(under ?? '') ? under! : selection[0]!) : under && store.pick === 'group' ? picked[0]! : under

    if (!hit) {
      // Empty space: a drag selects what it touches, a click clears the selection (D89). The store folds exactly a group's members into the group (D124).
      const extend = ctrl
      beginMarquee(host, e, located, (box) => {
        const s = useStore.getState()
        // The box picks things, never a path's points: those are the Path tool's (D405).
        if (!box) {
          if (!extend) s.select([])
        } else {
          // A box drawn with the Camera tool takes the cameras it touches (D373).
          const names = camerasOnly ? box.cameras() : box.objects()
          s.select(extend ? [...s.selection, ...names.filter((n) => !s.selection.includes(n))] : names)
        }
      })
      return
    }

    if (!handle && ctrl) {
      // Ctrl-click adds or removes; on a member of the selected group it picks that member alone (D89, D124); with a class picked, every member goes in or out.
      if (store.pick === 'class') for (const n of picked) store.toggleSelected(n)
      else store.toggleSelected(hit)
      return
    }

    // The gesture works on the plane of what it took up (D434): what is selected, for a handle of its box; else the thing pressed, which may lie at another depth.
    if (!handle) {
      const plane = renderer.planeOf(hit)
      if (!samePlane(plane, viewport.plane)) {
        gesturePlaneRef.current = plane
        viewport.plane = plane
        located.world = viewport.toWorld(located.paneX, located.paneY)
      }
    }
    // The gesture works on the selection when the hit thing is part of it, else on what the press picks.
    const classPick = store.pick === 'class' && picked.length > 1
    const inSelection = selection.includes(hit) || (!!selectedGroup && members.includes(hit)) || (classPick && picked.every((n) => selection.includes(n)))
    const names = panCamera ? [hit] : handle || inSelection ? selection : classPick ? picked : [hit]
    if (!inSelection && !panCamera) store.select(classPick ? picked : [hit])
    const objects = names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o)
    if (objects.length === 0) return
    const subject = objects.find((o) => o.name === hit) ?? objects[0]!
    const op: Drag['op'] = handle ? (handle.kind === 'rotate' ? 'rotate' : 'resize') : mode === 'rotate' ? 'rotate' : 'move'
    const isGroup = objects.length === 1 && subject.className === GROUP
    /** What the gesture is about: positions, the angle, or the size. A match here makes a selected action the target. */
    /** A move of the camera made in its own view (D428), and what it changes. */
    const pictureMove: CameraMove | null = pictured ? (move ?? 'across') : null
    const moveKeys = pictureMove ? cameraKeys(pictureMove, looksStraight(viewOf(model, subject, store.time))) : null
    const primaryAttrs = (obj: SceneObject): string[] => moveKeys ?? (op === 'move' ? ['x', 'y'] : op === 'rotate' ? ['rotation'] : resizeAttrs(obj.className))

    // An object that a path places is dragged as one that a move places (D388): the path is a move with a shape, so the rules below are all there are, and a press never takes the playhead anywhere.
    // While a recording runs, or waits for this, what is dragged is recorded (D397): Shift means nothing more then, and no animation in hand takes the drag. A Shape's resize, which rewrites its points, is recorded as a morph to the outline it leaves (D412).
    const recorded = store.recording
    let kind: Drag['kind'] = recorded ? 'recorded' : animateHeld(e) ? 'timed' : 'plain'
    let actionIndex = -1
    let derived = false
    let showTime: number | null = null
    /** The time whose state the drag sets when the selected animation is what it is about: its start, or with Shift its end (D157). */
    let editAt: number | null = null
    const selected = store.selectedActions.find((r) => r.object === subject.name)
    const selectedAction = selected ? subject.actions[selected.index] : undefined
    // A path is about the place (D388): selected, a move of its object is about its end, as a move's is.
    const matches = !recorded && objects.length === 1 && !!selectedAction && (selectedAction.verb === 'path' ? op === 'move' : primaryAttrs(subject).some((a) => a in selectedAction.changes))
    const previewing = !recorded && gestureRef.current?.editing ? gestureRef.current : null
    if (previewing && selectedAction && objects.length === 1 && animateHeld(e) && (selectedAction.verb !== 'path' || op === 'move')) {
      // Shift held on the selected animation previews one of its ends: any drag sets that end's state, whatever the animation changes so far (D157, D188).
      if (previewing.editEnd === 'start') editAt = selectedAction.start
      else {
        kind = 'destination'
        actionIndex = selected!.index
        derived = !!selectedAction.classAction
        editAt = selectedAction.end
      }
    } else if (matches && animateHeld(e) && !gestureRef.current && store.time <= selectedAction!.end + 0.5 / store.settings.fps) {
      // Shift given to the pointer alone, with a matching animation selected and the playhead not past it: its end state (D329).
      kind = 'destination'
      actionIndex = selected!.index
      derived = !!selectedAction!.classAction
      editAt = selectedAction!.end
    } else if (matches && !animateHeld(e) && Math.abs(selectedAction!.end - store.time) < 0.5 / store.settings.fps) {
      // The animation selected and the playhead at its end: a plain drag sets its end state. Anywhere else a plain drag edits what shows at the playhead, so the playhead never leaves the moment the pointer is in (D314, revising D157 and D187).
      kind = 'destination'
      actionIndex = selected!.index
      derived = !!selectedAction!.classAction
      editAt = selectedAction!.end
    }
    // A plain drag in the middle of an animation writes an animation from the animation's start to the playhead, which the drag then edits (D263): the playhead stays.
    if (editAt !== null) showTime = editAt
    // A gesture on a group, plain or not, edits the group itself, as on any object (D124).
    const targets = objects
    const primary = targets.find((o) => o.name === hit) ?? targets[0]!
    const sampleTime = editAt ?? store.time
    const frame = (objects.length > 1 ? renderer.boxAround(names, axesRef.current) : renderer.frameOf(subject.name)) ?? { x: 0, y: 0, rotation: 0, width: 1, height: 1 }
    const axes0 = axesRef.current
    const base = new Map<string, Record<string, number>>()
    const locals = new Map<string, { x: number; y: number }>()
    for (const obj of targets) {
      const values = baseValues(model, obj, sampleTime)
      base.set(obj.name, values)
      locals.set(obj.name, toLocal(frame, { x: values['x']!, y: values['y']! }))
    }
    const angle0 = Math.atan2(located.world.y - frame.y, located.world.x - frame.x)
    // A move knows the dragged things' box and everyone else's, for edge snapping and collision (D135, D136).
    const dragged = new Set<string>()
    const expand = (name: string): void => {
      if (dragged.has(name)) return
      dragged.add(name)
      if (model.objects.find((o) => o.name === name)?.className === GROUP) for (const member of groupMembers(model, name)) expand(member)
    }
    for (const o of targets) expand(o.name)
    // The picture dragged in the Camera view is framed by eye: nothing there to align the camera's frame to.
    const isCamera = subject.className === CAMERA
    // A move carries the thing in the plane that faces the view (D430) where that is not a move across its own plane: in a view that does not look straight into the scene, and so in depth too; and a camera, which is where it stands and not its frame, in any view. What is held on the screen stays on the picture.
    const subjectPlane = renderer.planeOf(subject.name)
    const lifted = op === 'move' && !pictured && (isCamera || (!viewport.straight && !subjectPlane.turn))
    const inDepth = lifted && !viewport.straight
    // Nothing is aligned to, or run into, by a move in depth.
    const box0Frame = op === 'move' && !pictured && !inDepth ? renderer.boxAround(targets.map((o) => o.name)) : null
    const others: { name: string; box: Box }[] = []
    let movers: Drag['movers'] = null
    // An animation's push comes from its straight line (D206): the dragged outline sweeps from where the animation starts, which for an end being edited is not where the object shows now.
    let sweepOrigin: Point = { x: 0, y: 0 }
    if (kind === 'destination' && actionIndex >= 0 && !isGroup) {
      const action = subject.actions[actionIndex]
      const b = base.get(subject.name)
      if (action && b) {
        const at = positionAt(model, subject, action.start)
        sweepOrigin = { x: b['x']! - at.x, y: b['y']! - at.y }
      }
    }
    // A Shape's points as a resize begins, with the center of its box and its scale in its own space, so its handles scale the points about the anchor (D233).
    const shapeBase: Drag['shapeBase'] =
      op === 'resize' && objects.length === 1 && subject.className === SHAPE
        ? { points: shapeEditable(subject.name) === 'points' ? shapeOwnPoints(model, subject, sampleTime) : null, segs: shapeEditable(subject.name) === 'curves' ? shapeOwnSegs(model, subject, sampleTime) : null, center: (({ x, y }) => ({ x, y }))(ownBounds(model, subject, sampleTime)), scale: base.get(subject.name)?.['scale'] || 1 }
        : null
    // What an object collides with: a Shape by the line it is drawn with (D232).
    const outlineFor = (o: SceneObject, f: Frame, shift: Point = { x: 0, y: 0 }): Polygon =>
      outlineOf(o, { ...f, x: f.x - shift.x, y: f.y - shift.y }, o.className === SHAPE ? shapeWorldCurve(model, o, sampleTime).map((p) => ({ x: p.x - shift.x, y: p.y - shift.y })) : undefined)
    if (op === 'move') {
      const draggedPolys: Mover['polys'] = []
      const obstacles: Mover[] = []
      for (const o of model.objects) {
        // A camera is not drawn: nothing snaps to it or runs into it, and it runs into nothing (D357).
        if (o.className === GROUP || o.className === CAMERA) continue
        const f = renderer.frameOf(o.name)
        if (!f) continue
        if (dragged.has(o.name)) {
          draggedPolys.push(outlineFor(o, f, sweepOrigin))
          continue
        }
        // A mask is not drawn: nothing snaps to it or runs into it (D334).
        if (maskDrawnBy(model, o.name)) continue
        // Nor is what lies in another plane aligned to or run into (D434).
        if (!samePlane(planeOfFrame(f), subjectPlane)) continue
        others.push({ name: o.name, box: toBox(f) })
        // What a push moves is written through the solver from where it shows now; what cannot be written is as good as anchored.
        if (!base.has(o.name)) base.set(o.name, baseValues(model, o, sampleTime))
        obstacles.push(makeMover(o.name, [outlineFor(o, f)], store.anchored.includes(o.name) || !o.decl, store.soft.includes(o.name)))
      }
      // Nor does a dragged mask run into anything.
      if (draggedPolys.length > 0 && ![...dragged].every((n) => maskDrawnBy(model, n))) movers = { dragged: makeMover(primary.name, draggedPolys, false, false), obstacles }
    }
    const drag: Drag = {
      kind,
      op,
      names: targets.map((o) => o.name),
      primary: primary.name,
      group: isGroup,
      // Several things animated as one are a group (D124): a Shift-drag makes it, and so does a recorded one.
      grouping: objects.length > 1 && (animateHeld(e) || recorded) ? names : null,
      handle,
      // A camera's frame keeps the picture's proportions (D361).
      keepAspect: e.altKey || isCamera,
      anchor: store.anchor,
      actionIndex,
      derived,
      showTime,
      startX: e.clientX,
      startY: e.clientY,
      frame,
      base,
      locals,
      box0: box0Frame ? toBox(box0Frame) : null,
      others,
      // What a dragged thing aligns to is the frame; a camera's own frame aligns to the project's at the scene's middle.
      frameBox: isCamera ? viewport.sceneRect() : viewport.frameRect(),
      movers,
      sweepOrigin,
      shapeBase,
      lastAngle: angle0,
      turned: 0,
      local0: toLocal(frame, located.world),
      moved: false,
      created: false,
      shown: false,
      click: selected && !handle && !animateHeld(e) ? 'object' : 'none',
      touched: new Set(),
      pushedActions: new Map(),
      pushedShifts: new Map(),
      paneX: located.paneX,
      paneY: located.paneY,
    }
    if (lifted) {
      const b = base.get(subject.name)
      drag.lifted = { at: new THREE.Vector3(b?.['x'] ?? 0, b?.['y'] ?? 0, isCamera ? (b?.['z'] ?? 0) : subjectPlane.z), depth: inDepth }
    }
    if (pictured) {
      // The camera itself moved in the Camera view (D361, D428): across, round, closer, or turned, from where it is as the drag begins.
      const mover = cameraMover(pictureMove ?? 'across', pictured, sampleTime, located)
      if (mover) {
        drag.custom = mover
        drag.together = moveKeys ?? undefined
      }
      // A press on an end of an axis of its compass, let go of where it began, faces the camera along it.
      const end = on && 'view' in on ? on.axis : null
      if (end) drag.onClick = () => faceCamera(end, animateHeld(e))
    }
    dragRef.current = drag
    if (drag.op === 'resize' && drag.keepAspect) setDragging('aspect')
    // A Shift gesture that began on the key already moved the playhead to the proposed end; the animation still starts where it was, or after the last one made in Chain mode (D103, D127).
    const restoreTime = gestureRef.current?.from ?? store.time
    const proposed = gestureRef.current?.duration ?? 1
    // One drag is one undo step, pushed things included (D22, D136); a camera made for it is in that step.
    if (!madeCamera) beginGesture()
    capture(
      host,
      e.pointerId,
      (ev) => {
        const dx = ev.clientX - drag.startX
        const dy = ev.clientY - drag.startY
        if (!drag.moved && Math.hypot(dx, dy) < 3) return
        if (!drag.moved) {
          if (drag.grouping) {
            // A Shift-drag on several objects makes them a group, or finds the group they already are, and animates it (D124).
            const known = new Set(useStore.getState().model?.objects.map((o) => o.name))
            const name = createGroup(drag.grouping)
            if (!name) return
            // A group made for a recorded drag goes again with its animation, should the review not keep that (D404).
            if (drag.kind === 'recorded' && !known.has(name)) noteGroup(name)
            const fresh = useStore.getState()
            const groupObj = fresh.model?.objects.find((o) => o.name === name)
            const frameNow = renderer.frameOf(name)
            if (!fresh.model || !groupObj || !frameNow) return
            drag.names = [name]
            drag.primary = name
            drag.group = true
            drag.grouping = null
            drag.frame = frameNow
            drag.base.set(name, baseValues(fresh.model, groupObj, fresh.time))
            drag.local0 = toLocal(drag.frame, located.world)
            drag.lastAngle = Math.atan2(located.world.y - drag.frame.y, located.world.x - drag.frame.x)
          }
          if (drag.kind === 'destination' && drag.derived) {
            const index = overrideClassAction(drag.primary, drag.actionIndex)
            if (index === null) return
            drag.actionIndex = index
            drag.derived = false
          }
          if (drag.showTime !== null) useStore.getState().setTime(drag.showTime)
          if (drag.kind === 'recorded') {
            if (!useStore.getState().selection.includes(drag.primary)) useStore.getState().select([drag.primary])
            // A recording that waited for its first action runs from here.
            useStore.getState().runRecording()
          }
          if (drag.kind === 'timed') {
            if (!useStore.getState().selection.includes(drag.primary)) useStore.getState().select([drag.primary])
            if (useStore.getState().pin === 'start' && !gestureRef.current) gestureRef.current = { restore: restoreTime, from: restoreTime, duration: proposed }
          }
        }
        drag.moved = true
        const bounds = host.getBoundingClientRect()
        const world = viewport.toWorld(ev.clientX - bounds.left, ev.clientY - bounds.top)
        const snap = useStore.getState().previewSnap
        const values = new Map<string, Record<string, number>>()
        const primaryBase = drag.base.get(drag.primary)!
        if (drag.op === 'rotate') {
          // The turn adds up move by move, so dragging on past a full circle keeps counting and the
          // direction is the one the pointer took (D105). Everything turns around the frame's center.
          const angle = Math.atan2(world.y - drag.frame.y, world.x - drag.frame.x)
          let step = angle - drag.lastAngle
          if (step > Math.PI) step -= 2 * Math.PI
          if (step < -Math.PI) step += 2 * Math.PI
          drag.turned += step
          drag.lastAngle = angle
          let delta = (drag.turned * 180) / Math.PI
          if (snap.on) delta = snapTo(primaryBase['rotation']! + delta, snap.angle) - primaryBase['rotation']!
          if (drag.group) values.set(drag.primary, { rotation: primaryBase['rotation']! + delta })
          else {
            // Each thing turns around the frame's center: its position follows the arc and its rotation turns (D96).
            // Several at once keep their box on the turned axes, so the center they turned around stays the center (D116).
            if (drag.names.length > 1) axesRef.current = axes0 + delta
            const rad = (delta * Math.PI) / 180
            for (const name of drag.names) {
              const b = drag.base.get(name)!
              const l = drag.locals.get(name)!
              const p = toWorld(drag.frame, { x: l.x * Math.cos(rad) - l.y * Math.sin(rad), y: l.x * Math.sin(rad) + l.y * Math.cos(rad) })
              values.set(name, drag.names.length > 1 ? { x: p.x, y: p.y, rotation: b['rotation']! + delta } : { rotation: b['rotation']! + delta })
            }
          }
        } else if (drag.op === 'resize' && drag.handle?.kind === 'resize') {
          const l = toLocal(drag.frame, world)
          if (drag.group) {
            // An animated group scales around the center of its box: the handle's distance from it sets the factor (D124).
            const d0 = Math.hypot(drag.local0.x, drag.local0.y) || 1
            let f = Math.max(0.01, Math.hypot(l.x, l.y) / d0)
            if (snap.on) f = Math.max(0.05, snapTo(f, 0.05))
            values.set(drag.primary, { scale: (primaryBase['scale'] || 1) * f })
          } else {
            const { sx, sy } = drag.handle
            const w0 = Math.max(1e-6, drag.frame.width)
            const h0 = Math.max(1e-6, drag.frame.height)
            // The anchor stays put: the far side, or the center (D104). The new size is the distance from it.
            const anchorLocal = drag.anchor === 'center' ? { x: 0, y: 0 } : { x: (-sx * w0) / 2, y: (-sy * h0) / 2 }
            const across = drag.anchor === 'center' ? 2 : 1
            let width = sx !== 0 ? Math.max(1, sx * (l.x - anchorLocal.x) * across) : w0
            let height = sy !== 0 ? Math.max(1, sy * (l.y - anchorLocal.y) * across) : h0
            if (drag.keepAspect && sx !== 0 && sy !== 0) {
              // Keeping the proportions follows the pointer along the diagonal, which never flips between axes.
              const d = { x: sx * w0, y: sy * h0 }
              const v = { x: l.x - anchorLocal.x, y: l.y - anchorLocal.y }
              const f = Math.max(1 / Math.max(w0, h0), ((v.x * d.x + v.y * d.y) / (d.x * d.x + d.y * d.y)) * across)
              width = w0 * f
              height = h0 * f
            } else if (drag.keepAspect && sx !== 0) {
              // A side handle keeps the proportions too: the far side stays put, and the other axis scales about its middle (D158).
              height = h0 * (width / w0)
            } else if (drag.keepAspect && sy !== 0) {
              width = w0 * (height / h0)
            }
            if (snap.on) {
              width = Math.max(1, snapTo(width, snap.grid))
              height = Math.max(1, snapTo(height, snap.grid))
            }
            const fx = width / w0
            const fy = height / h0
            const current = useStore.getState().model
            for (const name of drag.names) {
              const obj = current?.objects.find((o) => o.name === name)
              if (!obj) continue
              const b = drag.base.get(name)!
              // A Shape's points scale about the anchor in its own space and are written (D233); points that are code scale by `scale` instead. With Shift, the scaled outline is the target of a morph written at the first move (D257).
              if (obj.className === SHAPE && drag.shapeBase) {
                const about = { x: drag.shapeBase.center.x + anchorLocal.x / drag.shapeBase.scale, y: drag.shapeBase.center.y + anchorLocal.y / drag.shapeBase.scale }
                if (drag.kind === 'recorded' && (drag.shapeBase.points || drag.shapeBase.segs)) {
                  // While a recording runs the outline as resized is the target of a morph, at the pace it is resized (D412).
                  if (recordOutline(name, { fx, fy }, { fx: 1, fy: 1 }, (from, m) => scalePathData(from, about, m['fx'] ?? 1, m['fy'] ?? 1))) drag.created = true
                  continue
                }
                if (drag.kind === 'timed' && (drag.shapeBase.points || drag.shapeBase.segs)) {
                  if (!drag.created) {
                    if (addMorph(name, restoreTime, proposed, gestureRef.current?.editing ? 'start' : useStore.getState().pin) === null) continue
                    drag.created = true
                    drag.morphBase = shapeEditBase(name)
                  }
                  const target = drag.morphBase
                  if (target?.kind === 'curves') scaleShapeCurves(name, target.segs, { x: b['x']!, y: b['y']! }, about, fx, fy)
                  continue
                }
                if (drag.shapeBase.points) scaleShapePoints(name, drag.shapeBase.points, { x: b['x']!, y: b['y']! }, about, fx, fy)
                else if (drag.shapeBase.segs) scaleShapeCurves(name, drag.shapeBase.segs, { x: b['x']!, y: b['y']! }, about, fx, fy)
                else values.set(name, { scale: (b['scale'] || 1) * (Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy) })
                continue
              }
              const l0 = drag.locals.get(name)!
              // Each thing's center moves with the box's scaling from the anchor; it stays only when nothing is anchored away from it.
              const p = toWorld(drag.frame, { x: anchorLocal.x + (l0.x - anchorLocal.x) * fx, y: anchorLocal.y + (l0.y - anchorLocal.y) * fy })
              const v = resizedValues(obj.className, b, fx, fy)
              if (Math.abs(p.x - b['x']!) > 1e-6 || Math.abs(p.y - b['y']!) > 1e-6) Object.assign(v, { x: p.x, y: p.y })
              values.set(name, v)
            }
          }
        } else if (drag.custom) {
          // A move of the camera in its own view (D428): what it shows is worked out from where the drag began.
          values.set(drag.primary, drag.custom(dx, dy))
        } else {
          // How far the pointer has gone: across the plane in hand, or, carried, in the plane that faces the view (D430); either way from where it began on the pane, by the view as it is now.
          const paneX = ev.clientX - bounds.left
          const paneY = ev.clientY - bounds.top
          const from = viewport.toWorld(drag.paneX, drag.paneY)
          const went = drag.lifted ? viewport.carry(drag.paneX, drag.paneY, paneX, paneY, drag.lifted.at) : { x: world.x - from.x, y: world.y - from.y, z: 0 }
          const tx = primaryBase['x']! + went.x
          const ty = primaryBase['y']! + went.y
          let ddx = tx - primaryBase['x']!
          let ddy = ty - primaryBase['y']!
          const guides: GuideLine[] = []
          const pushed: Mover[] = []
          if (drag.box0) {
            const live = useStore.getState()
            // Edges and centers within reach come first (D135), then the grid where nothing is in reach (D91).
            const reach = SNAP_REACH_PX / viewport.zoom
            const boxes = [...drag.others.map((o) => o.box), drag.frameBox]
            const sx = snap.edges ? snapAxis(drag.box0.left + ddx, drag.box0.right + ddx, boxes.map((b) => [b.left, (b.left + b.right) / 2, b.right]), reach) : null
            const sy = snap.edges ? snapAxis(drag.box0.bottom + ddy, drag.box0.top + ddy, boxes.map((b) => [b.bottom, (b.bottom + b.top) / 2, b.top]), reach) : null
            if (sx) {
              ddx += sx.shift
              guides.push({ x: sx.at })
            } else if (snap.on) ddx = snapTo(tx, snap.grid) - primaryBase['x']!
            if (sy) {
              ddy += sy.shift
              guides.push({ y: sy.at })
            } else if (snap.on) ddy = snapTo(ty, snap.grid) - primaryBase['y']!
            if (live.collide && drag.movers) {
              // Outlines collide (D136): the dragged thing walks toward the pointer and stops or pushes.
              const pushing: Pushing = live.push ? 'on' : 'off'
              // While a recording runs, time runs under the drag (D412): what has not been pushed is met where it is now, what has gone is met no more, and what has come is met.
              if (drag.kind === 'recorded' && live.model && drag.metAt !== live.time) {
                drag.metAt = live.time
                const known = new Map(drag.movers.obstacles.map((o) => [o.name, o]))
                const met: Mover[] = []
                for (const o of live.model.objects) {
                  if (o.className === GROUP || o.className === CAMERA || dragged.has(o.name) || maskDrawnBy(live.model, o.name) || !existsAt(live.model, o, live.time)) continue
                  const was = known.get(o.name)
                  // What the drag has pushed is where the drag put it.
                  if (was && (Math.abs(was.shift.x) > 1e-9 || Math.abs(was.shift.y) > 1e-9)) {
                    met.push(was)
                    continue
                  }
                  const f = renderer.frameOf(o.name)
                  if (!f || !samePlane(planeOfFrame(f), subjectPlane)) continue
                  drag.base.set(o.name, baseValues(live.model, o, live.time))
                  met.push(makeMover(o.name, [outlineOf(o, f, o.className === SHAPE ? shapeWorldCurve(live.model, o, live.time) : undefined)], live.anchored.includes(o.name) || !o.decl, live.soft.includes(o.name)))
                }
                drag.movers.obstacles = met
              }
              if (drag.kind === 'plain' || drag.kind === 'recorded') walk(drag.movers.dragged, { x: ddx, y: ddy }, drag.movers.obstacles, pushing)
              else {
                // An animation moves in a straight line from where it starts to where it ends, and that line is what meets and pushes: the sweep starts over from the start each time (D206).
                resetMover(drag.movers.dragged)
                for (const o of drag.movers.obstacles) resetMover(o)
                const target = { x: ddx + drag.sweepOrigin.x, y: ddy + drag.sweepOrigin.y }
                walk(drag.movers.dragged, target, drag.movers.obstacles, pushing, Math.max(4, Math.hypot(target.x, target.y) / 200))
              }
              ddx = drag.movers.dragged.shift.x - drag.sweepOrigin.x
              ddy = drag.movers.dragged.shift.y - drag.sweepOrigin.y
              pushed.push(...drag.movers.obstacles.filter((o) => Math.abs(o.shift.x) > 1e-9 || Math.abs(o.shift.y) > 1e-9))
            }
          } else if (snap.on) {
            ddx = snapTo(tx, snap.grid) - primaryBase['x']!
            ddy = snapTo(ty, snap.grid) - primaryBase['y']!
          }
          renderer.setGuides(guides, viewport.viewRect(), 1 / viewport.zoom)
          // In depth too, where the view does not look straight into the scene (D430): to the grid, when snapping is on.
          const deep = drag.lifted?.depth === true
          const ddz = !deep ? 0 : snap.on ? snapTo(primaryBase['z']! + went.z, snap.grid) - primaryBase['z']! : went.z
          for (const name of drag.names) {
            const b = drag.base.get(name)!
            values.set(name, deep ? { x: b['x']! + ddx, y: b['y']! + ddy, z: b['z']! + ddz } : { x: b['x']! + ddx, y: b['y']! + ddy })
          }
          for (const o of pushed) {
            const b = drag.base.get(o.name)
            if (b) values.set(o.name, { x: b['x']! + o.shift.x, y: b['y']! + o.shift.y })
          }
          // What was pushed earlier in this drag and is pushed no more goes back to where it was.
          for (const key of drag.touched) {
            const name = key.slice(0, key.lastIndexOf(':'))
            if (!values.has(name) && !drag.names.includes(name)) {
              const b = drag.base.get(name)
              if (b) values.set(name, { x: b['x']!, y: b['y']! })
            }
          }
        }
        // Only values the gesture has moved get written, so an edge drag on a circle adds one line, not two; once moved, a value is written even when it comes back to its start.
        const changed = (name: string, v: Record<string, number>): Record<string, number> => {
          const b = drag.base.get(name)!
          return Object.fromEntries(
            Object.entries(v).filter(([attr, value]) => {
              const key = `${name}:${attr}`
              if (Math.abs(value - (b[attr] ?? 0)) > 1e-6) drag.touched.add(key)
              return drag.touched.has(key)
            }),
          )
        }
        // What an animation's drag pushes gets a move of its own over the same span, kept up to date as the push goes on (D136).
        const writePushed = (ownerIndex: number): void => {
          if (!drag.movers) return
          const owner = useStore.getState().model?.objects.find((o) => o.name === drag.primary)?.actions[ownerIndex]
          if (!owner) return
          for (const o of drag.movers.obstacles) {
            const moved = Math.abs(o.shift.x) > 1e-9 || Math.abs(o.shift.y) > 1e-9
            let index = drag.pushedActions.get(o.name)
            if (index === undefined) {
              if (!moved) continue
              const made = appendPushedMove(o.name, owner.start, owner.end - owner.start)
              if (made === null) continue
              index = made
              drag.pushedActions.set(o.name, index)
            }
            const b = drag.base.get(o.name)
            if (b) setActionDestination(o.name, index, { x: b['x']! + o.shift.x, y: b['y']! + o.shift.y })
            // Its move begins when the dragged thing reaches it and keeps the same ramps from there, so the two move as one (D167).
            const travelled = Math.hypot(drag.movers.dragged.shift.x, drag.movers.dragged.shift.y)
            const fraction = o.contact === null || travelled < 1e-6 ? 0 : Math.max(0, Math.min(1, o.contact / travelled))
            const span = owner.end - owner.start
            const minimum = 1 / useStore.getState().settings.fps
            const at = Math.min(owner.end - minimum, owner.start + unease(easingFor(owner.timing, span), fraction) * span)
            const easeIn = Math.max(0, (owner.timing.easeIn ?? span * DEFAULT_EASE_FRACTION) - (at - owner.start))
            const easeOut = owner.timing.easeOut ?? span * DEFAULT_EASE_FRACTION
            setActionTiming(o.name, index, { at, duration: owner.end - at, easeIn, easeOut })
            drag.pushedShifts.set(o.name, { x: o.shift.x, y: o.shift.y })
          }
        }
        if (drag.kind === 'recorded') {
          const v = values.get(drag.primary)
          if (!v) return
          const live = useStore.getState()
          // The recording stopped with the drag still held: what was dragged is written already, and the rest of the drag writes nothing.
          if (!live.recording) return
          // What a group in hand carries, of what is in view: their lives are widened with its animation, as a thing's own is (D403).
          if (!drag.carried) drag.carried = live.model?.objects.find((o) => o.name === drag.primary)?.className === GROUP ? groupMembers(live.model, drag.primary).filter((n) => keptRef.current.has(n)) : []
          const fine = Math.max(1, 2 / viewport.zoom)
          // The gesture's animation begins at the playhead, from what the thing shows there, and ends with the gesture (D412).
          if (recordShown(drag.primary, v, { base: drag.base.get(drag.primary), fine, carried: drag.carried, batch: true })) drag.created = true
          // What the drag pushes is recorded too, each thing from where it is first moved to where it is last.
          if (drag.movers)
            for (const o of drag.movers.obstacles) {
              const pushedTo = Math.abs(o.shift.x) > 1e-9 || Math.abs(o.shift.y) > 1e-9 ? values.get(o.name) : undefined
              if (pushedTo) recordShown(o.name, pushedTo, { base: drag.base.get(o.name), fine, pushed: true, batch: true })
            }
          // Everything the step asks is written in one edit, once a frame.
          flushRecordedSoon()
        } else if (drag.kind === 'timed') {
          // While an animation is being edited, a new one of another kind takes its span (D157).
          const pinNow = gestureRef.current?.editing ? 'start' : useStore.getState().pin
          const v = values.get(drag.primary)
          if (!v) return
          if (!drag.created) {
            const end = beginTimed(drag.primary, Object.keys(v), pinNow, restoreTime, proposed)
            if (end === null) return
            drag.created = true
            // In Chain mode the next animation starts where this one ends (D127).
            if (gestureRef.current && !gestureRef.current.editing && pinNow === 'start' && useStore.getState().chain) gestureRef.current.from = end
            if (pinNow === 'start' && !drag.shown) {
              drag.shown = true
              useStore.getState().setTime(end)
            }
          }
          const index = lastActionIndex(drag.primary)
          if (index === null) return
          // The target is what shows; the action's values follow through the solver, so a member of a turned group lands where it is dragged (D122).
          setActionDestination(drag.primary, index, v)
          writePushed(index)
        } else if (drag.kind === 'destination') {
          const v = values.get(drag.primary)
          if (v) setActionDestination(drag.primary, drag.actionIndex, changed(drag.primary, v))
          writePushed(drag.actionIndex)
        } else {
          // A group's own turn or scale keeps the center of its box where it shows: the solver moves the group's shift only when its stored pivot no longer sits there (D124).
          const keepCenter: Record<string, number> = drag.group && drag.op !== 'move' ? { x: primaryBase['x']!, y: primaryBase['y']! } : {}
          setAttrsAtMany(
            [...values].map(([name, attrs]) => {
              const c = changed(name, attrs)
              // A place is one thing (D356): where a move's change is written is decided for x and y together, whichever has moved. Decided one axis at a time, the first step of a drag after an animation on the other axis alone went to the declaration and the rest to the new animation (D328). Only what has changed is written.
              const together = drag.custom ? drag.together : drag.op === 'move' && ('x' in c || 'y' in c || 'z' in c) ? (drag.lifted?.depth ? ['x', 'y', 'z'] : ['x', 'y']) : undefined
              return { name, attrs: Object.keys(c).length > 0 ? { ...keepCenter, ...c } : c, together }
            }),
            useStore.getState().time,
          )
        }
      },
      (ev) => {
        const s = useStore.getState()
        if (!drag.moved && drag.click === 'object') s.select([drag.primary])
        dragRef.current = null
        setDragging(null)
        renderer.clearGuides()
        paintRef.current()
        // A move written for something pushed and then let go of again says nothing: it goes.
        const idle = [...drag.pushedActions].filter(([name]) => {
          const shift = drag.pushedShifts.get(name)
          return !shift || (Math.abs(shift.x) < 1e-9 && Math.abs(shift.y) < 1e-9)
        })
        if (idle.length > 0) deleteActions(idle.map(([object, index]) => ({ object, index })), true)
        // A gesture being recorded is written out as it ends (D412).
        endGesture()
        // A drag with the right button has moved the camera: the menu its release would open stays shut. A press let go of where it began does what it was for.
        if (drag.moved && e.button === 2) menuShutRef.current = true
        if (!drag.moved) drag.onClick?.()
        if (gestureRef.current && !animateHeld(ev)) {
          // Shift already released: the gesture is over, the playhead goes back, or rests at the end of the chain.
          s.setTime(restingTime(gestureRef.current))
          gestureRef.current = null
        } else if (gestureRef.current && !gestureRef.current.editing && drag.created && s.chain && s.pin === 'start') {
          // Chain mode, Shift still held: look ahead to the end of the next animation (D127).
          s.setTime(gestureRef.current.from + gestureRef.current.duration)
        }
      },
    )
  }

  /** Double-click a Text to edit its words where they are (D270): a box over the text, Enter a line break, Escape giving up, Ctrl + Enter or a click away keeping it. */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (useStore.getState().tool !== 'select') return
    const located = locate(e.currentTarget, e.clientX, e.clientY)
    if (!located?.hit) return
    beginTextEdit(located.hit, located.viewport)
  }

  const beginTextEdit = (name: string, viewport: Surface) => {
    const renderer = rendererRef.current
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === name)
    if (!renderer || !s.model || !obj?.decl || obj.className !== 'Text' || !canEdit()) return
    const f = renderer.frameOf(name)
    if (!f) return
    const plane = planeOfFrame(f)
    const style = textStyleAt(s.model, obj, s.time)
    // The editor's lines sit where the drawn ones are (D270): the block with its padding around the lines, each line
    // as tall as the layout's step, and the first baseline where the canvas puts it, which is the step's half-leading
    // above the padding. The drawn text is hidden while the editor shows the words.
    const pose = worldPose(s.model, obj, s.time)
    const layout = layoutOf(style)
    const pad = textPadding(style)
    const k = pose.scale * viewport.zoomOn(pose.x, pose.y, plane)
    const at = viewport.toPane(pose.x, pose.y, plane)
    const step = style.fontSize * style.lineHeight
    const lead = (step - layout.ascent - layout.descent) / 2
    const above = Math.max(0, lead - pad)
    const width = (layout.width + 2 * pad) * k
    const height = (layout.height + 2 * pad) * k
    const fill = valueAt(s.model, obj, 'fill', s.time)
    s.select([name])
    renderer.setEditing(name)
    paintRef.current()
    setTextEdit({ name, original: style.text, value: style.text, left: at.x - width / 2, top: at.y - height / 2 - above * k, width: Math.max(40, width), height: Math.max(20, height + above * k), style, zoom: k, padding: pad * k, paddingTop: Math.max(0, pad - lead) * k, lineHeight: step * k, color: typeof fill === 'string' ? fill : '#ffffff' })
  }

  const endTextEdit = (keep: boolean) => {
    const edit = textEditRef.current
    if (!edit) return
    setTextEdit(null)
    rendererRef.current?.setEditing(null)
    paintRef.current()
    if (keep && edit.value !== edit.original) setObjectProp(edit.name, 'text', edit.value)
  }

  /** After an animation made with Shift by a click or a stroke (D103, D127, D310): the playhead shows its end, or in Chain mode the end of the one that would follow it. */
  const madeWithShift = (end: number, pinNow: 'start' | 'end') => {
    const s = useStore.getState()
    const gesture = gestureRef.current
    if (!gesture || pinNow !== 'start') return
    if (!gesture.editing && s.chain) {
      gesture.from = end
      s.setTime(end + gesture.duration)
    } else s.setTime(end)
  }

  /**
   * A sketch with the pencil (D297, D305, D320): the trail is kept while the pointer is down,
   * and the playhead stays where it is. The trail becomes a line, over an object as over empty
   * space, written on as any Shift-made animation when Shift is held (D103, D298). A press let go
   * of where it began is a dot (D311). The pencil never draws an object's path: that is the Path
   * tool's. While a recording runs the playhead runs under the stroke: the line begins where the
   * stroke began and is written on over the time it took, at the pace it was drawn (D412).
   */
  const beginSketch = (host: HTMLDivElement, e: ReactPointerEvent<Element>, world0: Point, paneX: number, paneY: number) => {
    const viewport = surfaceOf()
    if (!viewport) return
    const trailWorld: Point[] = [world0]
    const trail: Point[] = [{ x: paneX, y: paneY }]
    const withShift = animateHeld(e)
    // A stroke drawn while a recording runs: the playhead's time at each place of it. A recording that waited for its first action runs from here.
    const recorded = useStore.getState().recording
    if (recorded) useStore.getState().runRecording()
    const times: number[] = [useStore.getState().time]
    setSketch([...trail])
    setSketchInk(viewport.zoom)
    capture(
      host,
      e.pointerId,
      (ev) => {
        const bounds = host.getBoundingClientRect()
        const px = ev.clientX - bounds.left
        const py = ev.clientY - bounds.top
        trailWorld.push(viewport.toWorld(px, py))
        trail.push({ x: px, y: py })
        times.push(useStore.getState().time)
        setSketch([...trail])
      },
      () => {
        setSketch(null)
        setSketchInk(false)
        const s = useStore.getState()
        const gesture = gestureRef.current
        const pinNow = gesture?.editing ? 'start' : s.pin
        const from = gesture?.from ?? s.time
        const length = gesture?.duration ?? 1
        const moved = trail.some((p) => Math.hypot(p.x - trail[0]!.x, p.y - trail[0]!.y) >= 3)
        const st = styleRef.current
        if (recorded) {
          beginGesture()
          try {
            const drawn = sketchLine(moved ? trailWorld : [world0], st.stroke, st.strokeWidth, st.strokeOpacity, times[0]!)
            if (drawn && moved) recordWriteOn(drawn, trailWorld, times)
          } finally {
            endGesture()
          }
          paintRef.current()
          return
        }
        const name = sketchLine(moved ? trailWorld : [world0], st.stroke, st.strokeWidth, st.strokeOpacity, s.time)
        const end = name && withShift ? writeOnLine(name, pinNow, from, length) : null
        if (end !== null) madeWithShift(end, pinNow)
        paintRef.current()
      },
    )
  }

  /** The Shape tool's style, or the selected Shape's own in Edit (D304): what the bar shows and writes. */
  const editedShape = tool === 'shape' && shapeMode === 'edit' && selection.length === 1 ? model?.objects.find((o) => o.name === selection[0] && o.className === SHAPE && o.decl) : undefined
  const shapeShown = editedShape && model ? { fill: String(valueAt(model, editedShape, 'fill', time)), filled: String(valueAt(model, editedShape, 'fill', time)) !== 'none', stroke: String(valueAt(model, editedShape, 'stroke', time)), strokeWidth: Number(valueAt(model, editedShape, 'strokeWidth', time)) || 0, fillOpacity: Number(valueAt(model, editedShape, 'fillOpacity', time)), strokeOpacity: Number(valueAt(model, editedShape, 'strokeOpacity', time)) } : style
  const writeShapeStyle = (part: Partial<typeof style>) => {
    if (!editedShape) {
      setShapeStyle(part)
      return
    }
    beginGesture()
    try {
      if (part.filled !== undefined) setObjectProp(editedShape.name, 'fill', part.filled ? style.fill : 'none')
      if (part.fill !== undefined) setObjectProp(editedShape.name, 'fill', part.fill)
      if (part.stroke !== undefined) setObjectProp(editedShape.name, 'stroke', part.stroke)
      if (part.strokeWidth !== undefined) setObjectProp(editedShape.name, 'strokeWidth', part.strokeWidth > 0 ? part.strokeWidth : null)
      if (part.fillOpacity !== undefined) setObjectProp(editedShape.name, 'fillOpacity', part.fillOpacity < 1 ? part.fillOpacity : null)
      if (part.strokeOpacity !== undefined) setObjectProp(editedShape.name, 'strokeOpacity', part.strokeOpacity < 1 ? part.strokeOpacity : null)
    } finally {
      endGesture()
    }
  }

  /** The Texts among the selection, with their looks at the playhead, for the text bar (D270). */  /** The Texts among the selection, with their looks at the playhead, for the text bar (D270). */
  const selectedTexts = useMemo(() => {
    if (!model || tool !== 'select') return []
    return model.objects.filter((o) => o.className === 'Text' && o.decl && selection.includes(o.name)).map((o) => ({ name: o.name, style: textStyleAt(model, o, time) }))
  }, [model, selection, tool, time])
  useEffect(() => {
    if (selectedTexts.length > 0) askSystemFonts()
  }, [selectedTexts.length])
  const families = useMemo(() => [...new Set([...fonts, ...systemFonts])], [fonts, systemFonts])
  /** Write one attribute of the look to every selected Text, a default taking the line away (D228). */
  const writeTexts = (key: keyof TextStyle, value: AttrValue) => {
    const fallback = attrSchema('Text', key)?.default
    beginGesture()
    try {
      for (const t of selectedTexts) setObjectProp(t.name, key, value === fallback ? null : value)
    } finally {
      endGesture()
    }
  }
  const textSame = <K extends keyof TextStyle>(key: K): TextStyle[K] | null => (selectedTexts.length > 0 && selectedTexts.every((t) => t.style[key] === selectedTexts[0]!.style[key]) ? selectedTexts[0]!.style[key] : null)

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Only the scene has menus (D308): a right-click on a button, a field, or a bar of the pane does nothing.
    if (e.target !== e.currentTarget && e.target !== canvasRef.current && e.target !== cameraCanvasRef.current && e.target !== cameraPanelRef.current) {
      e.preventDefault()
      return
    }
    // A drag with the right button moved a view or a camera (D428): it opens no menu.
    if (menuShutRef.current) {
      menuShutRef.current = false
      e.preventDefault()
      return
    }
    const located = locate(e.currentTarget, e.clientX, e.clientY)
    if (!located) {
      e.preventDefault()
      return
    }
    const { world, hit } = located
    // What is added goes on the scene's own plane, under the pointer (D434).
    const flat = onFlat(located.viewport, located.paneX, located.paneY)
    // The selected path's points and line (D194): delete the point under the pointer, or add one on the line there, or after the last one.
    const shown = pathRef.current
    const pathAction = useStore.getState().selectedActions.length === 1 ? useStore.getState().selectedActions[0]! : null
    const st = useStore.getState()
    const inPathTool = st.tool === 'path'
    const pixel = 1 / located.viewport.zoom
    // A shown path that is not the selected one (D209): the Path tool can pick it or hide it for now.
    for (const other of inPathTool ? (shown?.others ?? []) : []) {
      if (nearestPoint(other.frame.anchors, world, 8 * pixel) === null && nearestSegment(other.frame.curve, world, 6 * pixel) === null) continue
      showMenu(e, [
        { label: 'Edit path', run: () => st.selectAction(other.ref.object, other.ref.index) },
        { label: 'Hide path', run: () => st.setPathHidden(`${other.ref.object}:${other.ref.index}`, true) },
      ])
      return
    }
    if (shown?.primary?.editable && pathAction) {
      const primary = shown.primary
      const { anchors, curve } = primary.frame
      // The whole path, a point of it, or a segment, with one vocabulary (D252): Smooth, Corner, Straighten, Curve.
      const curveItems: MenuItems = [{ label: 'Smooth path', run: () => smoothPath(pathAction) }, { label: 'Straighten path', run: () => straightenPath(pathAction) }]
      const hideItems: MenuItems = inPathTool ? [{ label: 'Hide path', run: () => st.setPathHidden(`${pathAction.object}:${pathAction.index}`, true) }] : []
      // The whole path's items sit one level down (D256).
      const pathSub: MenuItems = [{ label: 'Path', children: [...curveItems, ...hideItems] }]
      const point = nearestPoint(anchors, world, 8 * pixel)
      if (point !== null && anchors.length > 1) {
        const picked = st.pathPoints.includes(point) && st.pathPoints.length > 1 ? st.pathPoints : [point]
        const kindItems = pointItems(pathAnchorKind(pathAction, point), pathAnchorCurved(pathAction, point), (kind) => setPathAnchorKind(pathAction, picked, kind))
        showMenu(e, [...kindItems, ...pathSub, { label: picked.length > 1 ? `Delete ${picked.length} points` : 'Delete point', run: () => removePathPoints(pathAction, picked), danger: true }])
        return
      }
      const segment = point === null ? nearestSegment(curve, world, 6 * pixel) : null
      if (segment !== null) {
        const insert = pathInsertionAt(primary.frame, segment, world)
        // On a points path the segment is the one ending at the point an insertion would take the place of.
        const seg = insert.kind === 'curves' ? insert.seg : insert.at
        const segItems = segmentItems(pathSegmentKind(pathAction, seg), (kind) => setPathSegment(pathAction, seg, kind))
        showMenu(e, [{ label: 'Add point', run: () => (insert.kind === 'points' ? insertPathPoints(pathAction, insert.at, [world]) : void insertPathAnchor(pathAction, insert.seg, insert.t)) }, ...segItems, ...pathSub])
        return
      }
      if (!hit) {
        showMenu(e, [
          { label: 'Add point', run: () => insertPathPoints(pathAction, anchors.length, [world]) },
          ...pathSub,
          { label: 'Add', children: [...OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, flat.x, flat.y) })), { label: 'Camera', run: () => void addCamera(undefined, flat) }] },
        ])
        return
      }
    }
    // A selected Shape's points and line (D233): delete the point under the pointer, or add one on the line there.
    const shape = shapeRef.current
    if (shape?.editable) {
      // In the middle of a morph, the menu's items shape a morph written from its start to the playhead (D263); the points picked are kept through the writing.
      const pathPoints = st.pathPoints
      settleMorph(shape.name)
      const point = nearestPoint(shape.frame.anchors, world, 8 * pixel)
      if (point !== null) {
        const picked = pathPoints.includes(point) && pathPoints.length > 1 ? pathPoints : [point]
        // Smooth, Corner, or Straighten the point (D252), on curves and on points alike.
        const kindItems = pointItems(shapeAnchorKind(shape.name, point), shapeAnchorCurved(shape.name, point), (kind) => setShapeAnchorKind(shape.name, picked, kind))
        // A line closes or opens from a point too (D306); one being drawn closes as the first point would.
        const drafting = shapeDraftRef.current === shape.name
        const closedNow = isShapeClosed(shape.name)
        const lineItems = drafting ? [{ label: 'Close shape', run: () => endShapeDraft(true) }] : st.model?.objects.find((o) => o.name === shape.name)?.attrs['fill'] === 'none' ? [{ label: closedNow ? 'Open line' : 'Close line', run: () => setShapeClosed(shape.name, !closedNow) }] : []
        showMenu(e, [...kindItems, ...lineItems, { label: picked.length > 1 ? `Delete ${picked.length} points` : 'Delete point', run: () => removeShapePoints(shape.name, picked), danger: true }])
        return
      }
      const insert = insertionAt(shape, world, 6 * pixel)
      if (insert) {
        // On a points shape the segment is the one ending at the point an insertion would take the place of; the whole shape's items sit one level down (D256).
        const seg = insert.kind === 'curves' ? insert.seg : insert.at
        const segItems = segmentItems(shapeSegmentKind(shape.name, seg), (kind) => setShapeSegment(shape.name, seg, kind))
        showMenu(e, [{ label: 'Add point', run: () => (insert.kind === 'points' ? insertShapePoints(shape.name, insert.at, [world]) : void insertShapeAnchor(shape.name, insert.seg, insert.t)) }, ...segItems, { label: 'Shape', children: shapeItems(shape.name) }])
        return
      }
    }
    // A camera (D361, D373): with Select by its frame's line, with the Camera tool by all of its frame; what can be done to it from here.
    const cameraHit = located.viewport === viewportRef.current && (st.tool === 'select' || st.tool === 'camera') ? cameraUnder(located, st.tool === 'camera', st.selection) : null
    if (cameraHit) {
      if (!st.selection.includes(cameraHit)) st.select([cameraHit])
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(cameraHit) },
        { label: 'Rename', run: () => requestRename({ object: cameraHit }) },
        ...cutHereItems(cameraHit),
        { label: 'Duplicate', run: () => duplicateObjects([cameraHit]) },
        { label: 'Delete', run: () => deleteObjects([cameraHit]), danger: true },
      ])
      return
    }
    // The Camera tool is about cameras alone (D373): over anything else its menu is the empty space's.
    if (hit && st.tool !== 'camera') {
      const s = useStore.getState()
      const group = s.model ? groupOf(s.model, s.selection) : null
      if (group && s.model && groupMembers(s.model, group.name).includes(hit)) {
        showMenu(e, [
          { label: 'Jump to code', run: () => jumpToObject(group.name) },
          { label: 'Rename', run: () => requestRename({ object: group.name }) },
          { label: 'Save preset', run: () => requestSavePreset({ object: group.name }) },
          ...(maskMenuItems([group.name]).length > 0 ? [{ label: 'Mask', children: maskMenuItems([group.name]) }] : []),
          ...hideMenuItems([group.name]),
          { label: 'Select', keyword: hit, run: () => s.select([hit]) },
          { label: 'Ungroup', keyword: group.name, run: () => ungroup(group.name) },
        ])
        return
      }
      const targets = s.selection.includes(hit) ? s.selection : [hit]
      if (!s.selection.includes(hit)) s.select([hit])
      const many = targets.length > 1
      // The shape's and the path's items each sit one level down (D256), and so does what the thing is set to be (D379): its classes, its links, whether it is attached to the camera, and how it takes a push.
      const shapeSub = many ? [] : shapeItems(hit)
      const pathSub: MenuItems = [
        ...(many ? [] : pathItems(hit)),
        ...(s.hiddenPaths.some((k) => k.startsWith(`${hit}:`)) ? [{ label: 'Show paths', run: () => s.hiddenPaths.filter((k) => k.startsWith(`${hit}:`)).forEach((k) => s.setPathHidden(k, false)) }] : []),
      ]
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(hit) },
        ...(many ? [] : [{ label: 'Rename', run: () => requestRename({ object: hit }) }]),
        ...(shapeSub.length > 0 ? [{ label: 'Shape', children: shapeSub }] : []),
        ...(pathSub.length > 0 ? [{ label: 'Path', children: pathSub }] : []),
        ...(many ? [] : [{ label: 'Save preset', run: () => requestSavePreset({ object: hit }) }]),
        // The mask items sit one level down, as the shape's and the path's do (D256, D333).
        ...(maskMenuItems(targets).length > 0 ? [{ label: 'Mask', children: maskMenuItems(targets) }] : []),
        // Hidden, a thing is out of the way in the view alone (D341); the panes bring it back.
        ...hideMenuItems(targets),
        ...propertiesMenu(targets, [
          {
            label: targets.every((n) => s.anchored.includes(n)) ? 'Unanchor' : 'Anchor',
            run: () => {
              const anchored = !targets.every((n) => s.anchored.includes(n))
              for (const n of targets) s.setAnchored(n, anchored)
            },
          },
          {
            label: targets.every((n) => s.soft.includes(n)) ? 'Disable passthrough' : 'Enable passthrough',
            run: () => {
              const soft = !targets.every((n) => s.soft.includes(n))
              for (const n of targets) s.setSoft(n, soft)
            },
          },
        ]),
        { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
        { label: many ? `Delete ${targets.length} objects` : 'Delete', run: () => deleteObjects(targets), danger: true },
      ])
    } else {
      showMenu(e, [{ label: 'Add', children: [...OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, flat.x, flat.y) })), { label: 'Camera', run: () => void addCamera(undefined, flat) }] }])
    }
  }

  // Scrollbars: the view's place within a stable area, the frame with a frame's width around
  // it, grown only by what objects occupy. Scrolling never changes the area (D82).
  const viewport = viewportRef.current
  const view = viewport?.sized ? viewport.viewRect() : null
  let scroll: { x: [number, number]; y: [number, number] } | null = null
  if (viewport && view) {
    // The frame is where the camera that has the picture puts it (D367).
    const frame = viewport.frameRect()
    const frameWidth = frame.right - frame.left
    const frameHeight = frame.top - frame.bottom
    const content = rendererRef.current?.bounds()
    const left = Math.min(frame.left - frameWidth, (content?.left ?? frame.left) - frameWidth * 0.1)
    const right = Math.max(frame.right + frameWidth, (content?.right ?? frame.right) + frameWidth * 0.1)
    const top = Math.max(frame.top + frameHeight, (content?.top ?? frame.top) + frameHeight * 0.1)
    const bottom = Math.min(frame.bottom - frameHeight, (content?.bottom ?? frame.bottom) - frameHeight * 0.1)
    scroll = { x: [left, right], y: [-top, -bottom] }
  }
  const stop = (e: ReactPointerEvent) => e.stopPropagation()
  /** The cameras, by name, each with a name to wear at its frame in the Preview view (D361). */
  const cameraNames = useMemo(() => (model ? model.objects.filter((o) => o.className === CAMERA).map((o) => o.name) : []), [model])
  /** The line between the two views, dragged (D359): the share of the pane the Preview view takes. */
  const beginSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const host = hostRef.current
    if (!host) return
    const bounds = host.getBoundingClientRect()
    capture(e.currentTarget, e.pointerId, (ev) => useStore.getState().setPreviewSplit((ev.clientX - bounds.left) / Math.max(1, bounds.width)), () => undefined)
  }
  const selectedGroup = model ? groupOf(model, selection) : null
  // A path whose points are written out offers the Draw tool (D194); one whose shape is code says so instead (D226).
  const selectedIsPath = selectedActions.length === 1 && !!model && model.objects.find((o) => o.name === selectedActions[0]!.object)?.actions[selectedActions[0]!.index]?.verb === 'path'
  const pathSelected = selectedIsPath && pathEditable(selectedActions[0]!)
  const codePathSelected = selectedIsPath && !pathSelected
  /** The one thing selected has a path, which the Path tool shows with its points (D411). */
  const selectedHasPath = selection.length === 1 && selectedActions.length === 0 && !!model?.objects.find((o) => o.name === selection[0])?.actions.some((a) => a.verb === 'path' && !a.overridden)

  return (
    <div
      className={`preview${tool === 'object' ? ' placing' : tool === 'paint' ? (dropping ? ' dropping' : ' painting') : tool === 'pencil' ? ' sketching' : tool === 'path' || tool === 'shape' ? ' drawing' : ''} mode-${transformMode} view-${previewView} tool-${tool}`}
      ref={hostRef}
      style={{ '--preview-split': `${previewSplit * 100}%` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={() => (hoverRef.current = true)}
      onPointerLeave={() => (hoverRef.current = false)}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <div className="preview-world" ref={worldRef} style={previewView === 'both' ? { width: `${previewSplit * 100}%` } : undefined}>
        <canvas ref={canvasRef} />
        <div className="preview-cameras" ref={tagsRef}>
          {cameraNames.map((name) => (
            <div
              key={name}
              className="camera-tag"
              data-camera={name}
              title={`Camera ${name}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                press(e, { camera: name })
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <KindIcon kind="Camera" />
              {name}
            </div>
          ))}
        </div>
        <span className="view-tag">Preview</span>
        {/* The view's corner (D428, D435, D436): its compass, which shows the side it looks from, turns it, and looks along an axis; and under it, standing where the camera stands. */}
        <div className="view-corner" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
          <Compass ref={worldCompassRef} title="Turn the view" onPress={pressViewCompass} />
          <div className="view-corner-buttons">
            <button onClick={viewFromCamera} title="View from the camera" aria-label="View from the camera">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="2.5" y="7" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M15.5 10.5l6-3v9l-6-3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {/* The bars are the view's from the front: turned, it has no left and top of the scene to scroll to. */}
        {scroll && view && viewport && viewport.straight && (
          <>
            <ScrollBar axis="x" rangeStart={scroll.x[0]} rangeEnd={scroll.x[1]} windowStart={view.left} windowEnd={view.right} onScroll={(start) => viewport.scrollTo({ left: start })} />
            <ScrollBar axis="y" rangeStart={scroll.y[0]} rangeEnd={scroll.y[1]} windowStart={-view.top} windowEnd={-view.bottom} onScroll={(start) => viewport.scrollTo({ top: -start })} />
          </>
        )}
      </div>
      <div className="preview-divider" style={{ left: `${previewSplit * 100}%` }} onPointerDown={beginSplitDrag} onDoubleClick={(e) => e.stopPropagation()} title="Drag to resize the views" />
      <div
        className="preview-camera"
        ref={cameraPanelRef}
        style={previewView === 'both' ? { left: `${previewSplit * 100}%` } : undefined}
        onPointerDown={(e) => {
          e.stopPropagation()
          press(e, { view: 'camera' })
        }}
      >
        <canvas ref={cameraCanvasRef} />
        <span className="view-tag">
          Camera <b ref={cameraNameRef} />
        </span>
        {/* The camera's corner (D428, D435, D436): its compass, which shows the way it looks, turns it on the spot, and faces it along an axis; and under it, back to where a camera is unless told, and to where the Preview view looks from. */}
        <div className="view-corner" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
          <Compass
            ref={cameraCompassRef}
            title="Turn the camera"
            onPress={(e, axis) => {
              if (e.button === 0) press(e, { view: 'camera', move: 'turn', axis })
            }}
          />
          <div className="view-corner-buttons">
            <button onClick={(e) => cameraHome(animateHeld(e))} title="Reset the camera" aria-label="Reset the camera">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M3 11.5l9-8 9 8M5.5 10v10h4.5v-6h4v6h4.5V10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </button>
            <button onClick={(e) => cameraFromView(animateHeld(e))} title="Camera to the Preview's view" aria-label="Camera to the Preview's view">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {textEdit && (
        <textarea
          className="preview-text-edit"
          autoFocus
          spellCheck={false}
          style={{ left: textEdit.left, top: textEdit.top, width: textEdit.width, height: textEdit.height, padding: `${textEdit.paddingTop}px ${textEdit.padding}px 0`, fontFamily: `"${textEdit.style.font}", "Segoe UI", sans-serif`, fontSize: textEdit.style.fontSize * textEdit.zoom, fontWeight: textEdit.style.weight, fontStyle: textEdit.style.italic ? 'italic' : 'normal', textAlign: textEdit.style.align, lineHeight: `${textEdit.lineHeight}px`, letterSpacing: textEdit.style.letterSpacing * textEdit.zoom, color: textEdit.color }}
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onPointerDown={stop}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') endTextEdit(false)
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) endTextEdit(true)
          }}
          onBlur={() => endTextEdit(true)}
        />
      )}
      {notice && <div className="preview-notice">{notice}</div>}
      {marquee && (
        <div className="preview-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
      )}
      {sketch && sketch.length > 0 && (
        <svg className="preview-sketch">
          <polyline points={(sketch.length > 1 ? sketch : [sketch[0]!, sketch[0]!]).map((p) => `${p.x},${p.y}`).join(' ')} style={sketchInk ? { stroke: style.stroke, strokeWidth: Math.max(1, style.strokeWidth * sketchInk), strokeOpacity: style.strokeOpacity } : undefined} />
        </svg>
      )}
      <div className="preview-palette" onPointerDown={stop} role="group" aria-label="Tool">
        <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select" aria-pressed={tool === 'select'} aria-label="Select">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 3l12 10h-6l3.5 7-2.5 1.2-3.5-7L6 18z" fill="currentColor" />
          </svg>
        </button>
        <button className={tool === 'object' ? 'active' : ''} onClick={() => setTool(tool === 'object' ? 'select' : 'object')} title="Object" aria-pressed={tool === 'object'} aria-label="Object">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="3" y="4" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="9" cy="16.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M18 9v8M14 13h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={tool === 'path' ? 'active' : ''}
          onClick={() => setTool(tool === 'path' ? 'select' : 'path')}
          title="Path"
          aria-pressed={tool === 'path'}
          aria-label="Path"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 18c3-10 7-10 10-5s5 5 7-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="4" cy="18" r="2" fill="currentColor" />
            <circle cx="21" cy="9" r="2" fill="currentColor" />
          </svg>
        </button>
        <button className={tool === 'shape' ? 'active' : ''} onClick={() => setTool(tool === 'shape' ? 'select' : 'shape')} title="Shape" aria-pressed={tool === 'shape'} aria-label="Shape">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 3l9 7-3.5 10h-11L3 10z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="3" r="2" fill="currentColor" />
            <circle cx="21" cy="10" r="2" fill="currentColor" />
            <circle cx="3" cy="10" r="2" fill="currentColor" />
          </svg>
        </button>
        <button className={tool === 'pencil' ? 'active' : ''} onClick={() => setTool(tool === 'pencil' ? 'select' : 'pencil')} title="Pencil" aria-pressed={tool === 'pencil'} aria-label="Pencil">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 20l2-5L17 4l3 3L9 18z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M14 7l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
        <button className={tool === 'paint' ? 'active' : ''} onClick={() => setTool(tool === 'paint' ? 'select' : 'paint')} title="Paint" aria-pressed={tool === 'paint'} aria-label="Paint">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 11l7-7 8 8-7 7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M3 12h13" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M19.5 14.5c1.2 1.6 1.8 2.8 1.8 3.7a1.8 1.8 0 0 1-3.6 0c0-.9.6-2.1 1.8-3.7z" fill="currentColor" />
          </svg>
        </button>
        <button className={tool === 'camera' ? 'active' : ''} onClick={() => setTool(tool === 'camera' ? 'select' : 'camera')} title="Camera" aria-pressed={tool === 'camera'} aria-label="Camera">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="2.5" y="7" width="13" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M15.5 10.5l6-3v9l-6-3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="preview-top">
      <div className="preview-toolbar" onPointerDown={stop}>
        {tool === 'object' && (
          <div className="preview-modes" role="group" aria-label="Kind of object to add">
            {OBJECT_KINDS.filter((k) => k !== SHAPE).map((k) => (
              <button key={k} className={addKind === k && !addPreset ? 'active' : ''} onClick={() => setAddKind(k)} title={`Each click adds a ${k}`} aria-pressed={addKind === k && !addPreset}>
                {k}
              </button>
            ))}
            {userPresets
              .filter((p) => p.kind === 'object' || p.kind === 'group')
              .map((p) => (
                <button key={p.id} className={addPreset === p.id ? 'active' : ''} onClick={() => setAddPreset(p.id)} title={`Each click adds ${p.label}`} aria-pressed={addPreset === p.id}>
                  {p.label}
                </button>
              ))}
          </div>
        )}
        {selectedTexts.length > 0 && (
          <div className="preview-modes text-bar" role="group" aria-label="Text">
            <FontField compact value={textSame('font') ?? ''} options={families} placeholder={selectedTexts.length > 1 ? 'Mixed' : 'Font'} title="Font" onCommit={(f) => writeTexts('font', f)} />
            <NumberField label="Font size" value={Math.round(selectedTexts[0]!.style.fontSize)} unit="px" min={1} step={1} onChange={(v) => setAttrsAtMany(selectedTexts.map((t) => ({ name: t.name, attrs: { fontSize: v } })), useStore.getState().time)} />
            <button className={(textSame('weight') ?? 0) >= 600 ? 'active' : ''} onClick={() => writeTexts('weight', (textSame('weight') ?? 0) >= 600 ? 400 : 700)} title="Bold" aria-pressed={(textSame('weight') ?? 0) >= 600}>
              <b>B</b>
            </button>
            <button className={textSame('italic') ? 'active' : ''} onClick={() => writeTexts('italic', !textSame('italic'))} title="Italic" aria-pressed={!!textSame('italic')}>
              <i>I</i>
            </button>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={textSame('align') === a ? 'active' : ''} onClick={() => writeTexts('align', a)} title={`Align ${a}`} aria-label={`Align ${a}`} aria-pressed={textSame('align') === a}>
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  {[0, 1, 2].map((row) => {
                    const w = row === 1 ? 7 : row === 2 ? 10 : 12
                    const x = a === 'left' ? 1 : a === 'right' ? 13 - w : 7 - w / 2
                    return <rect key={row} x={x} y={2.5 + row * 4} width={w} height={1.6} fill="currentColor" />
                  })}
                </svg>
              </button>
            ))}
          </div>
        )}
        {tool === 'shape' && (
          <div className="preview-modes" role="group" aria-label="Shape tool mode">
            <button className={shapeMode === 'create' ? 'active' : ''} onClick={() => setShapeMode('create')} title="Draw a shape" aria-pressed={shapeMode === 'create'}>
              Create
            </button>
            <button className={shapeMode === 'edit' ? 'active' : ''} onClick={() => setShapeMode('edit')} title="Edit the points" aria-pressed={shapeMode === 'edit'}>
              Edit
            </button>
          </div>
        )}
        {tool === 'shape' && (shapeMode === 'create' || editedShape) && (
          <div className="paint-bar" role="group" aria-label="Shape style">
            <button className={`preview-toggle${shapeShown.filled ? ' on' : ''}`} onClick={() => writeShapeStyle({ filled: !shapeShown.filled })} title="Fill, or a line" aria-pressed={shapeShown.filled}>
              Fill
            </button>
            {/* Each color's opacity is set in its picker (D391). */}
            {shapeShown.filled && <ColorPicker value={shapeShown.fill} onChange={(fill) => writeShapeStyle({ fill })} opacity={shapeShown.fillOpacity} onOpacity={(fillOpacity) => writeShapeStyle({ fillOpacity })} title="Fill" />}
            <ColorPicker value={shapeShown.stroke} onChange={(stroke) => writeShapeStyle({ stroke })} opacity={shapeShown.strokeOpacity} onOpacity={(strokeOpacity) => writeShapeStyle({ strokeOpacity })} title="Outline" />
            <NumberField label="Width" value={shapeShown.strokeWidth} unit="px" min={0} onChange={(strokeWidth) => writeShapeStyle({ strokeWidth })} />
          </div>
        )}
        {tool === 'path' && (
          <div className="preview-modes" role="group" aria-label="Path tool mode">
            <button className={pathMode === 'create' ? 'active' : ''} onClick={() => setPathMode('create')} title="Draw a path" aria-pressed={pathMode === 'create'}>
              Create
            </button>
            <button className={pathMode === 'edit' ? 'active' : ''} onClick={() => setPathMode('edit')} title="Edit the points" aria-pressed={pathMode === 'edit'}>
              Edit
            </button>
            <button className={pathMode === 'move' ? 'active' : ''} onClick={() => setPathMode('move')} title="Move the whole path" aria-pressed={pathMode === 'move'}>
              Move path
            </button>
          </div>
        )}
        {tool === 'paint' && (
          <div className="paint-bar" role="group" aria-label="Paint">
            <div className="preview-modes" role="group" aria-label="Fill or outline">
              <button className={paintMode === 'fill' ? 'active' : ''} onClick={() => setPaintMode('fill')} title="Paint the fill" aria-pressed={paintMode === 'fill'}>
                Fill
              </button>
              <button className={paintMode === 'stroke' ? 'active' : ''} onClick={() => setPaintMode('stroke')} title="Paint the outline" aria-pressed={paintMode === 'stroke'}>
                Stroke
              </button>
            </div>
            <ColorPicker value={paintMode === 'stroke' ? style.stroke : style.fill} onChange={(c) => setShapeStyle(paintMode === 'stroke' ? { stroke: c } : { fill: c })} onDrop={() => setDropping(true)} title="Color" />
            {paintMode === 'stroke' && <NumberField label="Width" value={style.strokeWidth} unit="px" onChange={(strokeWidth) => setShapeStyle({ strokeWidth })} />}
          </div>
        )}
        {tool === 'pencil' && (
          <div className="paint-bar" role="group" aria-label="Pencil">
            <ColorPicker value={style.stroke} onChange={(stroke) => setShapeStyle({ stroke })} opacity={style.strokeOpacity} onOpacity={(strokeOpacity) => setShapeStyle({ strokeOpacity })} title="Line color" />
            <NumberField label="Width" value={style.strokeWidth} unit="px" onChange={(strokeWidth) => setShapeStyle({ strokeWidth })} />
          </div>
        )}
        {tool === 'select' && selection.length > 0 && (
          <>
            <div className="preview-modes" role="group" aria-label="Drag mode">
              {TRANSFORM_MODES.map((m) => (
                <button key={m} className={transformMode === m ? 'active' : ''} onClick={() => setTransformMode(m)} title={sayKey(MODE_TIP[m], animateName)} aria-pressed={transformMode === m}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <button
              className="preview-toggle"
              onClick={() => setAnchor(anchor === 'edge' ? 'center' : 'edge')}
              title="What a resize keeps in place"
            >
              {anchor === 'edge' ? 'Edge' : 'Center'}
            </button>
            {dragging === 'aspect' && <span className="preview-chip">Keeping proportions</span>}
          </>
        )}
      </div>
      {/* The zoom and Fit are the Preview view's: with the Camera view alone they stay, grayed, since that view shows the picture whole and is not zoomed. */}
      <div className="preview-tools" onPointerDown={stop}>
        <button onClick={() => viewportRef.current?.setZoom(1)} title="Actual size" disabled={previewView === 'camera'}>
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => viewportRef.current?.fit()} title="Fit the camera's frame" disabled={previewView === 'camera'}>
          Fit
        </button>
      </div>
      </div>
      <div className="preview-hud">
        <PreviewTime fps={settings.fps} />
        <span className="dim">
          {settings.width} x {settings.height}
        </span>
        {tool === 'object' && <span className="hint">Click to place</span>}
        {tool === 'paint' && <span className="hint">{dropping ? 'Click an object to take its color' : `Click to paint; ${animateName}-click for a color change; Alt-click takes a color`}</span>}
        {tool === 'pencil' && <span className="hint">Click for a dot, drag for a line; {animateName} animates</span>}
        {tool === 'camera' && <span className="hint">Click a camera; {animateName} animates</span>}
        {tool === 'shape' && shapeMode === 'create' && <span className="hint">{drafting ? 'Click for corners, drag to draw; the first point closes and fills, Escape leaves a line' : 'Click to start a shape'}</span>}
        {tool === 'shape' && shapeMode === 'edit' && <span className="hint">{shapeRef.current?.editable ? 'Drag a point, or a box around several; right-click a point or the line for curves and corners' : 'Click a shape, or drag a box around one'}</span>}
        {tool === 'path' && pathMode === 'move' && <span className="hint">Drag a path's line to move it, the handle over its box to turn it</span>}
        {tool === 'path' && pathMode === 'create' && <span className="hint">{(pathSelected || selectedHasPath) && drawingPath ? 'Click for a corner, drag to draw' : pathSelected || selectedHasPath ? 'Click begins a new path; a path\'s last point goes on with it' : codePathSelected ? 'Shape is code: edit it in the code pane' : selection.length === 1 ? 'Click the object, or where the path goes' : 'Click an object, or a path'}</span>}
        {tool === 'path' && pathMode === 'edit' && <span className="hint">{pathSelected || selectedHasPath ? 'Drag a point, or a box around several; click the line for a point' : codePathSelected ? 'Shape is code: edit it in the code pane' : selection.length === 1 ? 'No path here: Create draws one' : 'Click an object, or a path'}</span>}
        {tool === 'select' && codePathSelected && <span className="hint">Shape is code: edit it in the code pane</span>}
        {selectedGroup && model ? (
          <span className="dim">
            {selectedGroup.name}: {groupMembers(model, selectedGroup.name).length} objects
          </span>
        ) : (
          selection.length > 1 && <span className="dim">{selection.length} selected</span>
        )}
      </div>
      {!project && (
        <div className="preview-empty">
          <div className="title">No project open</div>
          {window.api ? (
            <div className="actions">
              <button onClick={() => void pickProject()}>Open project folder</button>
              <button onClick={() => void newProject()}>New project</button>
            </div>
          ) : (
            <div className="dim">Loading the sample</div>
          )}
        </div>
      )}
    </div>
  )
}
