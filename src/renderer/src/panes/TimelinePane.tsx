import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { ScrollBar } from '../components/ScrollBar'
import { activeMembers, classGroups, classKey, classSpan, classStandIn, overrideOf, type ClassGroup } from '../model/groups'
import { VERB_COLORS, VERBS } from '../model/registry'
import { isVisibleAt, valueAt } from '../model/sample'
import type { Action, ClassAction, SceneModel, SceneObject } from '../model/types'
import { updateSettings } from '../project/controller'
import {
  addAction,
  addClassAction,
  addObject,
  appearClassHere,
  appearHere,
  canEdit,
  deleteAction,
  deleteClassAction,
  deleteObjects,
  disappearClassHere,
  disappearHere,
  duplicateObjects,
  jumpToAction,
  jumpToClass,
  jumpToObject,
  materializeClassAction,
  moveDeclaration,
  overrideClassAction,
  ownAction,
  removeFromClass,
  requestClasses,
  requestRename,
  roundSeconds,
  selectClass,
  selectClassAction,
  setActionTiming,
  setActionValues,
  setClassActionTiming,
  setClassActionValues,
} from '../project/operations'
import { useStore, type Tool } from '../state/store'
import { formatTime, snapToFrame, timecode } from '../state/time'

/** Zoom limits in pixels per second. At the top, single frames at 60 fps sit about 65 px apart. */
const MIN_PPS = 4
const MAX_PPS = 4000
/** One second per labelled tick at the default zoom. */
const DEFAULT_PPS = 100
/** Candidate spacings between labelled ticks, in seconds, beyond frame multiples. */
const SECOND_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
/** Minimum distance between labelled ticks, in pixels. */
const TICK_SPACING = 80
/** Width of the row header column, in pixels. Keep in step with styles.css. */
const HEADER_W = 180
/** Height of one lane of clips in a row. Overlapping clips stack in lanes. */
const LANE_H = 22
/** Height of the opacity lane at the bottom of every row. */
const OPACITY_H = 18
/** Pixels of vertical drag on an opacity handle for the whole 0 to 1 range. */
const OPACITY_GAIN = 40
/** How close a drag must come to a snap target, in pixels. */
const SNAP_PX = 8
const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']

interface View {
  /** Pixels per second. */
  pps: number
  /** Time at the left edge of the track, in seconds. */
  scrollTime: number
}

/** A row of the timeline: a class with its members beneath it, then every object (D80, D92). */
type Row = { kind: 'class'; group: ClassGroup; index: number } | { kind: 'object'; obj: SceneObject; member: boolean }

/** The coarsest spacing that keeps labelled ticks at least TICK_SPACING apart. */
function tickStep(pps: number, fps: number): number {
  const frame = 1 / fps
  const steps = [frame, frame * 2, frame * 5, frame * 10, ...SECOND_STEPS.filter((s) => s > frame * 10)]
  return steps.find((s) => s * pps >= TICK_SPACING) ?? steps[steps.length - 1]!
}

function tickLabel(seconds: number, step: number, fps: number): string {
  if (step >= 60) return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  if (step >= 1) return `${Math.round(seconds)}s`
  if (step >= 0.5) return `${seconds.toFixed(1)}s`
  return timecode(seconds, fps)
}

function clipLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}

/** Overlapping clips go in separate lanes so each stays visible and grabbable. */
function assignLanes<T extends { id: number; start: number; end: number }>(items: T[]): { lanes: Map<number, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.id - b.id)
  const laneEnds: number[] = []
  const lanes = new Map<number, number>()
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = Math.max(item.end, item.start + 1e-6)
    lanes.set(item.id, lane)
  }
  return { lanes, count: Math.max(1, laneEnds.length) }
}

/**
 * Snap a dragged time to whole seconds and to the starts and ends of other actions when
 * snapping is on (D64); otherwise keep it exact to the millisecond.
 */
function snapTime(raw: number, model: SceneModel | null, exclude: Action | ClassAction | null, pps: number, snap: boolean): number {
  if (!snap) return Math.max(0, roundSeconds(raw))
  const threshold = SNAP_PX / pps
  const candidates = [0, Math.floor(raw), Math.ceil(raw)]
  if (model) for (const action of model.actions) if (!action.overridden && action !== exclude && action.classAction !== exclude) candidates.push(action.start, action.end)
  let best = raw
  let bestDistance = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - raw)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return Math.max(0, roundSeconds(best))
}

/** The opacity of one object over the visible range, as a filled curve. Memoised: it ignores the playhead. */
const OpacityLane = memo(function OpacityLane({ model, obj, scrollTime, pps, width, height }: { model: SceneModel; obj: SceneObject; scrollTime: number; pps: number; width: number; height: number }) {
  const path = useMemo(() => {
    if (width <= 0) return ''
    const points: string[] = []
    for (let x = 0; x <= width; x += 3) {
      const value = valueAt(model, obj, 'opacity', scrollTime + x / pps)
      const opacity = Math.max(0, Math.min(1, typeof value === 'number' ? value : 0))
      points.push(`${x},${(height - 1 - opacity * (height - 3)).toFixed(1)}`)
    }
    return `M0,${height} L${points.join(' L')} L${width},${height} Z`
  }, [model, obj, scrollTime, pps, width, height])
  return (
    <svg className="opacity-lane" width={width} height={height} aria-hidden="true">
      <path d={path} />
    </svg>
  )
})

type ClipMode = 'move' | 'start' | 'end'

/**
 * Transport, ruler, and rows over an open-ended time axis: a row per class with its members
 * beneath, then a row per object in declaration order, each with its clips in lanes and its
 * opacity below. Only the ruler scrubs (D92). Over the tracks the wheel zooms around the cursor,
 * Shift and the wheel scroll time, Alt and the wheel scroll the rows; over the row headers the
 * wheel scrolls the rows, and dragging a header up or down reorders the objects. Clips drag by
 * the body to move and by the edges to resize. A clip from a class action is dashed on its
 * members; dragging it, or choosing Override, gives that object its own action in its place and
 * shows the class clip switched off (D80). Opacity lanes, on objects and classes alike, have
 * handles on every fade and toggle existence on a double-click (D83, D93). Right-click for more.
 */
export function TimelinePane() {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const loop = useStore((s) => s.loop)
  const snap = useStore((s) => s.snap)
  const fps = useStore((s) => s.settings.fps)
  const hold = useStore((s) => s.settings.hold)
  const contentEnd = useStore((s) => s.contentEnd)
  const model = useStore((s) => s.model)
  const source = useStore((s) => s.source)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const collapsed = useStore((s) => s.collapsed)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const toggleSnap = useStore((s) => s.toggleSnap)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTime = useStore((s) => s.setTime)
  const gridRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ pps: DEFAULT_PPS, scrollTime: 0 })
  const [width, setWidth] = useState(0)
  /** A row header being dragged to another place, with where it would drop. */
  const [reorder, setReorder] = useState<{ name: string; lineY: number } | null>(null)
  const skipClickRef = useRef(false)
  // The ref is the live value: wheel events can arrive faster than renders, and each one must
  // build on the previous one, not on the last rendered view.
  const viewRef = useRef(view)
  const setView = (next: View) => {
    viewRef.current = next
    setViewState(next)
  }
  const editable = canEdit()
  void source

  useEffect(() => {
    const ruler = rulerRef.current
    if (!ruler) return
    const observer = new ResizeObserver(() => setWidth(ruler.getBoundingClientRect().width))
    observer.observe(ruler)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    const ruler = rulerRef.current
    if (!grid || !ruler) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const overHeaders = e.clientX < grid.getBoundingClientRect().left + HEADER_W
      if (overHeaders || e.altKey) {
        if (bodyRef.current) bodyRef.current.scrollTop += e.deltaY
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / v.pps
        setView({ pps: v.pps, scrollTime: Math.max(0, v.scrollTime + delta) })
      } else {
        const x = e.clientX - ruler.getBoundingClientRect().left
        const anchor = v.scrollTime + x / v.pps
        const pps = Math.min(MAX_PPS, Math.max(MIN_PPS, v.pps * Math.exp(-e.deltaY * 0.002)))
        setView({ pps, scrollTime: Math.max(0, anchor - x / pps) })
      }
    }
    grid.addEventListener('wheel', onWheel, { passive: false })
    return () => grid.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the playhead in view while playing: page forward near the right edge, jump back on loop.
  useEffect(() => {
    if (!playing || width === 0) return
    const v = viewRef.current
    const visible = width / v.pps
    if (time > v.scrollTime + visible * 0.95) setView({ pps: v.pps, scrollTime: time - visible * 0.1 })
    else if (time < v.scrollTime) setView({ pps: v.pps, scrollTime: Math.max(0, time - visible * 0.1) })
  }, [time, playing, width])

  const xAt = (seconds: number): number => (seconds - view.scrollTime) * view.pps

  const capture = (el: HTMLElement, pointerId: number, onMove: (ev: PointerEvent) => void, onEnd?: (ev: PointerEvent) => void) => {
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // No active pointer with that id, for example a synthetic event. Dragging still works.
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      onEnd?.(ev)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  /** Raw time under a pointer position, not snapped. */
  const rawTimeAt = (clientX: number): number => {
    const ruler = rulerRef.current
    if (!ruler) return 0
    const x = clientX - ruler.getBoundingClientRect().left
    const v = viewRef.current
    return Math.max(0, v.scrollTime + x / v.pps)
  }

  /** Only the ruler moves the playhead (D92). */
  const beginScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const scrub = (clientX: number) => setTime(snapToFrame(rawTimeAt(clientX), fps))
    scrub(e.clientX)
    capture(e.currentTarget, e.pointerId, (ev) => scrub(ev.clientX))
  }

  /** Clicking a row anywhere selects its object; Ctrl adds or removes it. */
  const selectRow = (name: string) => (e: ReactPointerEvent | ReactMouseEvent) => {
    if ('button' in e && e.button !== 0) return
    if (e.ctrlKey || e.metaKey) toggleSelected(name)
    else select([name])
  }

  /** Whether a block's start and end may be dragged: a written time reference is left alone. */
  const timingLocks = (stmt: NonNullable<Action['stmt']>, mode: ClipMode | 'start' | 'end'): boolean => {
    const atProp = stmt.props.find((p) => p.key === 'at')
    const untilProp = stmt.props.find((p) => p.key === 'until')
    if (atProp && atProp.kind !== 'literal' && mode !== 'end') return true
    if (untilProp && mode !== 'move') return true
    return false
  }

  /**
   * Drag a clip by its body or an edge. A clip from a class action first becomes the object's
   * own override, which is what then moves (D80).
   */
  const beginClipDrag = (obj: SceneObject, index: number, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (!action?.stmt || !canEdit() || timingLocks(action.stmt, mode)) return
    const origin = { x: e.clientX, start: action.start, end: action.end, pps: viewRef.current.pps, delay: action.timing.delay ?? 0 }
    const minimum = 1 / fps
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    let target: number | null = action.classAction ? null : index
    capture(e.currentTarget, e.pointerId, (ev) => {
      if (target === null) target = ownAction(obj.name, index)
      if (target === null) return
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const start = snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn)
        setActionTiming(obj.name, target, { at: start - origin.delay })
      } else if (mode === 'end') {
        const end = Math.max(origin.start + minimum, snapTime(origin.end + dt, currentModel, action, origin.pps, snapOn))
        setActionTiming(obj.name, target, { duration: end - origin.start })
      } else {
        const start = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn))
        setActionTiming(obj.name, target, { at: start - origin.delay, duration: origin.end - start })
      }
    })
  }

  /** Drag a class action's clip: the one statement every member follows moves. */
  const beginClassClipDrag = (classAction: ClassAction, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectClassAction(classAction)
    const span = classSpan(classAction)
    if (!classAction.stmt || !span || !canEdit() || timingLocks(classAction.stmt, mode)) return
    const origin = { x: e.clientX, start: span.start, end: span.end, pps: viewRef.current.pps, delay: activeMembers(classAction)[0]?.timing.delay ?? 0 }
    const minimum = 1 / fps
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    capture(e.currentTarget, e.pointerId, (ev) => {
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const start = snapTime(origin.start + dt, currentModel, classAction, origin.pps, snapOn)
        setClassActionTiming(classAction.id, { at: start - origin.delay })
      } else if (mode === 'end') {
        const end = Math.max(origin.start + minimum, snapTime(origin.end + dt, currentModel, classAction, origin.pps, snapOn))
        setClassActionTiming(classAction.id, { duration: end - origin.start })
      } else {
        const start = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, classAction, origin.pps, snapOn))
        setClassActionTiming(classAction.id, { at: start - origin.delay, duration: origin.end - start })
      }
    })
  }

  /**
   * Opacity handles (D83): the start handle slides the fade in time; the end handle sets how
   * long it takes sideways and the opacity it reaches up and down.
   */
  const beginFadeDrag = (obj: SceneObject, index: number, part: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (!action?.stmt || !canEdit() || timingLocks(action.stmt, part)) return
    const written = action.changes['opacity']
    const origin = { x: e.clientX, y: e.clientY, start: action.start, end: action.end, delay: action.timing.delay ?? 0, value: typeof written === 'number' ? written : 1, pps: viewRef.current.pps }
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    let target: number | null = action.classAction ? null : index
    capture(e.currentTarget, e.pointerId, (ev) => {
      if (target === null) target = ownAction(obj.name, index)
      if (target === null) return
      const dt = (ev.clientX - origin.x) / origin.pps
      if (part === 'start') {
        setActionTiming(obj.name, target, { at: snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn) - origin.delay })
      } else {
        const end = Math.max(origin.start, snapTime(origin.end + dt, currentModel, action, origin.pps, snapOn))
        const value = Math.max(0, Math.min(1, origin.value - (ev.clientY - origin.y) / OPACITY_GAIN))
        setActionTiming(obj.name, target, { duration: end - origin.start })
        setActionValues(obj.name, target, { opacity: value })
      }
    })
  }

  /** The same handles on a class row edit the class fade for every member (D93). */
  const beginClassFadeDrag = (classAction: ClassAction, part: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectClassAction(classAction)
    const span = classSpan(classAction)
    const member = activeMembers(classAction)[0]
    if (!classAction.stmt || !span || !member || !canEdit() || timingLocks(classAction.stmt, part)) return
    const written = member.changes['opacity']
    const origin = { x: e.clientX, y: e.clientY, start: span.start, end: span.end, delay: member.timing.delay ?? 0, value: typeof written === 'number' ? written : 1, pps: viewRef.current.pps }
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    capture(e.currentTarget, e.pointerId, (ev) => {
      const dt = (ev.clientX - origin.x) / origin.pps
      if (part === 'start') {
        setClassActionTiming(classAction.id, { at: snapTime(origin.start + dt, currentModel, classAction, origin.pps, snapOn) - origin.delay })
      } else {
        const end = Math.max(origin.start, snapTime(origin.end + dt, currentModel, classAction, origin.pps, snapOn))
        const value = Math.max(0, Math.min(1, origin.value - (ev.clientY - origin.y) / OPACITY_GAIN))
        setClassActionTiming(classAction.id, { duration: end - origin.start })
        setClassActionValues(classAction.id, { opacity: value })
      }
    })
  }

  /** Drag the end-of-content marker to set the hold after the last action (D54). */
  const beginHoldDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const lastEnd = model?.lastActionEnd ?? 0
    capture(e.currentTarget, e.pointerId, (ev) => {
      const end = snapTime(rawTimeAt(ev.clientX), model, null, viewRef.current.pps, useStore.getState().snap)
      updateSettings({ hold: Math.max(0, roundSeconds(end - lastEnd)) })
    })
  }

  /** Where a dragged row header would drop: before the object row under the pointer, or after the last. */
  const dropTarget = (clientY: number, dragged: string): { target: { before: string } | { after: string }; lineY: number } | null => {
    const rows = [...(rowsRef.current?.querySelectorAll<HTMLElement>('.tl-row[data-object]') ?? [])].filter((el) => el.dataset['object'] !== dragged)
    if (rows.length === 0) return null
    for (const el of rows) {
      const rect = el.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return { target: { before: el.dataset['object']! }, lineY: rect.top }
    }
    const last = rows[rows.length - 1]!
    return { target: { after: last.dataset['object']! }, lineY: last.getBoundingClientRect().bottom }
  }

  /** Dragging a row header up or down moves the object's declaration, which is the row and drawing order (D92). */
  const beginReorder = (obj: SceneObject) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !obj.decl || !canEdit()) return
    const startY = e.clientY
    let started = false
    capture(
      e.currentTarget,
      e.pointerId,
      (ev) => {
        if (!started && Math.abs(ev.clientY - startY) < 4) return
        started = true
        const drop = dropTarget(ev.clientY, obj.name)
        setReorder(drop ? { name: obj.name, lineY: drop.lineY } : null)
      },
      (ev) => {
        if (!started) return
        skipClickRef.current = true
        setReorder(null)
        const drop = dropTarget(ev.clientY, obj.name)
        if (drop) moveDeclaration(obj.name, drop.target)
      },
    )
  }

  const headerClick = (name: string) => (e: ReactMouseEvent) => {
    if (skipClickRef.current) {
      skipClickRef.current = false
      return
    }
    selectRow(name)(e)
  }

  const snappedAt = (clientX: number): number => snapTime(rawTimeAt(clientX), model, null, viewRef.current.pps, useStore.getState().snap)

  const objectMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    const s = useStore.getState()
    const targets = s.selection.includes(obj.name) ? s.selection : [obj.name]
    if (!s.selection.includes(obj.name)) select([obj.name])
    const many = targets.length > 1
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      ...(many ? [] : [{ label: 'Rename…', run: () => requestRename({ object: obj.name }) }]),
      { label: 'Classes…', run: () => requestClasses(targets) },
      { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
      { label: many ? `Delete ${targets.length} objects` : 'Delete object', run: () => deleteObjects(targets), danger: true },
    ])
  }

  const classMenu = (group: ClassGroup) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: 'Select members', run: () => selectClass(group.className) },
    ])
  }

  const clipMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (action?.classAction) {
      const classAction = action.classAction
      if (action.overridden) {
        const override = overrideOf(obj, classAction)
        showMenu(e, [
          { label: 'Jump to the override', run: () => selectAction(obj.name, override) },
          { label: 'Remove the override', run: () => deleteAction(obj.name, override), danger: true },
        ])
        return
      }
      showMenu(e, [
        { label: `Override for ${obj.name}`, run: () => overrideClassAction(obj.name, index) },
        { label: 'Copy as own action', run: () => materializeClassAction(obj.name, index) },
        { label: 'Jump to class code', run: () => jumpToAction(obj.name, index) },
        { label: `Remove ${obj.name} from ${classAction.className}`, run: () => removeFromClass(obj.name, classAction.className) },
        { label: 'Delete for every member', run: () => deleteAction(obj.name, index), danger: true },
      ])
      return
    }
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: action?.name ? 'Rename…' : 'Name…', run: () => requestRename({ object: obj.name, index }) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classClipMenu = (group: ClassGroup, classAction: ClassAction) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClassAction(classAction)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: classAction.name ? 'Rename…' : 'Name…', run: () => requestRename({ classAction: classAction.id }) },
      { label: 'Delete for every member', run: () => deleteClassAction(classAction.id), danger: true },
    ])
  }

  /** Right-click on empty track space: add an action of a kind at that time, or appear or disappear there. */
  const trackMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    if (!canEdit() || obj.codeDriven) return
    select([obj.name])
    const t = snappedAt(e.clientX)
    const label = timecode(t, fps)
    showMenu(e, [
      ...VERBS.map((verb) => ({ label: `Add ${verb} at ${label}`, run: () => addAction(obj.name, verb, t) })),
      { label: `Fade in at ${label}`, run: () => appearHere(obj.name, t) },
      { label: `Pop in at ${label}`, run: () => appearHere(obj.name, t, true) },
      { label: `Fade out at ${label}`, run: () => disappearHere(obj.name, t) },
      { label: `Pop out at ${label}`, run: () => disappearHere(obj.name, t, true) },
    ])
  }

  /** Right-click on a class's track: add an action for every member at that time. */
  const classTrackMenu = (group: ClassGroup) => (e: ReactMouseEvent) => {
    if (!canEdit() || group.members.length === 0) return
    selectClass(group.className)
    const t = snappedAt(e.clientX)
    const label = timecode(t, fps)
    showMenu(e, [
      ...VERBS.map((verb) => ({ label: `Add ${verb} for all at ${label}`, run: () => addClassAction(group.className, verb, t) })),
      { label: `Fade all in at ${label}`, run: () => appearClassHere(group.className, t) },
      { label: `Fade all out at ${label}`, run: () => disappearClassHere(group.className, t) },
    ])
  }

  /** Right-click below the rows: add an object at the frame center. */
  const blankMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.tl-rows, .empty') || !canEdit()) return
    showMenu(
      e,
      TOOLS.map((t) => ({ label: `Add ${t}`, run: () => addObject(t, 0, 0) })),
    )
  }

  /** Double-click on an opacity lane: the object stops existing here, or starts to (D83). */
  const toggleExistence = (obj: SceneObject) => (e: ReactMouseEvent) => {
    if (!model || !canEdit() || obj.codeDriven) return
    if (e.target instanceof Element && e.target.closest('.opacity-handle')) return
    const t = snappedAt(e.clientX)
    if (isVisibleAt(model, obj, t)) disappearHere(obj.name, t)
    else appearHere(obj.name, t)
  }

  const toggleClassExistence = (group: ClassGroup, standIn: SceneObject) => (e: ReactMouseEvent) => {
    if (!model || !canEdit()) return
    if (e.target instanceof Element && e.target.closest('.opacity-handle')) return
    const t = snappedAt(e.clientX)
    if (isVisibleAt(model, standIn, t)) disappearClassHere(group.className, t)
    else appearClassHere(group.className, t)
  }

  const step = tickStep(view.pps, fps)
  const firstTick = Math.floor(view.scrollTime / step)
  const tickCount = width > 0 ? Math.ceil(width / (step * view.pps)) + 2 : 0
  const ticks = Array.from({ length: tickCount }, (_, i) => (firstTick + i) * step)
  const selectedRef = selectedAction && model ? model.objects.find((o) => o.name === selectedAction.object)?.actions[selectedAction.index] : undefined
  const groups = useMemo(() => (model ? classGroups(model) : []), [model])
  const standIns = useMemo(() => groups.map((g, i) => classStandIn(g, i)), [groups])

  const rows: Row[] = []
  if (model) {
    groups.forEach((group, index) => {
      rows.push({ kind: 'class', group, index })
      if (!collapsed[classKey(group.className)]) for (const obj of group.members) rows.push({ kind: 'object', obj, member: true })
    })
    for (const obj of model.objects) rows.push({ kind: 'object', obj, member: false })
  }

  const opacityY = (value: unknown): number => OPACITY_H - 1 - Math.max(0, Math.min(1, typeof value === 'number' ? value : 0)) * (OPACITY_H - 3)
  const playheadX = xAt(time)
  const playheadVisible = width > 0 && playheadX >= 0 && playheadX <= width

  const renderObjectRow = (obj: SceneObject, member: boolean) => {
    const selected = selection.includes(obj.name)
    const { lanes, count } = assignLanes(obj.actions)
    const rowHeight = 6 + count * LANE_H + OPACITY_H
    return (
      <div key={`${member ? 'm:' : ''}${obj.name}`} className={`tl-row${selected ? ' selected' : ''}${member ? ' member' : ''}${reorder?.name === obj.name ? ' dragging' : ''}`} style={{ height: rowHeight }} data-object={obj.name}>
        <div
          className="tl-row-header"
          onPointerDown={beginReorder(obj)}
          onClick={headerClick(obj.name)}
          onDoubleClick={() => jumpToObject(obj.name)}
          onContextMenu={objectMenu(obj)}
          title="Click to select, double-click to jump to the code, drag up or down to reorder, right-click for more"
        >
          <span className="name">{obj.name}</span>
          <span className="dim">{obj.className}</span>
          {obj.codeDriven && <span className="badge">code</span>}
        </div>
        <div className="tl-track" onPointerDown={selectRow(obj.name)} onContextMenu={trackMenu(obj)}>
          {ticks.map((t) => (
            <div key={t} className="grid-line" style={{ left: xAt(t) }} />
          ))}
          {model && width > 0 && (
            <div className="opacity-slot" style={{ top: 4 + count * LANE_H, height: OPACITY_H }} onDoubleClick={toggleExistence(obj)} title="Opacity. Double-click to appear or disappear here; drag the handles of a fade.">
              <OpacityLane model={model} obj={obj} scrollTime={view.scrollTime} pps={view.pps} width={width} height={OPACITY_H} />
              {editable &&
                !obj.codeDriven &&
                obj.actions.map((action, index) => {
                  if (!('opacity' in action.changes) || !action.stmt || action.codeDriven || action.overridden || typeof action.changes['opacity'] !== 'number') return null
                  const isSelected = selectedAction?.object === obj.name && selectedAction.index === index
                  return [
                    <div key={`s${action.id}`} className={`opacity-handle start${isSelected ? ' selected' : ''}`} style={{ left: xAt(action.start), top: opacityY(valueAt(model, obj, 'opacity', action.start)) }} onPointerDown={beginFadeDrag(obj, index, 'start')} title="Drag sideways to move this fade" />,
                    <div key={`e${action.id}`} className={`opacity-handle end${isSelected ? ' selected' : ''}`} style={{ left: xAt(action.end), top: opacityY(valueAt(model, obj, 'opacity', action.end)) }} onPointerDown={beginFadeDrag(obj, index, 'end')} title="Drag sideways to change how long the fade takes, up or down to change the opacity it reaches" />,
                  ]
                })}
            </div>
          )}
          {obj.actions.map((action, index) => {
            const derived = !!action.classAction
            const locked = action.codeDriven || !action.stmt || !editable || action.overridden
            const isSelected = selectedAction?.object === obj.name && selectedAction.index === index
            const kin = !isSelected && derived && selectedRef?.classAction === action.classAction
            const left = xAt(action.start)
            const clipWidth = Math.max(8, (action.end - action.start) * view.pps)
            const top = 4 + (lanes.get(action.id) ?? 0) * LANE_H
            const span = `${timecode(action.start, fps)} to ${timecode(action.end, fps)}`
            const title = action.overridden
              ? `all('${action.classAction!.className}').${action.verb} is switched off for ${obj.name}: its own action overrides it.`
              : derived
                ? `all('${action.classAction!.className}').${action.verb}  ${span}. Drag to override it for ${obj.name} only.`
                : action.overrides
                  ? `${obj.name}.${action.verb}  ${span}. Overrides ${action.overrides.name} for ${obj.name}.`
                  : `${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}  ${span}`
            return (
              <div
                key={action.id}
                className={`clip${locked ? ' locked' : ''}${derived ? ' derived' : ''}${action.overridden ? ' overridden' : ''}${action.overrides ? ' override' : ''}${isSelected ? ' selected' : ''}${kin ? ' kin' : ''}`}
                style={{ left, top, width: clipWidth, background: VERB_COLORS[action.verb] }}
                onPointerDown={locked ? undefined : beginClipDrag(obj, index, 'move')}
                onContextMenu={action.stmt ? clipMenu(obj, index) : undefined}
                title={title}
              >
                {!locked && <div className="clip-edge left" onPointerDown={beginClipDrag(obj, index, 'start')} />}
                <span className="label">
                  {derived && <span className="ident">{action.classAction!.className}</span>}
                  {action.overrides && <span className="ident override">{'↳'} {action.overrides.name}</span>}
                  {action.name && !derived && <span className="ident">{action.name}</span>}
                  {clipLabel(action)}
                </span>
                {!locked && <div className="clip-edge right" onPointerDown={beginClipDrag(obj, index, 'end')} />}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderClassRow = (group: ClassGroup, groupIndex: number) => {
    const key = classKey(group.className)
    const folded = !!collapsed[key]
    const standIn = standIns[groupIndex] ?? null
    const items = group.actions.flatMap((classAction) => {
      const span = classSpan(classAction)
      return span ? [{ id: classAction.id, start: span.start, end: span.end, classAction }] : []
    })
    const { lanes, count } = assignLanes(items)
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name))
    const selected = allSelected || selectedRef?.classAction?.className === group.className
    return (
      <div key={key} className={`tl-row class-row${selected ? ' selected' : ''}`} style={{ height: 6 + count * LANE_H + OPACITY_H }}>
        <div className="tl-row-header" onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} onContextMenu={classMenu(group)} title="Every object with this class. Click to select them, double-click to jump to the code">
          <button
            className={`chevron${folded ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed(key)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={folded ? 'Show members' : 'Hide members'}
            aria-label={folded ? 'Show members' : 'Hide members'}
            aria-expanded={!folded}
          />
          <span className="name">{group.className}</span>
          <span className="badge">class</span>
          <span className="dim mono">{group.members.length}</span>
        </div>
        <div
          className="tl-track"
          onPointerDown={(e) => {
            if (e.button === 0) selectClass(group.className)
          }}
          onContextMenu={classTrackMenu(group)}
        >
          {ticks.map((t) => (
            <div key={t} className="grid-line" style={{ left: xAt(t) }} />
          ))}
          {model && standIn && width > 0 && (
            <div className="opacity-slot" style={{ top: 4 + count * LANE_H, height: OPACITY_H }} onDoubleClick={toggleClassExistence(group, standIn)} title="Opacity from the class's fades, for every member. Double-click to fade all in or out here; drag the handles of a fade.">
              <OpacityLane model={model} obj={standIn} scrollTime={view.scrollTime} pps={view.pps} width={width} height={OPACITY_H} />
              {editable &&
                group.actions.map((classAction) => {
                  const member = activeMembers(classAction)[0]
                  const span = classSpan(classAction)
                  if (!member || !span || !classAction.stmt || !('opacity' in member.changes) || typeof member.changes['opacity'] !== 'number') return null
                  const isSelected = selectedRef?.classAction === classAction
                  return [
                    <div key={`s${classAction.id}`} className={`opacity-handle start${isSelected ? ' selected' : ''}`} style={{ left: xAt(span.start), top: opacityY(valueAt(model, standIn, 'opacity', span.start)) }} onPointerDown={beginClassFadeDrag(classAction, 'start')} title="Drag sideways to move this fade for every member" />,
                    <div key={`e${classAction.id}`} className={`opacity-handle end${isSelected ? ' selected' : ''}`} style={{ left: xAt(span.end), top: opacityY(valueAt(model, standIn, 'opacity', span.end)) }} onPointerDown={beginClassFadeDrag(classAction, 'end')} title="Drag sideways to change how long the fade takes, up or down to change the opacity it reaches, for every member" />,
                  ]
                })}
            </div>
          )}
          {items.map((item) => {
            const { classAction } = item
            const locked = !classAction.stmt || !editable
            const isSelected = selectedRef?.classAction === classAction
            return (
              <div
                key={item.id}
                className={`clip${locked ? ' locked' : ''}${isSelected ? ' selected' : ''}`}
                style={{ left: xAt(item.start), top: 4 + (lanes.get(item.id) ?? 0) * LANE_H, width: Math.max(8, (item.end - item.start) * view.pps), background: VERB_COLORS[classAction.verb] }}
                onPointerDown={locked ? undefined : beginClassClipDrag(classAction, 'move')}
                onContextMenu={classAction.stmt ? classClipMenu(group, classAction) : undefined}
                title={`${classAction.name ? `${classAction.name} = ` : ''}all('${group.className}').${classAction.verb}  ${timecode(item.start, fps)} to ${timecode(item.end, fps)}, for every member`}
              >
                {!locked && <div className="clip-edge left" onPointerDown={beginClassClipDrag(classAction, 'start')} />}
                <span className="label">
                  <span className="ident">all</span>
                  {classAction.name && <span className="ident">{classAction.name}</span>}
                  {classAction.verb}
                </span>
                {!locked && <div className="clip-edge right" onPointerDown={beginClassClipDrag(classAction, 'end')} />}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="timeline">
      <div className="transport">
        <button
          className="transport-button"
          onClick={(e) => {
            setPlaying(false)
            setTime(0)
            e.currentTarget.blur()
          }}
          title="Return to start (Home)"
          aria-label="Return to start"
        >
          {'⏮'}
        </button>
        <button
          className="transport-button play"
          onClick={(e) => {
            togglePlaying()
            // Release focus so that space keeps toggling through the app shortcut, not the button.
            e.currentTarget.blur()
          }}
          title="Play or pause (space)"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className="transport-button"
          disabled={contentEnd === null}
          onClick={(e) => {
            if (contentEnd !== null) {
              setPlaying(false)
              setTime(contentEnd)
            }
            e.currentTarget.blur()
          }}
          title="Jump to the end of the content (End)"
          aria-label="Jump to end"
        >
          {'⏭'}
        </button>
        <button
          className={`transport-button${loop ? ' on' : ''}`}
          onClick={(e) => {
            toggleLoop()
            e.currentTarget.blur()
          }}
          title={loop ? 'Looping at the end. Click to stop at the end instead.' : 'Stopping at the end. Click to loop.'}
          aria-label="Loop"
          aria-pressed={loop}
        >
          {'↻'}
        </button>
        <button
          className={`transport-button text${snap ? ' on' : ''}`}
          onClick={(e) => {
            toggleSnap()
            e.currentTarget.blur()
          }}
          title={snap ? 'Drags snap to whole seconds and to other actions. Click for free placement.' : 'Drags place freely. Click to snap to whole seconds and to other actions.'}
          aria-label="Snap"
          aria-pressed={snap}
        >
          Snap
        </button>
        <span className="time mono">{formatTime(time, fps)}</span>
        <span className="dim">
          {fps} fps{contentEnd !== null ? `, ends at ${timecode(contentEnd, fps)}` : ''}
          {hold > 0 ? ` (hold ${roundSeconds(hold)}s)` : ''}
          {!editable ? ', code has an error' : ''}
        </span>
      </div>
      <div className="tl-grid" ref={gridRef}>
        <div className="tl-corner" />
        <div className="tl-ruler" ref={rulerRef} onPointerDown={beginScrub} title="Click or drag to move the playhead">
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: xAt(t) }}>
              <span>{tickLabel(t, step, fps)}</span>
            </div>
          ))}
          {contentEnd !== null && (
            <div className="end-marker" style={{ left: xAt(contentEnd) }} onPointerDown={beginHoldDrag} title="End of the content. Drag to hold the final state longer." />
          )}
          {playheadVisible && <div className="playhead head" style={{ left: playheadX }} />}
        </div>
        <div className="tl-body" ref={bodyRef}>
          <div className="tl-rows" ref={rowsRef} onContextMenu={blankMenu}>
            {rows.length === 0 && <div className="empty">No objects yet. Right-click to add one.</div>}
            {rows.map((row) => (row.kind === 'class' ? renderClassRow(row.group, row.index) : renderObjectRow(row.obj, row.member)))}
            <div className="tl-playhead-layer" aria-hidden="true">
              {playheadVisible && <div className="playhead line" style={{ left: playheadX }} />}
            </div>
          </div>
        </div>
        <div className="tl-hscroll">
          {width > 0 && (
            <ScrollBar
              axis="x"
              rangeStart={0}
              rangeEnd={Math.max(contentEnd ?? 0, view.scrollTime + width / view.pps) + (width / view.pps) * 0.25}
              windowStart={view.scrollTime}
              windowEnd={view.scrollTime + width / view.pps}
              onScroll={(start) => setView({ pps: viewRef.current.pps, scrollTime: Math.max(0, start) })}
            />
          )}
        </div>
      </div>
      {reorder && <div className="tl-drop-line" style={{ top: reorder.lineY }} />}
    </div>
  )
}
