import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { beginGesture, endGesture } from '../code/editor'
import { showMenu } from '../components/ContextMenu'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { groupMembers } from '../model/groups'
import { GROUP } from '../model/registry'
import { pathFrame, pathHolds, positionAt, shownValue, type PathFrame, type Point } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { DEFAULT_EASE_FRACTION, easingFor } from '../model/easing'
import { addObject, addPath, adjustDurations, appendPushedMove, beginTimed, createGroup, deleteActions, deleteObjects, duplicateObjects, inProgressActions, insertPathPoints, jumpToObject, lastActionIndex, overrideClassAction, pathDragTarget, pathEditable, removePathPoints, requestClasses, requestRename, resizeAttrs, resizedValues, setActionDestination, setActionTiming, setAttrsAtMany, setPathPoints, setPathSmooth, ungroup } from '../project/operations'
import { makeMover, outlineOf, resetMover, walk, type Mover, type Pushing } from '../preview/collide'
import { SceneRenderer, type Frame, type GuideLine, type Handle } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { OBJECT_KINDS, TRANSFORM_MODES, useStore, type ActionRef, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const MODE_LABEL: Record<TransformMode, string> = { all: 'Transform', move: 'Move', rotate: 'Rotate', resize: 'Resize' }
const MODE_TIP: Record<TransformMode, string> = {
  all: 'Every handle: drag the body to move, a corner or an edge to resize, the handle above to rotate. Shift makes the drag an animation.',
  move: 'Dragging moves. Shift makes it an animation.',
  rotate: 'Dragging turns the selection around the center of its box. Shift makes it an animation.',
  resize: 'Corners resize both sides, edges resize one; hold Alt to keep the proportions. Shift makes it an animation.',
}
const BASE_ATTRS = ['x', 'y', 'rotation', 'scale', 'width', 'height', 'radius', 'fontSize']

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

/** A drawn line kept as its corners: the points that bend it by more than the tolerance (D194). */
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

interface Drag {
  /** `plain`: edit the values at the playhead. `timed`: Shift, make an action. `destination`: the selected action's end follows. */
  kind: 'plain' | 'timed' | 'destination'
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
  click: 'cycle' | 'object' | 'none'
  /** The values the drag has written so far, as name:attr, so one brought back to its start is still written. */
  touched: Set<string>
  /** The moves written for what this animation's drag has pushed, by object, and how far each was pushed last (D136). */
  pushedActions: Map<string, number>
  pushedShifts: Map<string, { x: number; y: number }>
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
/** The progress at which an easing has come a fraction of the way: its inverse, by bisection, since an easing only climbs. */
function unease(ease: (progress: number) => number, fraction: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ease(mid) < fraction) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

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
 * adds or removes, a drag on empty space selects what it touches, Ctrl extends (D89), and a
 * click on the selected object cycles the mode (D79). The selection shows handles for its mode
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
export function PreviewPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  const [altDown, setAltDown] = useState(false)
  const [dragging, setDragging] = useState<'aspect' | null>(null)
  /** The paths shown right now (D194, D209): the selected one, with its line and anchors and whether its points can be edited, and the others, lines only. */
  const pathRef = useRef<{ primary: { ref: ActionRef; frame: PathFrame; editable: boolean } | null; others: { ref: ActionRef; frame: PathFrame }[] } | null>(null)
  /** A line being drawn for the selected path, in pane pixels, until the pointer is let go (D194). */
  const [sketch, setSketch] = useState<{ x: number; y: number }[] | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const settings = useStore((s) => s.settings)
  const time = useStore((s) => s.time)
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const selectedActions = useStore((s) => s.selectedActions)
  const transformMode = useStore((s) => s.transformMode)
  const previewSnap = useStore((s) => s.previewSnap)
  const collide = useStore((s) => s.collide)
  const push = useStore((s) => s.push)
  const pin = useStore((s) => s.pin)
  const chain = useStore((s) => s.chain)
  const anchor = useStore((s) => s.anchor)
  const setTool = useStore((s) => s.setTool)
  const addKind = useStore((s) => s.addKind)
  const pathMode = useStore((s) => s.pathMode)
  const showPaths = useStore((s) => s.showPaths)
  const setPathMode = useStore((s) => s.setPathMode)
  const toggleShowPaths = useStore((s) => s.toggleShowPaths)
  const setAddKind = useStore((s) => s.setAddKind)
  const setTransformMode = useStore((s) => s.setTransformMode)
  const setPreviewSnap = useStore((s) => s.setPreviewSnap)
  const setCollide = useStore((s) => s.setCollide)
  const setPush = useStore((s) => s.setPush)
  const setPin = useStore((s) => s.setPin)
  const setChain = useStore((s) => s.setChain)
  const setAnchor = useStore((s) => s.setAnchor)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const viewport = new Viewport(canvas)
    const renderer = new SceneRenderer()
    viewport.content.add(renderer.group)
    viewportRef.current = viewport
    rendererRef.current = renderer
    if (import.meta.env.DEV) Object.assign((window as unknown as { __quickAnimator?: object }).__quickAnimator ?? {}, { getRenderer: () => renderer })

    const paint = () => {
      const s = useStore.getState()
      // While Shift looks ahead, whatever was alive where the gesture began stays drawn (D138).
      renderer.update(s.model, s.time, s.selection, s.transformMode, 1 / viewport.zoom, axesRef.current, gestureRef.current?.restore, s.anchored)
      // The selected path, or the first path of the selected object, shows its shape; with the path itself selected and its points written out, each point wears a handle (D192, D194).
      // Which paths show (D205, D209): with the Path tool, every object's, but for those hidden for now; otherwise the selected object's when Paths is on; and the selected path always. The selected path carries the handles.
      const found: { ref: ActionRef; frame: PathFrame; selected: boolean }[] = []
      if (s.model) {
        const ref = s.selectedActions.length === 1 ? s.selectedActions[0] : undefined
        const selectedObject = s.selection.length === 1 ? s.model.objects.find((o) => o.name === s.selection[0]) : undefined
        const inPathTool = s.tool === 'path'
        const sources = inPathTool ? s.model.objects : selectedObject && s.showPaths ? [selectedObject] : ref ? s.model.objects.filter((o) => o.name === ref.object) : []
        for (const o of sources) {
          for (let index = 0; index < o.actions.length; index++) {
            const action = o.actions[index]!
            if (action.verb !== 'path' || action.overridden) continue
            const selected = !!ref && ref.object === o.name && ref.index === index
            if (!selected && (inPathTool ? s.hiddenPaths.includes(`${o.name}:${index}`) : !s.showPaths)) continue
            const frame = pathFrame(s.model, action, s.time)
            if (!frame || frame.curve.length === 0) continue
            found.push({ ref: { object: o.name, index }, frame, selected })
          }
        }
      }
      const lead = found.find((p) => p.selected)
      const primary = lead ? { ref: lead.ref, frame: lead.frame, editable: pathEditable(lead.ref) } : null
      const others = found.filter((p) => !p.selected).map((p) => ({ ref: p.ref, frame: p.frame }))
      pathRef.current = primary || others.length > 0 ? { primary, others } : null
      renderer.setPath(primary ? primary.frame.curve : null, 1 / viewport.zoom, primary?.editable ? primary.frame.anchors : null, s.pathPoints)
      renderer.setOtherPaths(others.map((o) => o.frame.curve), 1 / viewport.zoom)
      viewport.render()
    }
    paintRef.current = paint
    viewport.onChange = () => {
      setZoom(viewport.zoom)
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

    const observer = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect()
      viewport.resize(width, height, window.devicePixelRatio)
    })
    observer.observe(host)

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const bounds = host.getBoundingClientRect()
      const paneX = e.clientX - bounds.left
      const paneY = e.clientY - bounds.top
      if (e.shiftKey) {
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

    // Releasing Shift ends the gesture: the playhead goes back to where it was. Alt held shows
    // that a corner drag keeps the proportions (D113).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false)
      if (e.key !== 'Shift' || !gestureRef.current || dragRef.current) return
      useStore.getState().setTime(restingTime(gestureRef.current))
      gestureRef.current = null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        setAltDown(true)
      }
      // Shift held over the pane, with Starts at playhead: look ahead to the proposed animation's end
      // before anything is dragged, so what is dragged is what is written (D103).
      if (e.key !== 'Shift' || e.repeat || gestureRef.current || dragRef.current) return
      if (e.target instanceof Element && e.target.closest('input, textarea')) return
      const s = useStore.getState()
      // Over the preview, or over the timeline with an animation selected (D180).
      if (!s.model || (!hoverRef.current && !s.hoverTimeline)) return
      // With an animation selected, Shift jumps to its end: what is dragged then is its end state, and nothing new is made (D157).
      const picked = s.selectedActions.find((r) => s.selection.includes(r.object)) ?? s.selectedActions[0]
      const editing = picked ? s.model.objects.find((o) => o.name === picked.object)?.actions[picked.index] : undefined
      if (editing) {
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
      gestureRef.current = { restore: s.time, from: s.time, duration: 1 }
      s.setTime(s.time + 1)
    }
    // Typing in the code pane or a field takes the pointer's say away until it moves over the pane again.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('.cm-editor, input, textarea')) hoverRef.current = false
    }
    const onBlur = () => setAltDown(false)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('focusin', onFocusIn)
      unsubscribe()
      observer.disconnect()
      viewport.dispose()
      viewportRef.current = null
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    viewportRef.current?.setComposition(settings.width, settings.height, settings.background)
  }, [settings.width, settings.height, settings.background])

  /** World position and the object under a pointer position in the pane. */
  const locate = (host: HTMLDivElement, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const renderer = rendererRef.current
    if (!viewport || !renderer) return null
    const bounds = host.getBoundingClientRect()
    // A pane that has never been painted (hidden since load) has not reported its size yet.
    if (!viewport.sized) viewport.resize(bounds.width, bounds.height, window.devicePixelRatio)
    const paneX = clientX - bounds.left
    const paneY = clientY - bounds.top
    return { viewport, renderer, bounds, paneX, paneY, world: viewport.toWorld(paneX, paneY), hit: renderer.pick(viewport.camera, viewport.toNdc(paneX, paneY)) }
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

  /** The line of a path as it stands now, by its reference. */
  const frameOf = (ref: ActionRef): PathFrame | null => {
    const s = useStore.getState()
    const action = s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
    return s.model && action ? pathFrame(s.model, action, s.time) : null
  }

  /**
   * Draw for a path (D194, D199): a stroke from `from` adds the corners of the drawn line after
   * the last anchor and makes the path smooth; a press that does not move adds one corner where
   * it lands when `clickAdds`, else nothing. A path started on an object draws from the object's
   * own place, its first anchor.
   */
  const beginStroke = (host: HTMLDivElement, e: ReactPointerEvent<HTMLDivElement>, ref: ActionRef, from: Point, clickAdds: boolean) => {
    const viewport = viewportRef.current
    if (!viewport) return
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
        if (!moved && !clickAdds) return
        const frame = frameOf(ref)
        const count = frame?.anchors.length ?? 0
        const points = moved ? simplify(samples, 4 / viewport.zoom) : [gridded(from)]
        // A line drawn from the last anchor goes on from it rather than doubling it.
        const last = frame?.anchors[count - 1]
        if (last && points.length > 1 && Math.hypot(points[0]!.x - last.x, points[0]!.y - last.y) < 4 / viewport.zoom) points.shift()
        if (points.length === 0) return
        beginGesture()
        insertPathPoints(ref, count, points)
        // A drawn line is a curve: the path turns smooth, once (D199).
        const action = useStore.getState().model?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
        if (moved && action && action.changes['smooth'] !== true) setPathSmooth(ref, true)
        endGesture()
        useStore.getState().setPathPoints([count + points.length - 1])
      },
    )
  }

  /**
   * Move a whole path with the Path tool (D203): the drag carries every anchor by how far the
   * pointer goes, as one undo step; a press that does not move puts a point at `insertAt`
   * instead, when there is one.
   */
  const beginPathMove = (host: HTMLDivElement, e: ReactPointerEvent<HTMLDivElement>, ref: ActionRef, world: Point, insertAt: number | null) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const bounds = host.getBoundingClientRect()
    const starts = frameOf(ref)?.anchors ?? []
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
        setPathPoints(ref, starts.map((p, index) => ({ index, world: gridded({ x: p.x + dx, y: p.y + dy }) })))
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
   * Edit a path's points (D194, D197, D198): drag the anchor `point`, with every other picked
   * anchor when it is one of them; or put a new anchor in at `insertAt`, where the pointer is,
   * and drag it. A drag moves by how far the pointer goes, so an object dragged by its body
   * carries its anchor along, and it is one undo step. With `toggle`, a click adds the anchor to
   * the picked ones or takes it out, and nothing moves.
   */
  const beginPathEdit = (host: HTMLDivElement, e: ReactPointerEvent<HTMLDivElement>, ref: ActionRef, world: Point, point: number | null, insertAt: number | null, toggle: boolean) => {
    const viewport = viewportRef.current
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
    } else if (insertAt !== null) {
      // A click on the line between two anchors puts a new anchor there, which the drag then carries.
      beginGesture()
      insertPathPoints(ref, insertAt, [gridded(world)])
      indices = [insertAt]
    } else return
    useStore.getState().setPathPoints(indices)
    const frame0 = frameOf(ref)
    const starts = indices.map((i) => frame0?.anchors[i] ?? world)
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
        setPathPoints(ref, indices.map((index, k) => ({ index, world: gridded({ x: starts[k]!.x + dx, y: starts[k]!.y + dy }) })))
      },
      () => endGesture(),
    )
  }

  /** Edit path for each path an object has, and Add path (D194). */
  const pathItems = (name: string): MenuItems => {
    const s = useStore.getState()
    const obj = s.model?.objects.find((o) => o.name === name)
    const paths = obj ? obj.actions.map((a, index) => ({ a, index })).filter(({ a }) => a.verb === 'path' && !a.classAction && !a.overridden) : []
    // Like a click on its clip: the path is selected and the playhead at its start, where its handles can be dragged (D157).
    const edit = (index: number) => {
      const fresh = useStore.getState()
      const action = fresh.model?.objects.find((o) => o.name === name)?.actions[index]
      fresh.selectAction(name, index)
      if (action) fresh.setTime(action.start)
      fresh.setTool('select')
    }
    const items: MenuItems = []
    if (paths.length === 1) items.push({ label: 'Edit path', run: () => edit(paths[0]!.index) })
    else if (paths.length > 1) items.push({ label: 'Edit path', children: paths.map(({ a, index }) => ({ label: `at ${formatTime(a.start, s.settings.fps)}`, run: () => edit(index) })) })
    items.push({
      label: 'Add path',
      run: () => {
        // One point, where the object is; the Path tool adds the rest.
        if (addPath(name, useStore.getState().time) !== null) useStore.getState().setTool('path')
      },
    })
    return items
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const host = e.currentTarget
    const viewport = viewportRef.current
    if (!viewport) return

    if (e.button === 1) {
      e.preventDefault()
      host.classList.add('panning')
      let last = { x: e.clientX, y: e.clientY }
      capture(
        host,
        e.pointerId,
        (ev) => {
          viewport.panBy(last.x - ev.clientX, last.y - ev.clientY)
          last = { x: ev.clientX, y: ev.clientY }
        },
        () => host.classList.remove('panning'),
      )
      return
    }
    if (e.button !== 0) return

    const located = locate(host, e.clientX, e.clientY)
    if (!located) return
    const { renderer } = located
    const store = useStore.getState()

    // The Object tool places one object per click and stays on (D163, D203).
    if (store.tool === 'object') {
      addObject(store.addKind, located.world.x, located.world.y)
      return
    }
    const model = store.model
    if (!model) return

    // A new gesture without Shift ends any Shift gesture still waiting for its key release.
    if (!e.shiftKey && gestureRef.current) {
      store.setTime(gestureRef.current.restore)
      gestureRef.current = null
    }

    // A path under the pointer comes first (D194, D203, D208): a point of it or its line. With Select, only the selected path answers; with the Path tool, any path shown, which the press picks.
    const shown = pathRef.current
    const pathAction = store.selectedActions.length === 1 ? store.selectedActions[0]! : null
    const pathTool = store.tool === 'path'
    const pixel = 1 / viewport.zoom
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
    if (hitPath && !e.shiftKey) {
      const ctrlHeld = e.ctrlKey || e.metaKey
      const isSelected = !!pathAction && pathAction.object === hitPath.ref.object && pathAction.index === hitPath.ref.index
      if (!isSelected) store.selectAction(hitPath.ref.object, hitPath.ref.index)
      if (pathEditable(hitPath.ref)) {
        if (pathTool && store.pathMode === 'move') {
          // Move path: any point or the line carries the whole path (D208).
          beginPathMove(host, e, hitPath.ref, located.world, null)
          return
        }
        if (hitPath.point !== null) {
          beginPathEdit(host, e, hitPath.ref, located.world, hitPath.point, null, ctrlHeld)
          return
        }
        if (!ctrlHeld) {
          // A click on the line puts a point there and drags it.
          beginPathEdit(host, e, hitPath.ref, located.world, null, (hitPath.frame.spans[hitPath.segment! + 1] ?? 0) + 1, false)
          return
        }
      }
      return
    }
    // The Path tool elsewhere (D203, D208): on an object, its path, the one that owns its place at the playhead or else its first, is picked, or, with none, one starts where the object is and the same press draws on from it; on empty space with a path in hand, a corner or a drawn line; with one object selected and no path in hand, its path starts and the press is its second point.
    if (pathTool) {
      const editing = store.pathMode === 'edit'
      if (located.hit) {
        const owner = model.objects.find((o) => o.name === located.hit)
        if (!owner) return
        const paths = owner.actions.map((a, index) => ({ a, index })).filter(({ a }) => a.verb === 'path' && !a.classAction && !a.overridden)
        if (paths.length > 0) {
          const holding = pathHolds(owner, 'x', store.time)
          const pick = paths.find(({ a }) => a === holding) ?? paths[0]!
          if (!(pathAction && pathAction.object === owner.name && pathAction.index === pick.index)) store.selectAction(owner.name, pick.index)
          return
        }
        if (!editing) return
        const index = addPath(owner.name, store.time)
        if (index !== null) beginStroke(host, e, { object: owner.name, index }, positionAt(useStore.getState().model ?? model, owner, store.time), false)
        return
      }
      if (!editing) return
      if (pathAction && shown?.primary?.editable) {
        beginStroke(host, e, pathAction, located.world, true)
        return
      }
      if (!pathAction && store.selection.length === 1) {
        const name = store.selection[0]!
        const index = addPath(name, store.time)
        if (index !== null) {
          insertPathPoints({ object: name, index }, 1, [gridded(located.world)])
          beginStroke(host, e, { object: name, index }, located.world, false)
        }
      }
      return
    }

    const mode = store.transformMode
    const selection = store.selection
    const ctrl = e.ctrlKey || e.metaKey
    // A handle of the selection wins over whatever is drawn under it.
    const handle = selection.length > 0 && !ctrl ? renderer.pickHandle(located.world) : null
    // A selected group is one thing: its members stand for it (D124).
    const selectedGroup = groupOf(model, selection)
    const members = selectedGroup ? groupMembers(model, selectedGroup.name) : []
    const under = located.hit
    const hit = handle ? (selectedGroup ? selectedGroup.name : selection.includes(under ?? '') ? under! : selection[0]!) : under

    if (!hit) {
      // Empty space: a drag selects what it touches, a click clears the selection (D89). The store folds exactly a group's members into the group (D124).
      const start = { x: located.paneX, y: located.paneY }
      const extend = ctrl
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
          const s = useStore.getState()
          // With a path selected, the box picks its points, and a click on empty space lets them go first (D198).
          const pointsMode = !!pathRef.current?.primary?.editable && s.selectedActions.length === 1
          if (!moved || !rect) {
            if (pointsMode && s.pathPoints.length > 0) s.setPathPoints([])
            else if (!extend) s.select([])
          } else {
            const a = viewport.toWorld(Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1))
            const b = viewport.toWorld(Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1))
            if (pointsMode) {
              const inside = pathRef.current!.primary!.frame.anchors.map((p, i) => (p.x >= a.x && p.x <= b.x && p.y >= b.y && p.y <= a.y ? i : -1)).filter((i) => i >= 0)
              s.setPathPoints(extend ? [...new Set([...s.pathPoints, ...inside])] : inside)
            } else {
              const names = renderer.objectsIn({ left: a.x, right: b.x, top: a.y, bottom: b.y })
              s.select(extend ? [...s.selection, ...names.filter((n) => !s.selection.includes(n))] : names)
            }
          }
          setMarquee(null)
        },
      )
      return
    }

    if (!handle && ctrl) {
      // Ctrl-click adds or removes; on a member of the selected group it picks that member alone (D89, D124).
      store.toggleSelected(hit)
      return
    }

    // The gesture works on the selection when the hit thing is part of it, else on the hit object.
    const inSelection = selection.includes(hit) || (!!selectedGroup && members.includes(hit))
    const names = handle || inSelection ? selection : [hit]
    if (!inSelection) store.select([hit])
    const objects = names.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o)
    if (objects.length === 0) return
    const subject = objects.find((o) => o.name === hit) ?? objects[0]!
    const op: Drag['op'] = handle ? (handle.kind === 'rotate' ? 'rotate' : 'resize') : mode === 'rotate' ? 'rotate' : 'move'
    const isGroup = objects.length === 1 && subject.className === GROUP
    /** What the gesture is about: positions, the angle, or the size. A match here makes a selected action the target. */
    const primaryAttrs = (obj: SceneObject): string[] => (op === 'move' ? ['x', 'y'] : op === 'rotate' ? ['rotation'] : resizeAttrs(obj.className))

    // Moving an object that a path places moves the path (D197, D205), as a drag during a move edits the move: the first anchor at the path's start, the last anywhere after, with the playhead taken to the path's end while it runs. The path selected, or merely owning the place; with Shift, only the selected path.
    const selectedRef = store.selectedActions.find((r) => r.object === subject.name)
    const pathSelected = selectedRef && subject.actions[selectedRef.index]?.verb === 'path' ? selectedRef.index : null
    if (op === 'move' && objects.length === 1 && !isGroup && !(e.ctrlKey || e.metaKey) && (!e.shiftKey || pathSelected !== null)) {
      const target = pathDragTarget(subject.name, pathSelected, store.time)
      if (target) {
        if (target.showTime !== null) store.setTime(target.showTime)
        beginPathEdit(host, e, target.ref, located.world, target.index, null, false)
        return
      }
    }

    let kind: Drag['kind'] = e.shiftKey ? 'timed' : 'plain'
    let actionIndex = -1
    let derived = false
    let showTime: number | null = null
    /** The time whose state the drag sets when the selected animation is what it is about: its start, or with Shift its end (D157). */
    let editAt: number | null = null
    let runningToSelect: ActionRef[] | null = null
    const selected = store.selectedActions.find((r) => r.object === subject.name)
    const selectedAction = selected ? subject.actions[selected.index] : undefined
    const matches = objects.length === 1 && !!selectedAction && primaryAttrs(subject).some((a) => a in selectedAction.changes)
    const previewing = gestureRef.current?.editing ? gestureRef.current : null
    if (previewing && selectedAction && objects.length === 1 && e.shiftKey && selectedAction.verb !== 'path') {
      // Shift held on the selected animation previews one of its ends: any drag sets that end's state, whatever the animation changes so far (D157, D188).
      if (previewing.editEnd === 'start') editAt = selectedAction.start
      else {
        kind = 'destination'
        actionIndex = selected!.index
        derived = !!selectedAction.classAction
        editAt = selectedAction.end
      }
    } else if (matches && e.shiftKey && !gestureRef.current) {
      // Shift given to the pointer alone, with a matching animation selected: its end state.
      kind = 'destination'
      actionIndex = selected!.index
      derived = !!selectedAction!.classAction
      editAt = selectedAction!.end
    } else if (matches && !e.shiftKey) {
      // The animation selected: a plain drag sets the state at the end the pin names (D157, D187).
      if (store.pin === 'end') {
        kind = 'destination'
        actionIndex = selected!.index
        derived = !!selectedAction!.classAction
        editAt = selectedAction!.end
      } else editAt = selectedAction!.start
    } else if (!e.shiftKey && objects.length === 1) {
      // Dragging something mid-animation edits that animation's end state, and shows it (D102).
      const running = inProgressActions([subject.name], [...primaryAttrs(subject), ...(op === 'resize' ? ['x', 'y'] : [])], store.time)
      if (running.length > 0) {
        showTime = Math.max(...running.map((r) => model.objects.find((o) => o.name === r.object)!.actions[r.index]!.end))
        // The running action is selected once the drag moves; a click keeps the object as what is selected (D147).
        runningToSelect = running
      }
    }
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
    const alreadySingle = selection.length === 1 && selection[0] === hit && store.selectedActions.length === 0
    const angle0 = Math.atan2(located.world.y - frame.y, located.world.x - frame.x)
    // A move knows the dragged things' box and everyone else's, for edge snapping and collision (D135, D136).
    const dragged = new Set<string>()
    const expand = (name: string): void => {
      if (dragged.has(name)) return
      dragged.add(name)
      if (model.objects.find((o) => o.name === name)?.className === GROUP) for (const member of groupMembers(model, name)) expand(member)
    }
    for (const o of targets) expand(o.name)
    const box0Frame = op === 'move' ? renderer.boxAround(targets.map((o) => o.name)) : null
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
    if (op === 'move') {
      const draggedPolys: Mover['polys'] = []
      const obstacles: Mover[] = []
      for (const o of model.objects) {
        if (o.className === GROUP) continue
        const f = renderer.frameOf(o.name)
        if (!f) continue
        if (dragged.has(o.name)) {
          draggedPolys.push(outlineOf(o, { ...f, x: f.x - sweepOrigin.x, y: f.y - sweepOrigin.y }))
          continue
        }
        others.push({ name: o.name, box: toBox(f) })
        // What a push moves is written through the solver from where it shows now; what cannot be written is as good as anchored.
        if (!base.has(o.name)) base.set(o.name, baseValues(model, o, sampleTime))
        obstacles.push(makeMover(o.name, [outlineOf(o, f)], store.anchored.includes(o.name) || !o.decl, store.soft.includes(o.name)))
      }
      movers = { dragged: makeMover(primary.name, draggedPolys, false, false), obstacles }
    }
    const drag: Drag = {
      kind,
      op,
      names: targets.map((o) => o.name),
      primary: primary.name,
      group: isGroup,
      grouping: objects.length > 1 && e.shiftKey ? names : null,
      handle,
      keepAspect: e.altKey,
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
      frameBox: viewport.frameRect(),
      movers,
      sweepOrigin,
      lastAngle: angle0,
      turned: 0,
      local0: toLocal(frame, located.world),
      moved: false,
      created: false,
      shown: false,
      click: alreadySingle && !e.shiftKey && !handle ? 'cycle' : selected && !handle && !e.shiftKey ? 'object' : 'none',
      touched: new Set(),
      pushedActions: new Map(),
      pushedShifts: new Map(),
    }
    dragRef.current = drag
    if (drag.op === 'resize' && drag.keepAspect) setDragging('aspect')
    // A Shift gesture that began on the key already moved the playhead to the proposed end; the animation still starts where it was, or after the last one made in Chain mode (D103, D127).
    const restoreTime = gestureRef.current?.from ?? store.time
    const proposed = gestureRef.current?.duration ?? 1
    // One drag is one undo step, pushed things included (D22, D136).
    beginGesture()
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
            const name = createGroup(drag.grouping)
            if (!name) return
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
          if (runningToSelect) useStore.getState().selectActions(runningToSelect)
          if (drag.showTime !== null) useStore.getState().setTime(drag.showTime)
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
              const l0 = drag.locals.get(name)!
              // Each thing's center moves with the box's scaling from the anchor; it stays only when nothing is anchored away from it.
              const p = toWorld(drag.frame, { x: anchorLocal.x + (l0.x - anchorLocal.x) * fx, y: anchorLocal.y + (l0.y - anchorLocal.y) * fy })
              const v = resizedValues(obj.className, b, fx, fy)
              if (Math.abs(p.x - b['x']!) > 1e-6 || Math.abs(p.y - b['y']!) > 1e-6) Object.assign(v, { x: p.x, y: p.y })
              values.set(name, v)
            }
          }
        } else {
          const tx = primaryBase['x']! + dx / viewport.zoom
          const ty = primaryBase['y']! - dy / viewport.zoom
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
              if (drag.kind === 'plain') walk(drag.movers.dragged, { x: ddx, y: ddy }, drag.movers.obstacles, pushing)
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
          for (const name of drag.names) {
            const b = drag.base.get(name)!
            values.set(name, { x: b['x']! + ddx, y: b['y']! + ddy })
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
        if (drag.kind === 'timed') {
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
              return { name, attrs: Object.keys(c).length > 0 ? { ...keepCenter, ...c } : c }
            }),
            useStore.getState().time,
          )
        }
      },
      (ev) => {
        const s = useStore.getState()
        if (!drag.moved) {
          if (drag.click === 'cycle') s.cycleTransformMode()
          else if (drag.click === 'object') s.select([drag.primary])
        }
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
        endGesture()
        if (gestureRef.current && !ev.shiftKey) {
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

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const located = locate(e.currentTarget, e.clientX, e.clientY)
    if (!located) {
      e.preventDefault()
      return
    }
    const { world, hit } = located
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
      const { anchors, curve, spans } = shown.primary.frame
      const action = st.model?.objects.find((o) => o.name === pathAction.object)?.actions[pathAction.index]
      const smooth = action?.changes['smooth'] === true
      const smoothItem = { label: smooth ? 'Straight lines' : 'Smooth curve', run: () => setPathSmooth(pathAction, !smooth) }
      const hideItems: MenuItems = inPathTool ? [{ label: 'Hide path', run: () => st.setPathHidden(`${pathAction.object}:${pathAction.index}`, true) }] : []
      const point = nearestPoint(anchors, world, 8 * pixel)
      if (point !== null && anchors.length > 1) {
        const picked = st.pathPoints.includes(point) && st.pathPoints.length > 1 ? st.pathPoints : [point]
        showMenu(e, [smoothItem, ...hideItems, { label: picked.length > 1 ? `Delete ${picked.length} points` : 'Delete point', run: () => removePathPoints(pathAction, picked), danger: true }])
        return
      }
      const segment = point === null ? nearestSegment(curve, world, 6 * pixel) : null
      if (segment !== null) {
        showMenu(e, [{ label: 'Add point here', run: () => insertPathPoints(pathAction, (spans[segment + 1] ?? 0) + 1, [world]) }, smoothItem, ...hideItems])
        return
      }
      if (!hit) {
        showMenu(e, [
          { label: 'Add point here', run: () => insertPathPoints(pathAction, anchors.length, [world]) },
          smoothItem,
          { label: 'Add', children: OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, world.x, world.y) })) },
        ])
        return
      }
    }
    if (hit) {
      const s = useStore.getState()
      const group = s.model ? groupOf(s.model, s.selection) : null
      if (group && s.model && groupMembers(s.model, group.name).includes(hit)) {
        showMenu(e, [
          { label: 'Jump to code', run: () => jumpToObject(group.name) },
          { label: 'Rename', run: () => requestRename({ object: group.name }) },
          { label: 'Select', keyword: hit, run: () => s.select([hit]) },
          { label: 'Ungroup', keyword: group.name, run: () => ungroup(group.name) },
        ])
        return
      }
      const targets = s.selection.includes(hit) ? s.selection : [hit]
      if (!s.selection.includes(hit)) s.select([hit])
      const many = targets.length > 1
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(hit) },
        ...(many ? [] : [{ label: 'Rename', run: () => requestRename({ object: hit }) }]),
        ...(many ? [] : pathItems(hit)),
        ...(s.hiddenPaths.some((k) => k.startsWith(`${hit}:`)) ? [{ label: 'Show paths', run: () => s.hiddenPaths.filter((k) => k.startsWith(`${hit}:`)).forEach((k) => s.setPathHidden(k, false)) }] : []),
        { label: 'Classes', run: () => requestClasses(targets) },
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
        { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
        { label: many ? `Delete ${targets.length} objects` : 'Delete object', run: () => deleteObjects(targets), danger: true },
      ])
    } else {
      showMenu(e, [{ label: 'Add', children: OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, world.x, world.y) })) }])
    }
  }

  // Scrollbars: the view's place within a stable area, the frame with a frame's width around
  // it, grown only by what objects occupy. Scrolling never changes the area (D82).
  const viewport = viewportRef.current
  const view = viewport?.sized ? viewport.viewRect() : null
  let scroll: { x: [number, number]; y: [number, number] } | null = null
  if (viewport && view) {
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
  const selectedGroup = model ? groupOf(model, selection) : null
  // A path whose points are written out offers the Draw tool (D194).
  const pathSelected = selectedActions.length === 1 && !!model && model.objects.find((o) => o.name === selectedActions[0]!.object)?.actions[selectedActions[0]!.index]?.verb === 'path' && pathEditable(selectedActions[0]!)

  return (
    <div
      className={`preview${tool === 'object' ? ' placing' : tool === 'path' ? ' drawing' : ''} mode-${transformMode}`}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={() => (hoverRef.current = true)}
      onPointerLeave={() => (hoverRef.current = false)}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} />
      {marquee && (
        <div className="preview-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
      )}
      {sketch && sketch.length > 1 && (
        <svg className="preview-sketch">
          <polyline points={sketch.map((p) => `${p.x},${p.y}`).join(' ')} />
        </svg>
      )}
      <div className="preview-palette" onPointerDown={stop} role="group" aria-label="Tool">
        <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select: click and drag objects, and the points of the selected path." aria-pressed={tool === 'select'} aria-label="Select">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 3l12 10h-6l3.5 7-2.5 1.2-3.5-7L6 18z" fill="currentColor" />
          </svg>
        </button>
        <button className={tool === 'object' ? 'active' : ''} onClick={() => setTool(tool === 'object' ? 'select' : 'object')} title="Object: pick a kind, then click where each one goes. The tool stays on until clicked again, or Escape." aria-pressed={tool === 'object'} aria-label="Object">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="3" y="4" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="9" cy="16.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M18 9v8M14 13h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={tool === 'path' ? 'active' : ''}
          onClick={() => setTool(tool === 'path' ? 'select' : 'path')}
          title="Path: click an object to start its path where it is, or to pick the path it has. Edit and Move path on the top bar say what a drag does. The tool stays on until clicked again, or Escape."
          aria-pressed={tool === 'path'}
          aria-label="Path"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 18c3-10 7-10 10-5s5 5 7-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="4" cy="18" r="2" fill="currentColor" />
            <circle cx="21" cy="9" r="2" fill="currentColor" />
          </svg>
        </button>
      </div>
      <div className="preview-toolbar" onPointerDown={stop}>
        {tool === 'object' && (
          <div className="preview-modes" role="group" aria-label="Kind of object to add">
            {OBJECT_KINDS.map((k) => (
              <button key={k} className={addKind === k ? 'active' : ''} onClick={() => setAddKind(k)} title={`Each click adds a ${k}`} aria-pressed={addKind === k}>
                {k}
              </button>
            ))}
          </div>
        )}
        {tool === 'path' && (
          <div className="preview-modes" role="group" aria-label="Path tool mode">
            <button className={pathMode === 'edit' ? 'active' : ''} onClick={() => setPathMode('edit')} title="Edit: click an object to start or pick its path; click for corners, drag to draw; drag a point to move it; click the line to add one." aria-pressed={pathMode === 'edit'}>
              Edit
            </button>
            <button className={pathMode === 'move' ? 'active' : ''} onClick={() => setPathMode('move')} title="Move path: drag any point or the line of a path to carry the whole path." aria-pressed={pathMode === 'move'}>
              Move path
            </button>
          </div>
        )}
        {tool === 'select' && selection.length > 0 && (
          <>
            <div className="preview-modes" role="group" aria-label="Drag mode">
              {TRANSFORM_MODES.map((m) => (
                <button key={m} className={transformMode === m ? 'active' : ''} onClick={() => setTransformMode(m)} title={`${MODE_TIP[m]} Clicking the selected object cycles the modes.`} aria-pressed={transformMode === m}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <button
              className="preview-toggle"
              onClick={() => setAnchor(anchor === 'edge' ? 'center' : 'edge')}
              title={anchor === 'edge' ? 'Resizing keeps the far side in place. Click to resize from the center instead.' : 'Resizing keeps the center in place. Click to keep the far side instead.'}
            >
              {anchor === 'edge' ? 'Edge' : 'Center'}
            </button>
            <button
              className="preview-toggle"
              onClick={() => {
                const next = pin === 'start' ? 'end' : 'start'
                setPin(next)
                // With an animation selected, the playhead goes to the end the pin names (D187).
                const s = useStore.getState()
                const ref = s.selectedActions.find((r) => s.selection.includes(r.object)) ?? s.selectedActions[0]
                const action = ref ? s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index] : undefined
                if (action) s.setTime(next === 'end' ? action.end : action.start)
              }}
              title={pin === 'start' ? 'A Shift-drag makes an animation that starts at the playhead and runs on from it; Shift and the wheel move its end. Click to make animations end at the playhead instead.' : 'A Shift-drag makes an animation that ends at the playhead, arriving at what you drag; Shift and the wheel move its start. Click to make animations start at the playhead instead.'}
            >
              {pin === 'start' ? 'Starts at playhead' : 'Ends at playhead'}
            </button>
            {pin === 'start' && (
              <button
                className={`preview-toggle${chain ? ' on' : ''}`}
                onClick={() => setChain(!chain)}
                title={chain ? 'While Shift is held, each animation follows the one before it, and the playhead rests at the end of the chain. Click to start them all at the playhead instead.' : 'While Shift is held, each animation starts at the playhead, stacked. Click to chain them one after another instead.'}
                aria-pressed={chain}
              >
                Chain
              </button>
            )}
            {(altDown || dragging === 'aspect') && <span className="preview-chip">Keeping proportions</span>}
          </>
        )}
      </div>
      <div className="preview-tools" onPointerDown={stop}>
        <button className={previewSnap.on ? 'on' : ''} onClick={() => setPreviewSnap({ on: !previewSnap.on })} title={previewSnap.on ? 'Drags snap positions and sizes to the grid and angles to the step. Click for free placement.' : 'Drags place freely. Click to snap positions and sizes to a grid and angles to a step.'} aria-pressed={previewSnap.on}>
          Grid
        </button>
        {previewSnap.on && <NumberField label="Grid, in pixels" value={previewSnap.grid} unit="px" onChange={(grid) => setPreviewSnap({ grid })} />}
        {previewSnap.on && <NumberField label="Angle step, in degrees" value={previewSnap.angle} unit={'°'} onChange={(angle) => setPreviewSnap({ angle })} />}
        <button className={showPaths ? 'on' : ''} onClick={toggleShowPaths} title={showPaths ? "The selected object's paths show. Click to show a path only while it is selected; the Path tool shows every path regardless." : "A path shows only while it is selected. Click to show the selected object's paths too; the Path tool shows every path regardless."} aria-pressed={showPaths}>
          Paths
        </button>
        <button className={previewSnap.edges ? 'on' : ''} onClick={() => setPreviewSnap({ edges: !previewSnap.edges })} title={previewSnap.edges ? 'A dragged box aligns its edges and center to other objects and the frame, with guides. Click to stop aligning.' : 'Dragged boxes do not align to others. Click to align edges and centers to other objects and the frame.'} aria-pressed={previewSnap.edges}>
          Edges
        </button>
        <button className={collide ? 'on' : ''} onClick={() => setCollide(!collide)} title={collide ? 'Dragged objects stop at the outlines of other objects and slide along them; right-click an object to anchor it or to enable passthrough on it. Click to let objects overlap.' : 'Dragged objects pass over others. Click to make them stop at each other.'} aria-pressed={collide}>
          Collide
        </button>
        {collide && (
          <button className={push ? 'on' : ''} onClick={() => setPush(!push)} title={push ? 'A dragged object shoves what it meets along, chains included, until something anchored stops it; an animation never pushes. Click to stop at objects instead.' : 'Dragged objects stop at what they meet. Click to make them push it along.'} aria-pressed={push}>
            Push
          </button>
        )}
        <button onClick={() => viewportRef.current?.setZoom(1)} title="Actual size">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => viewportRef.current?.fit()} title="Fit the camera frame">
          Fit
        </button>
      </div>
      <div className="preview-hud">
        <span>{formatTime(time, settings.fps)}</span>
        <span className="dim">
          {settings.width} x {settings.height}
        </span>
        {tool === 'object' && <span className="hint">Click to place</span>}
        {tool === 'path' && pathMode === 'move' && <span className="hint">Drag any point or line of a path to move the whole path</span>}
        {tool === 'path' && pathMode === 'edit' && <span className="hint">{pathSelected ? 'Click for a corner, drag to draw; drag a point to move it' : selection.length === 1 ? 'Click the object to start its path, or click where the path goes' : 'Click an object, or a path'}</span>}
        {selectedGroup && model ? (
          <span className="dim">
            {selectedGroup.name}: {groupMembers(model, selectedGroup.name).length} objects
          </span>
        ) : (
          selection.length > 1 && <span className="dim">{selection.length} selected</span>
        )}
      </div>
      {scroll && view && viewport && (
        <>
          <ScrollBar axis="x" rangeStart={scroll.x[0]} rangeEnd={scroll.x[1]} windowStart={view.left} windowEnd={view.right} onScroll={(start) => viewport.scrollTo({ left: start })} />
          <ScrollBar axis="y" rangeStart={scroll.y[0]} rangeEnd={scroll.y[1]} windowStart={-view.top} windowEnd={-view.bottom} onScroll={(start) => viewport.scrollTo({ top: -start })} />
        </>
      )}
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
