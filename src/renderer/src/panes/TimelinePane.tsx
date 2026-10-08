import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { actionIdents, activeMembers, classActionIdents, classKey, classSpan, classStandIn, classTree, overrideOf, type ClassNode } from '../model/groups'
import { VERB_COLORS, VERBS } from '../model/registry'
import { isVisibleAt, valueAt } from '../model/sample'
import type { Action, ClassAction, SceneModel, SceneObject } from '../model/types'
import { updateSettings } from '../project/controller'
import {
  addAction,
  addClassAction,
  addObject,
  adjustDurations,
  appearClassHere,
  appearHere,
  canEdit,
  cutSelection,
  deleteAction,
  deleteClassAction,
  deleteObjects,
  disappearClassHere,
  disappearHere,
  duplicateObjects,
  frameSeconds,
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
  retimeActions,
  roundSeconds,
  selectClass,
  selectClassAction,
  setActionTiming,
  setActionValues,
  setClassActionTiming,
  setClassActionValues,
} from '../project/operations'
import { isActionSelected, useStore, type ActionRef, type Tool } from '../state/store'
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
/** Indent per level of the class tree, in pixels. */
const INDENT = 14
const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']

interface View {
  /** Pixels per second. */
  pps: number
  /** Time at the left edge of the track, in seconds. */
  scrollTime: number
}

/** A row of the timeline: a class with its children and members beneath, or an object (D99). */
type Row = { kind: 'class'; node: ClassNode; standIn: SceneObject | null } | { kind: 'object'; obj: SceneObject; depth: number; twins?: string[] }

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

const Idents = ({ words }: { words: string[] }) => (
  <>
    {words.map((w, i) => (
      <span key={i} className="ident">
        {w}
      </span>
    ))}
  </>
)

/**
 * Transport, ruler, and rows over an open-ended time axis: the class tree, each class with its
 * child classes and members beneath, then the objects in no class, each with its clips in lanes
 * and its opacity below (D99). Only the ruler scrubs (D92). Over the tracks the wheel zooms
 * around the cursor, Shift and the wheel scroll time, Alt and the wheel scroll the rows; over the
 * row headers the wheel scrolls the rows, and dragging a header up or down reorders the objects.
 * Clips drag by the body to move and by the edges to resize; Ctrl-click picks several, and a
 * drag then moves or resizes all of them by the same amount (D97). A clip from a class action is
 * dashed on its members; dragging it, or choosing Override, gives that object its own action in
 * its place and shows the class clip switched off (D80). Opacity lanes, on objects and classes
 * alike, have handles on every fade and toggle existence on a double-click (D83, D93).
 */
export function TimelinePane() {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const loop = useStore((s) => s.loop)
  const snap = useStore((s) => s.snap)
  const wheelStep = useStore((s) => s.wheelStep)
  const fps = useStore((s) => s.settings.fps)
  const hold = useStore((s) => s.settings.hold)
  const contentEnd = useStore((s) => s.contentEnd)
  const model = useStore((s) => s.model)
  const source = useStore((s) => s.source)
  const selection = useStore((s) => s.selection)
  const selectedActions = useStore((s) => s.selectedActions)
  const collapsed = useStore((s) => s.collapsed.timeline)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const toggleSelectedAction = useStore((s) => s.toggleSelectedAction)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const toggleSnap = useStore((s) => s.toggleSnap)
  const setWheelStep = useStore((s) => s.setWheelStep)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTime = useStore((s) => s.setTime)
  const gridRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ pps: DEFAULT_PPS, scrollTime: 0 })
  const [width, setWidth] = useState(0)
  /** A row header being dragged to another place, with where the drop line goes. */
  const [reorder, setReorder] = useState<{ name: string; lineY: number; left: number; width: number } | null>(null)
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
      if (e.shiftKey) {
        // Shift and the wheel lengthen or shorten the selected actions, here as in the preview (D111).
        const s = useStore.getState()
        if (s.selectedActions.length > 0) adjustDurations(s.selectedActions, (-Math.sign(e.deltaY) * s.wheelStep) / s.settings.fps, s.pin)
        return
      }
      const overHeaders = e.clientX < grid.getBoundingClientRect().left + HEADER_W
      if (overHeaders || e.altKey) {
        if (bodyRef.current) bodyRef.current.scrollTop += e.deltaY
      } else if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
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

  /** Clicking a row header selects its object; Ctrl adds or removes it. */
  const selectRow = (name: string) => (e: ReactPointerEvent | ReactMouseEvent) => {
    if ('button' in e && e.button !== 0) return
    if (e.ctrlKey || e.metaKey) toggleSelected(name)
    else select([name])
  }

  /** Clicking empty track space selects nothing, so the arrows go back to scrubbing (D92). */
  const clearSelection = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return
    if (e.target instanceof Element && e.target.closest('.clip, .opacity-handle')) return
    select([])
  }

  /** Whether a block's start and end may be dragged: a written time reference is left alone. */
  const timingLocks = (stmt: NonNullable<Action['stmt']>, mode: ClipMode | 'start' | 'end'): boolean => {
    const atProp = stmt.props.find((p) => p.key === 'at')
    const untilProp = stmt.props.find((p) => p.key === 'until')
    if (atProp && atProp.kind !== 'literal' && mode !== 'end') return true
    if (untilProp && mode !== 'move') return true
    return false
  }

  const snapshotOf = (refs: ActionRef[]): Record<string, { start: number; end: number }> => {
    const out: Record<string, { start: number; end: number }> = {}
    const m = useStore.getState().model
    for (const ref of refs) {
      const action = m?.objects.find((o) => o.name === ref.object)?.actions[ref.index]
      if (action) out[`${ref.object}:${ref.index}`] = { start: action.start, end: action.end }
    }
    return out
  }

  /**
   * Drag a clip by its body or an edge. Every selected clip follows by the same amount (D97). A
   * clip from a class action first becomes the object's own override, which is what then moves
   * (D80).
   */
  const beginClipDrag = (obj: SceneObject, index: number, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = useStore.getState()
    if (e.ctrlKey || e.metaKey) {
      s.toggleSelectedAction(obj.name, index)
      return
    }
    if (!isActionSelected(s.selectedActions, obj.name, index)) selectAction(obj.name, index)
    const action = obj.actions[index]
    if (!action?.stmt || !canEdit() || timingLocks(action.stmt, mode)) return
    const origin = { x: e.clientX, start: action.start, end: action.end, pps: viewRef.current.pps }
    const minimum = frameSeconds(fps)
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    let refs: ActionRef[] | null = action.classAction ? null : useStore.getState().selectedActions
    let snapshot = refs ? snapshotOf(refs) : null
    capture(e.currentTarget, e.pointerId, (ev) => {
      if (!refs) {
        const own = ownAction(obj.name, index)
        if (own === null) return
        refs = [{ object: obj.name, index: own }]
        snapshot = snapshotOf(refs)
      }
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const start = snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn)
        retimeActions(refs, { shift: start - origin.start }, snapshot!)
      } else if (mode === 'end') {
        const end = Math.max(origin.start + minimum, snapTime(origin.end + dt, currentModel, action, origin.pps, snapOn))
        retimeActions(refs, { grow: end - origin.end }, snapshot!)
      } else {
        const start = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn))
        retimeActions(refs, { trimStart: start - origin.start }, snapshot!)
      }
    })
  }

  /** Drag a class action's clip: the one statement every member follows moves. */
  const beginClassClipDrag = (classAction: ClassAction, mode: ClipMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const ref = activeMembers(classAction)[0]
    if (e.ctrlKey || e.metaKey) {
      if (ref) toggleSelectedAction(ref.object.name, ref.object.actions.indexOf(ref))
      return
    }
    selectClassAction(classAction)
    const span = classSpan(classAction)
    if (!classAction.stmt || !span || !canEdit() || timingLocks(classAction.stmt, mode)) return
    const origin = { x: e.clientX, start: span.start, end: span.end, pps: viewRef.current.pps, delay: ref?.timing.delay ?? 0 }
    const minimum = frameSeconds(fps)
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
        const rect = rowsRef.current?.getBoundingClientRect()
        setReorder(drop && rect ? { name: obj.name, lineY: drop.lineY, left: rect.left, width: rect.width } : null)
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

  const classMenu = (node: ClassNode) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(node.group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(node.group.className) },
      { label: 'Select members', run: () => selectClass(node.group.className) },
    ])
  }

  const clipMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!isActionSelected(useStore.getState().selectedActions, obj.name, index)) selectAction(obj.name, index)
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
      { label: 'Cut', run: () => cutSelection() },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classClipMenu = (node: ClassNode, classAction: ClassAction) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClassAction(classAction)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(node.group.className) },
      { label: classAction.name ? 'Rename…' : 'Name…', run: () => requestRename({ classAction: classAction.id }) },
      { label: 'Delete for every member', run: () => deleteClassAction(classAction.id), danger: true },
    ])
  }

  /** Right-click on empty track space: add an action of a kind at that time, or appear or disappear there (D100). */
  const trackMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    if (!canEdit() || obj.codeDriven) return
    select([obj.name])
    const t = snappedAt(e.clientX)
    showMenu(
      e,
      VERBS.map((verb) =>
        verb === 'fade'
          ? {
              label: 'Add',
              keyword: verb,
              color: VERB_COLORS[verb],
              run: () => addAction(obj.name, verb, t),
              children: [
                { label: 'Fade in', run: () => appearHere(obj.name, t) },
                { label: 'Pop in', run: () => appearHere(obj.name, t, true) },
                { label: 'Fade out', run: () => disappearHere(obj.name, t) },
                { label: 'Pop out', run: () => disappearHere(obj.name, t, true) },
              ],
            }
          : { label: 'Add', keyword: verb, color: VERB_COLORS[verb], run: () => addAction(obj.name, verb, t) },
      ),
    )
  }

  /** Right-click on a class's track: add an action for every member at that time. */
  const classTrackMenu = (node: ClassNode) => (e: ReactMouseEvent) => {
    if (!canEdit() || node.group.members.length === 0) return
    const className = node.group.className
    selectClass(className)
    const t = snappedAt(e.clientX)
    showMenu(
      e,
      VERBS.map((verb) =>
        verb === 'fade'
          ? {
              label: 'Add for all',
              keyword: verb,
              color: VERB_COLORS[verb],
              run: () => addClassAction(className, verb, t),
              children: [
                { label: 'Fade all in', run: () => appearClassHere(className, t) },
                { label: 'Pop all in', run: () => appearClassHere(className, t, true) },
                { label: 'Fade all out', run: () => disappearClassHere(className, t) },
                { label: 'Pop all out', run: () => disappearClassHere(className, t, true) },
              ],
            }
          : { label: 'Add for all', keyword: verb, color: VERB_COLORS[verb], run: () => addClassAction(className, verb, t) },
      ),
    )
  }

  /** Right-click below the rows: add an object at the frame center. */
  const blankMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.tl-rows, .empty') || !canEdit()) return
    showMenu(
      e,
      TOOLS.map((t) => ({ label: 'Add', keyword: t, run: () => addObject(t, 0, 0) })),
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

  const toggleClassExistence = (className: string, standIn: SceneObject) => (e: ReactMouseEvent) => {
    if (!model || !canEdit()) return
    if (e.target instanceof Element && e.target.closest('.opacity-handle')) return
    const t = snappedAt(e.clientX)
    if (isVisibleAt(model, standIn, t)) disappearClassHere(className, t)
    else appearClassHere(className, t)
  }

  const step = tickStep(view.pps, fps)
  const firstTick = Math.floor(view.scrollTime / step)
  const tickCount = width > 0 ? Math.ceil(width / (step * view.pps)) + 2 : 0
  const ticks = Array.from({ length: tickCount }, (_, i) => (firstTick + i) * step)
  const selectedClassActions = useMemo(() => {
    const set = new Set<ClassAction>()
    if (!model) return set
    for (const ref of selectedActions) {
      const action = model.objects.find((o) => o.name === ref.object)?.actions[ref.index]
      if (action?.classAction) set.add(action.classAction)
    }
    return set
  }, [model, selectedActions])
  const tree = useMemo(() => (model ? classTree(model) : null), [model])
  const standIns = useMemo(() => {
    const out = new Map<string, SceneObject | null>()
    const walk = (node: ClassNode) => {
      out.set(node.group.className, classStandIn(node.group, out.size))
      node.children.forEach(walk)
    }
    tree?.roots.forEach(walk)
    return out
  }, [tree])

  const rows: Row[] = []
  if (tree) {
    const build = (node: ClassNode) => {
      rows.push({ kind: 'class', node, standIn: standIns.get(node.group.className) ?? null })
      if (collapsed[classKey(node.group.className)]) return
      for (const child of node.children) build(child)
      for (const obj of node.objects) rows.push({ kind: 'object', obj, depth: node.depth + 1, twins: tree.twins.get(obj.name) })
    }
    tree.roots.forEach(build)
    for (const obj of tree.objects) rows.push({ kind: 'object', obj, depth: 0 })
  }

  const opacityY = (value: unknown): number => OPACITY_H - 1 - Math.max(0, Math.min(1, typeof value === 'number' ? value : 0)) * (OPACITY_H - 3)
  const playheadX = xAt(time)
  const playheadVisible = width > 0 && playheadX >= 0 && playheadX <= width

  const renderObjectRow = (obj: SceneObject, depth: number, twins?: string[], place?: string) => {
    const selected = selection.includes(obj.name)
    const { lanes, count } = assignLanes(obj.actions)
    const rowHeight = 6 + count * LANE_H + OPACITY_H
    const elsewhere = twins?.filter((c) => c !== place) ?? []
    return (
      <div key={`${place ?? ''}:${obj.name}`} className={`tl-row${selected ? ' selected' : ''}${reorder?.name === obj.name ? ' dragging' : ''}${elsewhere.length > 0 ? ' twin' : ''}`} style={{ height: rowHeight }} data-object={obj.name}>
        <div
          className="tl-row-header"
          style={{ paddingLeft: 10 + depth * INDENT }}
          onPointerDown={beginReorder(obj)}
          onClick={headerClick(obj.name)}
          onDoubleClick={() => jumpToObject(obj.name)}
          onContextMenu={objectMenu(obj)}
          title="Click to select, double-click to jump to the code, drag up or down to reorder, right-click for more"
        >
          <span className="name">{obj.name}</span>
          <span className="dim">{obj.className}</span>
          {obj.codeDriven && <span className="badge">code</span>}
          {elsewhere.length > 0 && (
            <span className="badge twin" title={`The same object, also listed under ${elsewhere.join(' and ')} (D107).`}>
              {'\u29C9'} {elsewhere.join(', ')}
            </span>
          )}
        </div>
        <div className="tl-track" onPointerDown={clearSelection} onContextMenu={trackMenu(obj)}>
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
                  const isSelected = isActionSelected(selectedActions, obj.name, index)
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
            const isSelected = isActionSelected(selectedActions, obj.name, index)
            const kin = !isSelected && derived && selectedClassActions.has(action.classAction!)
            const left = xAt(action.start)
            const clipWidth = Math.max(8, (action.end - action.start) * view.pps)
            const top = 4 + (lanes.get(action.id) ?? 0) * LANE_H
            const span = `${timecode(action.start, fps)} to ${timecode(action.end, fps)}`
            const title = action.overridden
              ? `all('${action.classAction!.className}').${action.verb} is switched off for ${obj.name}: its own action overrides it.`
              : derived
                ? `all('${action.classAction!.className}').${action.verb}  ${span}. Drag to override it for ${obj.name} only. Ctrl-click to add it to the selection.`
                : action.overrides
                  ? `${obj.name}.${action.verb}  ${span}. Overrides ${action.overrides.name} for ${obj.name}.`
                  : `${action.name ? `${action.name} = ` : ''}${obj.name}.${action.verb}  ${span}. Ctrl-click to add it to the selection.`
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
                  <Idents words={actionIdents(action)} />
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

  const renderClassRow = (node: ClassNode, standIn: SceneObject | null) => {
    const { group, depth } = node
    const key = classKey(group.className)
    const folded = !!collapsed[key]
    const items = group.actions.flatMap((classAction) => {
      const span = classSpan(classAction)
      return span ? [{ id: classAction.id, start: span.start, end: span.end, classAction }] : []
    })
    const { lanes, count } = assignLanes(items)
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name))
    const selected = allSelected || group.actions.some((a) => selectedClassActions.has(a))
    return (
      <div key={key} className={`tl-row class-row${selected ? ' selected' : ''}`} style={{ height: 6 + count * LANE_H + OPACITY_H }}>
        <div className="tl-row-header" style={{ paddingLeft: 10 + depth * INDENT }} onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} onContextMenu={classMenu(node)} title="Every object with this class. Click to select them, double-click to jump to the code">
          <button
            className={`chevron${folded ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed('timeline', key)
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
        <div className="tl-track" onPointerDown={clearSelection} onContextMenu={classTrackMenu(node)}>
          {ticks.map((t) => (
            <div key={t} className="grid-line" style={{ left: xAt(t) }} />
          ))}
          {model && standIn && width > 0 && (
            <div className="opacity-slot" style={{ top: 4 + count * LANE_H, height: OPACITY_H }} onDoubleClick={toggleClassExistence(group.className, standIn)} title="Opacity from the class's fades, for every member. Double-click to fade all in or out here; drag the handles of a fade.">
              <OpacityLane model={model} obj={standIn} scrollTime={view.scrollTime} pps={view.pps} width={width} height={OPACITY_H} />
              {editable &&
                group.actions.map((classAction) => {
                  const member = activeMembers(classAction)[0]
                  const span = classSpan(classAction)
                  if (!member || !span || !classAction.stmt || !('opacity' in member.changes) || typeof member.changes['opacity'] !== 'number') return null
                  const isSelected = selectedClassActions.has(classAction)
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
            const isSelected = selectedClassActions.has(classAction)
            return (
              <div
                key={item.id}
                className={`clip${locked ? ' locked' : ''}${isSelected ? ' selected' : ''}`}
                style={{ left: xAt(item.start), top: 4 + (lanes.get(item.id) ?? 0) * LANE_H, width: Math.max(8, (item.end - item.start) * view.pps), background: VERB_COLORS[classAction.verb] }}
                onPointerDown={locked ? undefined : beginClassClipDrag(classAction, 'move')}
                onContextMenu={classAction.stmt ? classClipMenu(node, classAction) : undefined}
                title={`${classAction.name ? `${classAction.name} = ` : ''}all('${group.className}').${classAction.verb}  ${timecode(item.start, fps)} to ${timecode(item.end, fps)}, for every member`}
              >
                {!locked && <div className="clip-edge left" onPointerDown={beginClassClipDrag(classAction, 'start')} />}
                <span className="label">
                  <Idents words={classActionIdents(classAction)} />
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
        <NumberField label="Frames per wheel tick when Shift-scrolling over an object in the preview, lengthening or shortening the selected actions" value={wheelStep} unit="f" onChange={setWheelStep} />
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
            {rows.map((row, i) => (row.kind === 'class' ? renderClassRow(row.node, row.standIn) : renderObjectRow(row.obj, row.depth, row.twins, rows.slice(0, i).filter((r): r is Extract<Row, { kind: 'class' }> => r.kind === 'class').pop()?.node.group.className)))}
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
      {reorder && <div className="tl-drop-line" style={{ top: reorder.lineY, left: reorder.left, width: reorder.width }} />}
    </div>
  )
}
