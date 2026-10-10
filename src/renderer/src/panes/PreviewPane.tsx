import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { groupMembers } from '../model/groups'
import { GROUP } from '../model/registry'
import { shownValue } from '../model/sample'
import type { SceneModel, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { addObject, adjustDurations, beginTimed, createGroup, deleteObjects, duplicateObjects, inProgressActions, jumpToObject, lastActionIndex, overrideClassAction, requestClasses, requestRename, resizeAttrs, resizedValues, setActionDestination, setAttrsAtMany, ungroup } from '../project/operations'
import { SceneRenderer, type Frame, type Handle } from '../preview/SceneRenderer'
import { Viewport } from '../preview/Viewport'
import { TRANSFORM_MODES, useStore, type Tool, type TransformMode } from '../state/store'
import { formatTime } from '../state/time'

const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']
const MODE_LABEL: Record<TransformMode, string> = { all: 'Transform', move: 'Move', rotate: 'Rotate', resize: 'Resize' }
const MODE_TIP: Record<TransformMode, string> = {
  all: 'Every handle: drag the body to move, a corner or an edge to resize, the handle above to rotate. Shift makes the drag an animation.',
  move: 'Dragging moves. Shift makes it an animation.',
  rotate: 'Dragging turns the selection around the center of its box. Shift makes it an animation.',
  resize: 'Corners resize both sides, edges resize one; hold Alt to keep the proportions. Shift makes it an animation.',
}
const BASE_ATTRS = ['x', 'y', 'rotation', 'scale', 'width', 'height', 'radius', 'fontSize']

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
function restingTime(gesture: { restore: number; from: number }): number {
  const s = useStore.getState()
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
   * change before the animation exists.
   */
  const gestureRef = useRef<{ restore: number; from: number; duration: number } | null>(null)
  /** Whether the pointer has moved over the pane since anything else took the focus, so Shift held here starts a gesture and Shift typed elsewhere does not. */
  const hoverRef = useRef(false)
  /** The turn plain drags have given the box's axes since the selection was made; the box stays turned until it changes (D116). */
  const axesRef = useRef(0)
  const paintRef = useRef<() => void>(() => undefined)
  const [altDown, setAltDown] = useState(false)
  const [dragging, setDragging] = useState<'aspect' | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [zoom, setZoom] = useState(1)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const settings = useStore((s) => s.settings)
  const time = useStore((s) => s.time)
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const transformMode = useStore((s) => s.transformMode)
  const previewSnap = useStore((s) => s.previewSnap)
  const pin = useStore((s) => s.pin)
  const chain = useStore((s) => s.chain)
  const anchor = useStore((s) => s.anchor)
  const setTool = useStore((s) => s.setTool)
  const setTransformMode = useStore((s) => s.setTransformMode)
  const setPreviewSnap = useStore((s) => s.setPreviewSnap)
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
      renderer.update(s.model, s.time, s.selection, s.transformMode, 1 / viewport.zoom, axesRef.current)
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
        if (gestureRef.current && action && after.pin === 'start') {
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
      if (e.key !== 'Shift' || e.repeat || !hoverRef.current || gestureRef.current || dragRef.current) return
      if (e.target instanceof Element && e.target.closest('input, textarea')) return
      const s = useStore.getState()
      if (s.pin !== 'start' || !s.model) return
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

    if (store.tool !== 'select') {
      addObject(store.tool, located.world.x, located.world.y)
      store.setTool('select')
      return
    }
    const model = store.model
    if (!model) return

    // A new gesture without Shift ends any Shift gesture still waiting for its key release.
    if (!e.shiftKey && gestureRef.current) {
      store.setTime(gestureRef.current.restore)
      gestureRef.current = null
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
          if (!moved || !rect) {
            if (!extend) s.select([])
          } else {
            const a = viewport.toWorld(Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1))
            const b = viewport.toWorld(Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1))
            const names = renderer.objectsIn({ left: a.x, right: b.x, top: a.y, bottom: b.y })
            s.select(extend ? [...s.selection, ...names.filter((n) => !s.selection.includes(n))] : names)
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

    let kind: Drag['kind'] = e.shiftKey ? 'timed' : 'plain'
    let actionIndex = -1
    let derived = false
    let showTime: number | null = null
    const selected = store.selectedActions.find((r) => r.object === subject.name)
    const selectedAction = selected ? subject.actions[selected.index] : undefined
    if (!e.shiftKey && objects.length === 1 && selectedAction && primaryAttrs(subject).some((a) => a in selectedAction.changes)) {
      kind = 'destination'
      actionIndex = selected!.index
      derived = !!selectedAction.classAction
      showTime = selectedAction.end
    } else if (!e.shiftKey && objects.length === 1) {
      // Dragging something mid-animation edits that animation's end state, and shows it (D102).
      const running = inProgressActions([subject.name], [...primaryAttrs(subject), ...(op === 'resize' ? ['x', 'y'] : [])], store.time)
      if (running.length > 0) {
        showTime = Math.max(...running.map((r) => model.objects.find((o) => o.name === r.object)!.actions[r.index]!.end))
        store.selectActions(running)
      }
    }
    // A gesture on a group, plain or not, edits the group itself, as on any object (D124).
    const targets = objects
    const primary = targets.find((o) => o.name === hit) ?? targets[0]!
    const sampleTime = kind === 'destination' ? selectedAction!.end : store.time
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
      lastAngle: angle0,
      turned: 0,
      local0: toLocal(frame, located.world),
      moved: false,
      created: false,
      shown: false,
      click: alreadySingle && !e.shiftKey && !handle ? 'cycle' : selected && !handle && !e.shiftKey ? 'object' : 'none',
    }
    dragRef.current = drag
    if (drag.op === 'resize' && drag.keepAspect) setDragging('aspect')
    // A Shift gesture that began on the key already moved the playhead to the proposed end; the animation still starts where it was, or after the last one made in Chain mode (D103, D127).
    const restoreTime = gestureRef.current?.from ?? store.time
    const proposed = gestureRef.current?.duration ?? 1
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
          let tx = primaryBase['x']! + dx / viewport.zoom
          let ty = primaryBase['y']! - dy / viewport.zoom
          if (snap.on) {
            tx = snapTo(tx, snap.grid)
            ty = snapTo(ty, snap.grid)
          }
          const ddx = tx - primaryBase['x']!
          const ddy = ty - primaryBase['y']!
          for (const name of drag.names) {
            const b = drag.base.get(name)!
            values.set(name, { x: b['x']! + ddx, y: b['y']! + ddy })
          }
        }
        // Only values the gesture moved get written, so an edge drag on a circle adds one line, not two.
        const changed = (name: string, v: Record<string, number>): Record<string, number> => {
          const b = drag.base.get(name)!
          return Object.fromEntries(Object.entries(v).filter(([attr, value]) => Math.abs(value - (b[attr] ?? 0)) > 1e-6))
        }
        if (drag.kind === 'timed') {
          const pinNow = useStore.getState().pin
          const v = values.get(drag.primary)
          if (!v) return
          if (!drag.created) {
            const end = beginTimed(drag.primary, Object.keys(v), pinNow, restoreTime, proposed)
            if (end === null) return
            drag.created = true
            // In Chain mode the next animation starts where this one ends (D127).
            if (gestureRef.current && pinNow === 'start' && useStore.getState().chain) gestureRef.current.from = end
            if (pinNow === 'start' && !drag.shown) {
              drag.shown = true
              useStore.getState().setTime(end)
            }
          }
          const index = lastActionIndex(drag.primary)
          if (index === null) return
          // The target is what shows; the action's values follow through the solver, so a member of a turned group lands where it is dragged (D122).
          setActionDestination(drag.primary, index, v)
        } else if (drag.kind === 'destination') {
          const v = values.get(drag.primary)
          if (v) setActionDestination(drag.primary, drag.actionIndex, changed(drag.primary, v))
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
        if (gestureRef.current && !ev.shiftKey) {
          // Shift already released: the gesture is over, the playhead goes back, or rests at the end of the chain.
          s.setTime(restingTime(gestureRef.current))
          gestureRef.current = null
        } else if (gestureRef.current && drag.created && s.chain && s.pin === 'start') {
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
    if (hit) {
      const s = useStore.getState()
      const group = s.model ? groupOf(s.model, s.selection) : null
      if (group && s.model && groupMembers(s.model, group.name).includes(hit)) {
        showMenu(e, [
          { label: 'Jump to code', run: () => jumpToObject(group.name) },
          { label: 'Rename…', run: () => requestRename({ object: group.name }) },
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
        ...(many ? [] : [{ label: 'Rename…', run: () => requestRename({ object: hit }) }]),
        { label: 'Classes…', run: () => requestClasses(targets) },
        { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
        { label: many ? `Delete ${targets.length} objects` : 'Delete object', run: () => deleteObjects(targets), danger: true },
      ])
    } else {
      showMenu(
        e,
        TOOLS.map((t) => ({ label: 'Add', keyword: t, run: () => addObject(t, world.x, world.y) })),
      )
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

  return (
    <div
      className={`preview${tool !== 'select' ? ' placing' : ''} mode-${transformMode}`}
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
      <div className="preview-toolbar" onPointerDown={stop}>
        {TOOLS.map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(tool === t ? 'select' : t)} title={`Add a ${t}: pick it, then click where it goes. Click again to put it away.`}>
            {t}
          </button>
        ))}
        {tool !== 'select' && <span className="hint">Click to place</span>}
        {selection.length > 0 && (
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
              onClick={() => setPin(pin === 'start' ? 'end' : 'start')}
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
          Snap
        </button>
        {previewSnap.on && <NumberField label="Grid, in pixels" value={previewSnap.grid} unit="px" onChange={(grid) => setPreviewSnap({ grid })} />}
        {previewSnap.on && <NumberField label="Angle step, in degrees" value={previewSnap.angle} unit={'°'} onChange={(angle) => setPreviewSnap({ angle })} />}
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
