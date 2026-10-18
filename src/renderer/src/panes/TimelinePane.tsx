import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { showMenu } from '../components/ContextMenu'
import { LinkIcon } from '../components/LinkIcon'
import { NumberField } from '../components/NumberField'
import { ScrollBar } from '../components/ScrollBar'
import { beginGesture, endGesture } from '../code/editor'
import { actionIdents, activeMembers, classActionIdents, classKey, classSpan, classStandIn, classTree, groupMembers, overrideOf, type ClassNode } from '../model/groups'
import { attrSchema, GROUP, labelOn, PIVOT_PARAMS, VERB_ATTRS, VERB_COLORS, VERBS } from '../model/registry'
import { actionLinks, classActionLinks, dependentsByTarget, objectLinks, targetKey, type LinkInfo } from '../model/links'
import { containers, isVisibleAt, valueAt } from '../model/sample'
import type { Action, ClassAction, SceneModel, SceneObject } from '../model/types'
import {
  addAction,
  addClassAction,
  addObject,
  adjustDurations,
  appearClassHere,
  appearHere,
  canEdit,
  deleteAction,
  deleteClass,
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
  moveAction,
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
  ungroup,
  setAttrsAt,
  setAttrsAtMany,
  placeObject,
  setLifetime,
  type LifetimeOrigin,
} from '../project/operations'
import { requestSavePreset } from '../project/userPresets'
import { dropTargets } from '../state/dropTargets'
import { isActionSelected, OBJECT_KINDS, useStore, type ActionRef } from '../state/store'
import { formatTime, snapToFrame, timecode } from '../state/time'

/** Zoom limits in pixels per second. At the top, single frames at 60 fps sit about 65 px apart. */
const MIN_PPS = 4
const MAX_PPS = 8000
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
/** Height of the title bar of an object's clip in the objects view. */
const CLIP_TITLE_H = 16
/** Height of the strip of thin lines a collapsed clip shows its animations in, and of one line. */
const THIN_STRIP_H = 10
const THIN_H = 3
/** Pixels of vertical drag on an opacity handle for the whole 0 to 1 range. */
const OPACITY_GAIN = 40
/** How close a drag must come to a snap target, in pixels. */
const SNAP_PX = 10
/** With snapping on and no edge in reach, a drag lands on every fifth frame, as the playhead does (D128, D185). */
const SNAP_FRAMES = 5

interface View {
  /** Pixels per second. */
  pps: number
  /** Time at the left edge of the track, in seconds. */
  scrollTime: number
}


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

/** How a link's key reads in a tooltip: the times by their names, anything else as is (D230). */
export function linkWord(key: string): string {
  return key === 'at' ? 'start' : key === 'until' ? 'end' : key
}

function clipLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).filter((k) => !(PIVOT_PARAMS as readonly string[]).includes(k)).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}

/**
 * Overlapping animations stack the way clips do (D152, D210): in file order, each goes one level
 * above the highest of the earlier ones it overlaps in time, level 0 at the bottom; the lane
 * returned counts from the top, so the highest level is drawn highest, and that one has the say
 * while it runs. Animations that never share a moment are not stacked.
 */
function assignLanes<T extends { id: number; start: number; end: number }>(items: T[]): { lanes: Map<number, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.id - b.id)
  const levels = new Map<number, number>()
  let highest = 0
  for (const item of sorted) {
    let level = 0
    for (const other of sorted) {
      if (other === item) break
      if (other.end > item.start && other.start < item.end) level = Math.max(level, (levels.get(other.id) ?? 0) + 1)
    }
    levels.set(item.id, level)
    highest = Math.max(highest, level)
  }
  const count = highest + 1
  const lanes = new Map<number, number>()
  for (const [id, level] of levels) lanes.set(id, count - 1 - level)
  return { lanes, count }
}

/**
 * Snap a dragged time when snapping is on (D64, D179): to whole seconds, the playhead, the content
 * end, the starts and ends of other actions, and where other objects begin and are removed, within
 * reach; `hit` is the target it landed on, for the guide line. Otherwise the time lands on a
 * frame when frame snapping is on (D119), else stays exact to the millisecond.
 */
function snapTimeInfo(raw: number, model: SceneModel | null, exclude: Action | ClassAction | SceneObject | null, pps: number, snap: boolean): { time: number; hit: number | null } {
  const { frameSnap, settings } = useStore.getState()
  const toFrames = (t: number) => (frameSnap ? Math.round(t * settings.fps) / settings.fps : t)
  if (!snap) return { time: Math.max(0, roundSeconds(toFrames(raw))), hit: null }
  const threshold = SNAP_PX / pps
  // Edges: whole seconds, the starts and ends of other animations, and where other objects begin and are removed.
  const candidates = [0, Math.floor(raw), Math.ceil(raw)]
  if (model) {
    // An object being dragged in time does not snap to its own animations or its own ends, which move with it (D152).
    for (const action of model.actions) if (!action.overridden && action !== exclude && action.classAction !== exclude && action.object !== exclude) candidates.push(action.start, action.end)
    for (const obj of model.objects) {
      if (obj === exclude || obj.className === GROUP) continue
      candidates.push(obj.at)
      if (obj.until !== null) candidates.push(obj.until)
    }
  }
  let best: number | null = null
  let bestDistance = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - raw)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  if (best !== null) return { time: Math.max(0, roundSeconds(best)), hit: best }
  // Nothing in reach: every fifth frame, as the ruler does.
  const grid = SNAP_FRAMES / settings.fps
  return { time: Math.max(0, roundSeconds(Math.round(raw / grid) * grid)), hit: null }
}

function snapTime(raw: number, model: SceneModel | null, exclude: Action | ClassAction | SceneObject | null, pps: number, snap: boolean): number {
  return snapTimeInfo(raw, model, exclude, pps, snap).time
}

/**
 * Snap a span by whichever of its ends comes nearer a target (D179): the start it gets, and the
 * target hit, if any, for the guide line.
 */
function snapSpan(rawStart: number, duration: number, model: SceneModel | null, exclude: Action | ClassAction | SceneObject | null, pps: number, snap: boolean): { start: number; hit: number | null } {
  const a = snapTimeInfo(rawStart, model, exclude, pps, snap)
  const b = snapTimeInfo(rawStart + duration, model, exclude, pps, snap)
  if (b.hit !== null && (a.hit === null || Math.abs(b.time - (rawStart + duration)) < Math.abs(a.time - rawStart))) return { start: Math.max(0, roundSeconds(b.time - duration)), hit: b.hit }
  return { start: a.time, hit: a.hit }
}

/**
 * Where the playhead lands when the ruler is clicked or scrubbed (D128): with snapping on, on a
 * whole second or an action's start or end within reach, else on the nearest fifth frame; with
 * it off, on the nearest frame.
 */
function snapPlayhead(raw: number, model: SceneModel | null, pps: number, snap: boolean): number {
  const { fps } = useStore.getState().settings
  if (!snap) return Math.max(0, snapToFrame(raw, fps))
  const threshold = SNAP_PX / pps
  const candidates = [0, Math.floor(raw), Math.ceil(raw)]
  if (model) for (const action of model.actions) if (!action.overridden) candidates.push(action.start, action.end)
  let best: number | null = null
  let bestDistance = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - raw)
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return Math.max(0, best ?? Math.round((raw * fps) / 5) * (5 / fps))
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
 * Transport, ruler, and lanes over an open-ended time axis: Objects, Groups, and Classes, like
 * the tracks of a video editor, where each life is a clip with its animations and opacity inside,
 * stacked by drawing order (D139, D152, D164). Only the ruler scrubs (D92). Over the tracks the
 * wheel zooms around the cursor, Shift and the wheel scroll time, Alt and the wheel scroll the
 * lanes. Clips drag by the body to move and by the edges to resize; Ctrl-click picks several, and
 * a drag then moves or resizes all of them by the same amount (D97). A clip from a class action is
 * dashed on its members; dragging it, or choosing Override, gives that object its own action in
 * its place and shows the class clip switched off (D80). Opacity lanes, on objects and classes
 * alike, have handles on every fade and toggle existence on a double-click (D83, D93).
 */
export function TimelinePane() {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const loop = useStore((s) => s.loop)
  const snap = useStore((s) => s.snap)
  const openLinksDialog = useStore((s) => s.openLinksDialog)
  const setHoverTimeline = useStore((s) => s.setHoverTimeline)
  /** The time a drag has snapped to, drawn as a guide line across the lanes while it lasts (D179). */
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const frameSnap = useStore((s) => s.frameSnap)
  const wheelStep = useStore((s) => s.wheelStep)
  const fps = useStore((s) => s.settings.fps)
  const contentEnd = useStore((s) => s.contentEnd)
  const playbackEnd = useStore((s) => s.playbackEnd)
  const model = useStore((s) => s.model)
  const source = useStore((s) => s.source)
  const selection = useStore((s) => s.selection)
  const selectedActions = useStore((s) => s.selectedActions)
  const collapsed = useStore((s) => s.collapsed.timeline)
  const anchored = useStore((s) => s.anchored)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const toggleSelectedAction = useStore((s) => s.toggleSelectedAction)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const setAllCollapsed = useStore((s) => s.setAllCollapsed)
  const togglePlaying = useStore((s) => s.togglePlaying)
  const toggleLoop = useStore((s) => s.toggleLoop)
  const toggleSnap = useStore((s) => s.toggleSnap)
  const toggleFrameSnap = useStore((s) => s.toggleFrameSnap)
  const setWheelStep = useStore((s) => s.setWheelStep)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTime = useStore((s) => s.setTime)
  const gridRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [view, setViewState] = useState<View>({ pps: DEFAULT_PPS, scrollTime: 0 })
  const [width, setWidth] = useState(0)
  /** A clip being dragged up or down in the objects view: it follows the pointer, this far down its track, until let go (D165). */
  const [clipDrag, setClipDrag] = useState<{ name: string; top: number } | null>(null)
  /** An animation being dragged up or down in its clip: it follows the pointer, this far down the clip's lanes, until let go (D210). */
  const [actionDrag, setActionDrag] = useState<{ object: string; index: number; top: number } | null>(null)
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
        if (s.selectedActions.length > 0) {
          adjustDurations(s.selectedActions, (-Math.sign(e.deltaY) * s.wheelStep) / s.settings.fps, s.pin)
          // Shift held with the animation selected: the playhead shows its new end, here as in the preview (D180).
          const after = useStore.getState()
          const primary = after.selectedActions[0]
          const action = primary ? after.model?.objects.find((o) => o.name === primary.object)?.actions[primary.index] : undefined
          if (action) after.setTime(action.end)
        }
        return
      }
      const overHeaders = e.clientX < grid.getBoundingClientRect().left + HEADER_W
      if (overHeaders || e.altKey) {
        if (bodyRef.current) bodyRef.current.scrollTop += e.deltaY
      } else if (!(e.ctrlKey || e.metaKey)) {
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

  /**
   * Like capture, on the window: for a drag whose element may be moved in the DOM meanwhile,
   * which would drop a pointer capture held on it.
   */
  const captureWindow = (pointerId: number, onMove: (ev: PointerEvent) => void, onEnd?: (ev: PointerEvent) => void) => {
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) onMove(ev)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onEnd?.(ev)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** Raw time under a pointer position, not snapped. */
  // Where a dragged preset lands on the timeline (D219): the object whose clip is under the pointer, and the time there, snapped as the playhead is.
  useEffect(() => {
    dropTargets.timeline = (clientX, clientY) => {
      const grid = gridRef.current
      const rect = grid?.getBoundingClientRect()
      const inside = !!rect && clientX >= rect.left + HEADER_W && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      const el = inside ? document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.oclip[data-object]') : null
      const s = useStore.getState()
      const v = viewRef.current
      const ruler = rulerRef.current
      const raw = ruler ? Math.max(0, v.scrollTime + (clientX - ruler.getBoundingClientRect().left) / v.pps) : 0
      return { inside, object: el?.dataset['object'] ?? null, time: snapPlayhead(raw, s.model, v.pps, s.snap), pps: v.pps }
    }
    return () => {
      delete dropTargets.timeline
    }
  }, [])

  const rawTimeAt = (clientX: number): number => {
    const ruler = rulerRef.current
    if (!ruler) return 0
    const x = clientX - ruler.getBoundingClientRect().left
    const v = viewRef.current
    return Math.max(0, v.scrollTime + x / v.pps)
  }

  /** Only the ruler moves the playhead (D92), snapping to seconds, action edges, and fifth frames when snapping is on (D128). */
  const beginScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // The ruler is about time alone: a click on it lets go of whatever was selected (D207).
    select([])
    const scrub = (clientX: number) => {
      const s = useStore.getState()
      setTime(snapPlayhead(rawTimeAt(clientX), s.model, viewRef.current.pps, s.snap))
    }
    scrub(e.clientX)
    capture(e.currentTarget, e.pointerId, (ev) => scrub(ev.clientX))
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

  /** Each action's span when a drag begins, and under `name:life` each object's life, so the drag can keep sending its total (D97, D146). */
  const snapshotOf = (refs: ActionRef[]): Record<string, { start: number; end: number }> => {
    const out: Record<string, { start: number; end: number }> = {}
    const m = useStore.getState().model
    for (const ref of refs) {
      const obj = m?.objects.find((o) => o.name === ref.object)
      const action = obj?.actions[ref.index]
      if (!obj || !action) continue
      out[`${ref.object}:${ref.index}`] = { start: action.start, end: action.end }
      out[`${ref.object}:life`] = { start: obj.at, end: obj.until ?? Infinity }
    }
    return out
  }

  /**
   * Drag a clip by its body or an edge. Every selected clip follows by the same amount (D97). A
   * clip from a class action first becomes the object's own override, which is what then moves
   * (D80).
   */
  const beginClipDrag = (obj: SceneObject, index: number, mode: ClipMode, vertical = false) => (e: ReactPointerEvent<HTMLDivElement>) => {
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
    const origin = { x: e.clientX, y: e.clientY, start: action.start, end: action.end, pps: viewRef.current.pps }
    const minimum = frameSeconds(fps)
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    let refs: ActionRef[] | null = action.classAction ? null : useStore.getState().selectedActions
    let snapshot = refs ? snapshotOf(refs) : null
    let moved = false
    // Up or down moves an own animation in its object's stack (D210), when it is dragged on its own; it starts after a few pixels, as sideways does.
    const stackable = vertical && mode === 'move' && !action.classAction && !!refs && refs.length === 1
    const bar = e.currentTarget as HTMLElement
    const top0 = bar.offsetTop
    const grab = e.clientY - bar.getBoundingClientRect().top
    const barHeight = bar.getBoundingClientRect().height
    let inLevels = false
    let gesture = false
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - origin.y
      if (stackable && !inLevels && Math.abs(dy) >= 3) inLevels = true
      if (inLevels && refs) {
        const ref = refs[0]!
        setActionDrag({ object: ref.object, index: ref.index, top: top0 + dy })
        const drop = actionLevelDrop(ref, ev.clientY - grab + barHeight / 2)
        if (drop && !drop.satisfied) {
          if (!gesture) {
            gesture = true
            beginGesture()
          }
          moveAction(ref, drop.target)
          // The animation has a new index: the drag follows it, keeping its record of where the drag began.
          const after = useStore.getState().selectedActions[0]
          if (after && snapshot && (after.object !== ref.object || after.index !== ref.index)) {
            const was = snapshot[`${ref.object}:${ref.index}`]
            delete snapshot[`${ref.object}:${ref.index}`]
            if (was) snapshot[`${after.object}:${after.index}`] = was
            refs = [after]
            setActionDrag({ object: after.object, index: after.index, top: top0 + dy })
          }
        }
      }
      if (!moved && Math.abs(ev.clientX - origin.x) < 3) return
      moved = true
      if (!refs) {
        const own = ownAction(obj.name, index)
        if (own === null) return
        refs = [{ object: obj.name, index: own }]
        snapshot = snapshotOf(refs)
      }
      const dt = (ev.clientX - origin.x) / origin.pps
      if (mode === 'move') {
        const snapped = snapSpan(origin.start + dt, origin.end - origin.start, currentModel, action, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        retimeActions(refs, { shift: snapped.start - origin.start }, snapshot!)
      } else if (mode === 'end') {
        const snapped = snapTimeInfo(origin.end + dt, currentModel, action, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        retimeActions(refs, { grow: Math.max(origin.start + minimum, snapped.time) - origin.end }, snapshot!)
      } else {
        const snapped = snapTimeInfo(origin.start + dt, currentModel, action, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        retimeActions(refs, { trimStart: Math.min(origin.end - minimum, snapped.time) - origin.start }, snapshot!)
      }
    }
    const onEnd = () => {
      setSnapLine(null)
      setActionDrag(null)
      if (gesture) endGesture()
      // A click, not a drag: the playhead goes to the animation's start, where a preview drag sets its start state (D157).
      if (!moved && !inLevels) useStore.getState().setTime(action.start)
    }
    // A stack move re-creates the bar's element, which would drop a capture held on it: the window listens instead.
    if (stackable) captureWindow(e.pointerId, onMove, onEnd)
    else capture(e.currentTarget, e.pointerId, onMove, onEnd)
  }

  /**
   * Where an animation dragged up or down belongs in its object's clip (D210), as a clip does in
   * its lane (D160): above every own animation it overlaps in time whose middle lies below
   * `middleY`, which in the file means right after the highest of them, or else right before the
   * lowest of those above; `satisfied` when the file already has it there.
   */
  const actionLevelDrop = (ref: ActionRef, middleY: number): { target: { before: ActionRef } | { after: ActionRef }; satisfied: boolean } | null => {
    const m = useStore.getState().model
    const obj = m?.objects.find((o) => o.name === ref.object)
    const action = obj?.actions[ref.index]
    if (!m || !obj || !action) return null
    const clip = document.querySelector<HTMLElement>(`.oclip[data-object="${ref.object}"]`)
    if (!clip) return null
    const others = [...clip.querySelectorAll<HTMLElement>('.clip[data-ref]')]
      .map((el) => ({ el, owner: el.dataset['ref']!.split(':')[0]!, index: Number(el.dataset['ref']!.split(':')[1]) }))
      .filter((o) => o.owner === ref.object && o.index !== ref.index)
      .map((o) => ({ ...o, action: obj.actions[o.index] }))
      .filter((o) => o.action && !o.action.classAction && o.action.end > action.start && o.action.start < action.end)
    if (others.length === 0) return null
    const middle = (el: HTMLElement): number => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2
    }
    const below = others.filter((o) => middle(o.el) >= middleY)
    const above = others.filter((o) => middle(o.el) < middleY)
    const satisfied = below.every((o) => o.index < ref.index) && above.every((o) => o.index > ref.index)
    if (below.length > 0) {
      const last = [...below].sort((a, b) => b.index - a.index)[0]!
      return { target: { after: { object: ref.object, index: last.index } }, satisfied }
    }
    const first = [...above].sort((a, b) => a.index - b.index)[0]!
    return { target: { before: { object: ref.object, index: first.index } }, satisfied }
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
    let moved = false
    capture(
      e.currentTarget,
      e.pointerId,
      (ev) => {
        if (!moved && Math.abs(ev.clientX - origin.x) < 3) return
        moved = true
        const dt = (ev.clientX - origin.x) / origin.pps
        if (mode === 'move') {
          const snapped = snapSpan(origin.start + dt, origin.end - origin.start, currentModel, classAction, origin.pps, snapOn)
          setSnapLine(snapped.hit)
          setClassActionTiming(classAction.id, { at: snapped.start - origin.delay })
        } else if (mode === 'end') {
          const snapped = snapTimeInfo(origin.end + dt, currentModel, classAction, origin.pps, snapOn)
          setSnapLine(snapped.hit)
          setClassActionTiming(classAction.id, { duration: Math.max(origin.start + minimum, snapped.time) - origin.start })
        } else {
          const snapped = snapTimeInfo(origin.start + dt, currentModel, classAction, origin.pps, snapOn)
          setSnapLine(snapped.hit)
          const start = Math.min(origin.end - minimum, snapped.time)
          setClassActionTiming(classAction.id, { at: start - origin.delay, duration: origin.end - start })
        }
      },
      () => {
        setSnapLine(null)
        if (!moved) useStore.getState().setTime(span.start)
      },
    )
  }

  /**
   * Opacity handles (D83): the start handle slides the fade in time sideways and sets the opacity
   * before it up and down, which belongs to whatever defines it there, the declaration or the
   * fade before; the end handle sets how long the fade takes sideways and the opacity it reaches
   * up and down.
   */
  const beginFadeDrag = (obj: SceneObject, index: number, part: 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (!action?.stmt || !canEdit() || timingLocks(action.stmt, part)) return
    const written = action.changes['opacity']
    const shownBefore = currentModelValue(obj, action.start)
    const origin = { x: e.clientX, y: e.clientY, start: action.start, end: action.end, delay: action.timing.delay ?? 0, value: typeof written === 'number' ? written : 1, before: shownBefore, pps: viewRef.current.pps }
    const minimum = frameSeconds(fps)
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    let target: number | null = action.classAction ? null : index
    capture(e.currentTarget, e.pointerId, (ev) => {
      if (target === null) target = ownAction(obj.name, index)
      if (target === null) return
      const dt = (ev.clientX - origin.x) / origin.pps
      if (part === 'start') {
        // The start handle lengthens or shortens the fade from its start; the end stays where it is (D159).
        const start = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, action, origin.pps, snapOn))
        setActionTiming(obj.name, target, { at: start - origin.delay, duration: origin.end - start })
        const before = Math.max(0, Math.min(1, origin.before - (ev.clientY - origin.y) / OPACITY_GAIN))
        const now = useStore.getState().model?.objects.find((o) => o.name === obj.name)?.actions[target]
        if (now) setAttrsAt(obj.name, { opacity: before }, now.start)
      } else {
        const end = Math.max(origin.start, snapTime(origin.end + dt, currentModel, action, origin.pps, snapOn))
        const value = Math.max(0, Math.min(1, origin.value - (ev.clientY - origin.y) / OPACITY_GAIN))
        setActionTiming(obj.name, target, { duration: end - origin.start })
        setActionValues(obj.name, target, { opacity: value })
      }
    })
  }

  /**
   * Drag an object in time (D139, D140, D152): its clip in the objects view by its title, or the
   * edge of an absent stretch in the list. The title moves the whole object in time, actions
   * included, and up or down at the same time: the clip follows the pointer, and the moment its
   * middle passes another clip's the object goes above or below it, which is the drawing order
   * (D160, D165). The start edge moves the start and the actions keep their place against it;
   * the end edge moves only the end. A group has no life to move, so its clip only goes up or
   * down. One drag is one undo step, the level changes included.
   */
  const beginLifetimeDrag = (obj: SceneObject, mode: 'move' | 'start' | 'end') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = useStore.getState()
    if (e.ctrlKey || e.metaKey) {
      toggleSelected(obj.name)
      return
    }
    if (!s.selection.includes(obj.name)) select([obj.name])
    if (!obj.decl || obj.codeDriven || !canEdit()) return
    const isGroup = obj.className === GROUP
    if (isGroup && mode !== 'move') return
    const end = obj.until ?? s.contentEnd ?? s.playbackEnd ?? obj.at
    const origin: LifetimeOrigin & { x: number; y: number; end: number; pps: number } = { x: e.clientX, y: e.clientY, at: obj.at, until: obj.until, end, pps: viewRef.current.pps, actions: snapshotOf(obj.actions.map((_, index) => ({ object: obj.name, index }))) }
    const minimum = frameSeconds(fps)
    const snapOn = s.snap
    const currentModel = s.model
    const clipEl = e.currentTarget.closest<HTMLElement>('.oclip')
    const clipRect = clipEl?.getBoundingClientRect()
    /** Where in the clip it was grabbed, so the clip keeps that under the pointer. */
    const grab = clipRect ? e.clientY - clipRect.top : 0
    const clipHeightPx = clipRect?.height ?? 0
    /** Whether the drag has gone sideways or up and down yet; each starts after a few pixels. */
    let inTime = false
    let inLevels = false
    let gesture = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.x
      const dy = ev.clientY - origin.y
      if (!inTime && !isGroup && Math.abs(dx) >= 3) inTime = true
      if (!inLevels && mode === 'move' && Math.abs(dy) >= 3) inLevels = true
      if (inLevels && clipEl) {
        const track = clipEl.closest<HTMLElement>('.tl-track')
        const top = ev.clientY - grab
        if (track) setClipDrag({ name: obj.name, top: top - track.getBoundingClientRect().top })
        const drop = levelDrop(clipEl, top + clipHeightPx / 2)
        if (drop && !drop.satisfied) {
          if (!gesture) {
            gesture = true
            beginGesture()
          }
          moveDeclaration(obj.name, drop.target)
        }
      }
      if (!inTime) return
      if (!gesture) {
        gesture = true
        beginGesture()
      }
      const dt = dx / origin.pps
      if (mode === 'end') {
        const snapped = snapTimeInfo(origin.end + dt, currentModel, obj, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        setLifetime(obj.name, { until: Math.max(origin.at + minimum, snapped.time) })
      } else if (mode === 'move' && origin.until !== null) {
        const snapped = snapSpan(origin.at + dt, origin.until - origin.at, currentModel, obj, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        placeObject(obj.name, snapped.start, 'all', origin)
      } else {
        const snapped = snapTimeInfo(origin.at + dt, currentModel, obj, origin.pps, snapOn)
        setSnapLine(snapped.hit)
        placeObject(obj.name, mode === 'move' ? snapped.time : Math.min(snapped.time, origin.end - minimum), mode === 'move' ? 'all' : 'start', origin)
      }
    }
    const onEnd = () => {
      setSnapLine(null)
      setClipDrag(null)
      if (gesture) endGesture()
    }
    // The title drag listens on the window: moving the object in the cast moves its clip in the DOM, which would drop a capture held on it.
    if (mode === 'move') captureWindow(e.pointerId, onMove, onEnd)
    else capture(e.currentTarget, e.pointerId, onMove, onEnd)
  }

  /**
   * Where a clip dragged up or down belongs (D152, D160): above every clip it overlaps in time
   * whose middle lies below its own, which in the cast means right after the last of them, or
   * else right before the first of those above; `satisfied` when the cast already has it there.
   * Clips that never share a moment keep their order: there is nothing to see between them.
   */
  const levelDrop = (clipEl: HTMLElement, middleY: number): { target: { before: string } | { after: string }; satisfied: boolean } | null => {
    const m = useStore.getState().model
    const lane = clipEl.closest<HTMLElement>('.tl-row.lane')
    if (!m || !lane) return null
    const name = clipEl.dataset['object']
    if (!name) return null
    const start = Number(clipEl.dataset['start'])
    const end = Number(clipEl.dataset['end'])
    const order = (n: string): number => m.objects.findIndex((o) => o.name === n)
    const others = [...lane.querySelectorAll<HTMLElement>('.oclip[data-object]')].filter((el) => el.dataset['object'] !== name && Number(el.dataset['end']) > start && Number(el.dataset['start']) < end)
    if (others.length === 0) return null
    const middle = (el: HTMLElement): number => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2
    }
    const mine = order(name)
    const below = others.filter((el) => middle(el) >= middleY)
    const above = others.filter((el) => middle(el) < middleY)
    const satisfied = below.every((el) => order(el.dataset['object']!) < mine) && above.every((el) => order(el.dataset['object']!) > mine)
    if (below.length > 0) {
      const last = below.map((el) => el.dataset['object']!).sort((a, b) => order(b) - order(a))[0]!
      return { target: { after: last }, satisfied }
    }
    const first = above.map((el) => el.dataset['object']!).sort((a, b) => order(a) - order(b))[0]!
    return { target: { before: first }, satisfied }
  }

  /** An object's opacity as shown at a time, for the start of a fade. */
  const currentModelValue = (target: SceneObject, at: number): number => {
    const current = useStore.getState().model
    const v = current ? valueAt(current, target, 'opacity', at) : 1
    return typeof v === 'number' ? v : 1
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
    const origin = { x: e.clientX, y: e.clientY, start: span.start, end: span.end, delay: member.timing.delay ?? 0, value: typeof written === 'number' ? written : 1, before: currentModelValue(member.object, span.start), pps: viewRef.current.pps }
    const minimum = frameSeconds(fps)
    const snapOn = useStore.getState().snap
    const currentModel = useStore.getState().model
    capture(e.currentTarget, e.pointerId, (ev) => {
      const dt = (ev.clientX - origin.x) / origin.pps
      if (part === 'start') {
        const newStart = Math.min(origin.end - minimum, snapTime(origin.start + dt, currentModel, classAction, origin.pps, snapOn))
        setClassActionTiming(classAction.id, { at: newStart - origin.delay, duration: origin.end - newStart })
        const before = Math.max(0, Math.min(1, origin.before - (ev.clientY - origin.y) / OPACITY_GAIN))
        // The class action as it is now, not as it was when the drag began: the opacity before it goes to whatever defines it there.
        const fresh = useStore.getState().model?.classActions[classAction.id] ?? classAction
        const start = classSpan(fresh)?.start ?? newStart
        setAttrsAtMany(activeMembers(fresh).map((m) => ({ name: m.object.name, attrs: { opacity: before } })), start)
      } else {
        const end = Math.max(origin.start, snapTime(origin.end + dt, currentModel, classAction, origin.pps, snapOn))
        const value = Math.max(0, Math.min(1, origin.value - (ev.clientY - origin.y) / OPACITY_GAIN))
        setClassActionTiming(classAction.id, { duration: end - origin.start })
        setClassActionValues(classAction.id, { opacity: value })
      }
    })
  }

  const snappedAt = (clientX: number): number => snapTime(rawTimeAt(clientX), model, null, viewRef.current.pps, useStore.getState().snap)

  const classMenu = (node: ClassNode) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(node.group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(node.group.className) },
      { label: 'Select members', run: () => selectClass(node.group.className) },
      { label: 'Save as preset', run: () => requestSavePreset({ className: node.group.className }) },
      { label: 'Delete class', run: () => deleteClass(node.group.className), danger: true },
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
    const atLink = action ? actionLinks(action).find((l) => l.key === 'at') : undefined
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: action?.name ? 'Rename' : 'Name', run: () => requestRename({ object: obj.name, index }) },
      { label: 'Edit links', keyword: atLink ? atLink.text : undefined, run: () => openLinksDialog({ object: obj.name, index }) },
      { label: 'Save as preset', run: () => requestSavePreset({ object: obj.name, index }) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classClipMenu = (node: ClassNode, classAction: ClassAction) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClassAction(classAction)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(node.group.className) },
      { label: classAction.name ? 'Rename' : 'Name', run: () => requestRename({ classAction: classAction.id }) },
      { label: 'Delete for every member', run: () => deleteClassAction(classAction.id), danger: true },
    ])
  }

  /** Right-click on empty track space: add an action of a kind at that time, or appear or disappear there (D100). */
  const trackMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    if (!canEdit() || obj.codeDriven) return
    select([obj.name])
    const t = snappedAt(e.clientX)
    // Only the kinds this thing can do: a group moves, turns, and scales, but has no size or opacity of its own.
    const verbs = VERBS.filter((verb) => verb === 'to' || (VERB_ATTRS[verb] ?? []).some((a) => attrSchema(obj.className, a)))
    showMenu(
      e,
      verbs.map((verb) =>
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

  /** Right-click on an object's clip in the objects view (D139). */
  const objectClipMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const s = useStore.getState()
    if (!s.selection.includes(obj.name)) select([obj.name])
    const t = snappedAt(e.clientX)
    const isGroup = obj.className === GROUP
    const editableObject = !!obj.decl && !obj.codeDriven && canEdit()
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      { label: 'Rename', run: () => requestRename({ object: obj.name }) },
      ...(isGroup ? [] : [{ label: 'Classes', run: () => requestClasses([obj.name]) }]),
      ...(isGroup || !editableObject
        ? []
        : [
            { label: 'Begin at', keyword: timecode(t, fps), run: () => placeObject(obj.name, t, 'start') },
            { label: 'End at', keyword: timecode(t, fps), run: () => setLifetime(obj.name, { until: t }) },
            ...(obj.until !== null ? [{ label: 'Keep to the end', run: () => setLifetime(obj.name, { until: null }) }] : []),
            { label: 'Edit links', run: () => openLinksDialog({ object: obj.name }) },
          ]),
      { label: 'Duplicate', run: () => duplicateObjects([obj.name]) },
      ...(!editableObject ? [] : [{ label: 'Save as preset', run: () => requestSavePreset({ object: obj.name }) }]),
      isGroup ? { label: 'Ungroup', run: () => ungroup(obj.name), danger: true } : { label: 'Delete object', run: () => deleteObjects([obj.name]), danger: true },
    ])
  }

  /** Right-click on a lane's empty space in the objects view: add an object that begins there (D139). */
  const laneMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.tl-track, .grid-line') || !canEdit()) return
    e.preventDefault()
    const t = snappedAt(e.clientX)
    showMenu(e, [{ label: 'Add', keyword: timecode(t, fps), children: OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, 0, 0, t) })) }])
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
    const t = snappedAt(e.clientX)
    showMenu(e, [{ label: 'Add', keyword: t > 0 ? timecode(t, fps) : undefined, children: OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, 0, 0, t) })) }])
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
  const framePx = view.pps / fps
  const frameTicks = framePx >= 6 && width > 0 ? Array.from({ length: Math.min(600, Math.ceil(width / framePx) + 2) }, (_, i) => (Math.floor(view.scrollTime * fps) + i) / fps) : []
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
  /** Who refers to each action's or object's timing, for the mark on the thing referred to (D169). */
  const dependents = useMemo(() => (model ? dependentsByTarget(model) : new Map<string, string[]>()), [model])

  /** The marks of a thing's links: what it refers to, with the text as written, and who refers to it (D169). */
  const renderLinks = (links: LinkInfo[], referredBy: string[] | undefined, short = false) => (
    <>
      {links.map((l) =>
        l.kind === 'code' ? (
          // A value that is code of its own, such as a shape from a formula: a small mark, the code in the tooltip (D226).
          <span key={l.key} className="link code" title={`${l.key}: ${l.text.length > 80 ? `${l.text.slice(0, 79)}…` : l.text}`}>
            ƒ{!short && ` ${l.key}`}
          </span>
        ) : (
          <span key={l.key} className={`link ${l.kind}`} title={`${linkWord(l.key)} follows ${l.text}`}>
            <LinkIcon />
            {!short && (l.kind === 'value' ? `${l.key} = ${l.text.length > 28 ? `${l.text.slice(0, 27)}…` : l.text}` : `${l.key === 'at' ? '' : `${l.key} `}${l.text}`)}
          </span>
        ),
      )}
      {referredBy && referredBy.length > 0 && (
        <span className="link target" title={`Followed by:\n${referredBy.join('\n')}`}>
          <LinkIcon />
          {!short && referredBy.length > 1 ? referredBy.length : ''}
        </span>
      )}
    </>
  )

  const standIns = useMemo(() => {
    const out = new Map<string, SceneObject | null>()
    const walk = (node: ClassNode) => {
      out.set(node.group.className, classStandIn(node.group, out.size))
      node.children.forEach(walk)
    }
    tree?.roots.forEach(walk)
    return out
  }, [tree])

  const opacityY = (value: unknown): number => OPACITY_H - 1 - Math.max(0, Math.min(1, typeof value === 'number' ? value : 0)) * (OPACITY_H - 3)
  const playheadX = xAt(time)
  const playheadVisible = width > 0 && playheadX >= 0 && playheadX <= width

  /**
   * One action as a clip: in its object's row, or inside the object's clip in the objects view,
   * where `originX` is the clip's left and whatever lies outside the object's life is cut off by
   * the clip (D144). With `carried`, the action belongs to a group that carries the object and
   * is shown inside the member's clip, labelled with the group's name; dragging it retimes the
   * group's action. With `thin`, the clip is collapsed and the action is a line without a label.
   */
  const renderActionClip = (owner: SceneObject, action: Action, index: number, lanes: Map<number, number>, originX = 0, laneTop = 4, carried = false, thin = false) => {
    const derived = !!action.classAction
    const locked = action.codeDriven || !action.stmt || !editable || action.overridden
    const isSelected = isActionSelected(selectedActions, owner.name, index)
    const kin = !isSelected && derived && selectedClassActions.has(action.classAction!)
    const left = xAt(action.start) - originX
    const clipWidth = Math.max(thin ? 2 : 8, (action.end - action.start) * view.pps)
    const own = !carried && !derived
    // An own animation dragged up or down follows the pointer; the others slide into their lanes (D210).
    const dragging = own && !!actionDrag && actionDrag.object === owner.name && actionDrag.index === index
    const top = dragging ? actionDrag.top : laneTop + (lanes.get(action.id) ?? 0) * (thin ? THIN_H + 1 : LANE_H)
    const span = `${timecode(action.start, fps)} to ${timecode(action.end, fps)}`
    const title = action.overridden
      ? `all('${action.classAction!.className}').${action.verb}, overridden for ${owner.name}`
      : derived
        ? `all('${action.classAction!.className}').${action.verb}  ${span}`
        : action.overrides
          ? `${owner.name}.${action.verb}  ${span}, overrides ${action.overrides.name}`
          : carried
            ? `group ${owner.name}.${action.verb}  ${span}`
            : `${action.name ? `${action.name} = ` : ''}${owner.name}.${action.verb}  ${span}`
    return (
      <div
        key={`${carried ? 'g' : ''}${action.id}`}
        className={`clip${locked ? ' locked' : ''}${derived ? ' derived' : ''}${action.overridden ? ' overridden' : ''}${action.overrides ? ' override' : ''}${isSelected ? ' selected' : ''}${kin ? ' kin' : ''}${carried ? ' carried' : ''}${thin ? ' thin' : ''}${dragging ? ' dragging' : ''}`}
        style={{ left, top, width: clipWidth, background: VERB_COLORS[action.verb], color: labelOn(VERB_COLORS[action.verb]) }}
        {...(own ? { 'data-ref': `${owner.name}:${index}` } : {})}
        onPointerDown={locked ? undefined : beginClipDrag(owner, index, 'move', own && !thin)}
        onContextMenu={action.stmt ? clipMenu(owner, index) : undefined}
        title={title}
      >
        {!locked && !thin && <div className="clip-edge left" onPointerDown={beginClipDrag(owner, index, 'start')} />}
        {!thin && (
          <span className="label">
            {carried && <span className="ident group">{owner.name}</span>}
            <Idents words={actionIdents(action)} />
            {clipLabel(action)}
            {!carried && renderLinks(actionLinks(action), dependents.get(targetKey({ action })))}
          </span>
        )}
        {!locked && !thin && <div className="clip-edge right" onPointerDown={beginClipDrag(owner, index, 'end')} />}
      </div>
    )
  }

  /** What an object's clip holds: its own actions, and those of the groups carrying it, shown as group moves (D144). Only what touches the span `start` to `end` shows. */
  const clipActions = (obj: SceneObject, start: number, end: number): { owner: SceneObject; action: Action; index: number; carried: boolean }[] => {
    const items = obj.actions.map((action, index) => ({ owner: obj, action, index, carried: false }))
    if (model && obj.className !== GROUP) for (const g of containers(model, obj)) g.actions.forEach((action, index) => items.push({ owner: g, action, index, carried: true }))
    return items.filter((i) => !i.action.overridden && i.action.end > start && i.action.start < end)
  }

  /** One class action as a clip, on the class's row or inside its clip in the objects view, where `originX` is the clip's left (D80, D164). */
  const renderClassActionClip = (node: ClassNode, item: { id: number; start: number; end: number; classAction: ClassAction }, lanes: Map<number, number>, originX = 0, laneTop = 4, thin = false) => {
    const { classAction } = item
    const locked = !classAction.stmt || !editable
    const isSelected = selectedClassActions.has(classAction)
    return (
      <div
        key={item.id}
        className={`clip${locked ? ' locked' : ''}${isSelected ? ' selected' : ''}${thin ? ' thin' : ''}`}
        style={{ left: xAt(item.start) - originX, top: laneTop + (lanes.get(item.id) ?? 0) * (thin ? THIN_H + 1 : LANE_H), width: Math.max(thin ? 2 : 8, (item.end - item.start) * view.pps), background: VERB_COLORS[classAction.verb], color: labelOn(VERB_COLORS[classAction.verb]) }}
        onPointerDown={locked ? undefined : beginClassClipDrag(classAction, 'move')}
        onContextMenu={classAction.stmt ? classClipMenu(node, classAction) : undefined}
        title={`${classAction.name ? `${classAction.name} = ` : ''}all('${node.group.className}').${classAction.verb}  ${timecode(item.start, fps)} to ${timecode(item.end, fps)}, for every member`}
      >
        {!locked && !thin && <div className="clip-edge left" onPointerDown={beginClassClipDrag(classAction, 'start')} />}
        {!thin && (
          <span className="label">
            <Idents words={classActionIdents(classAction)} />
            {classAction.verb}
            {renderLinks(classActionLinks(classAction), dependents.get(targetKey({ classAction })))}
          </span>
        )}
        {!locked && !thin && <div className="clip-edge right" onPointerDown={beginClassClipDrag(classAction, 'end')} />}
      </div>
    )
  }

  /** The handles of a class's fades on its opacity lane, for every member at once (D93). */
  const renderClassFadeHandles = (node: ClassNode, standIn: SceneObject, originX = 0, start = -Infinity, end = Infinity) =>
    editable &&
    model &&
    node.group.actions.map((classAction) => {
      const member = activeMembers(classAction)[0]
      const span = classSpan(classAction)
      if (!member || !span || !classAction.stmt || !('opacity' in member.changes) || typeof member.changes['opacity'] !== 'number') return null
      if (span.end <= start || span.start >= end) return null
      const isSelected = selectedClassActions.has(classAction)
      return [
        <div key={`s${classAction.id}`} className={`opacity-handle start${isSelected ? ' selected' : ''}`} style={{ left: xAt(span.start) - originX, top: opacityY(valueAt(model, standIn, 'opacity', span.start)) }} onPointerDown={beginClassFadeDrag(classAction, 'start')} title="Fade start: drag for length and opacity" />,
        <div key={`e${classAction.id}`} className={`opacity-handle end${isSelected ? ' selected' : ''}`} style={{ left: xAt(span.end) - originX, top: opacityY(valueAt(model, standIn, 'opacity', span.end)) }} onPointerDown={beginClassFadeDrag(classAction, 'end')} title="Fade end: drag for length and opacity" />,
      ]
    })

  /** A class's actions that touch a span, as clip items. */
  const classItems = (node: ClassNode, start: number, end: number): { id: number; start: number; end: number; classAction: ClassAction }[] =>
    node.group.actions.flatMap((classAction) => {
      const span = classSpan(classAction)
      return span && span.end > start && span.start < end ? [{ id: classAction.id, start: span.start, end: span.end, classAction }] : []
    })

  /** The height a class's clip needs: a title, its lanes of actions, and the opacity of its members; collapsed, a title and a strip of lines. */
  const classClipHeight = (node: ClassNode, start: number, end: number, isCollapsed: boolean): number => {
    if (isCollapsed) return CLIP_TITLE_H + THIN_STRIP_H
    return CLIP_TITLE_H + assignLanes(classItems(node, start, end)).count * LANE_H + 4 + OPACITY_H
  }

  /**
   * A class as a clip in the Classes lane (D164): it spans its members, holds the class's own
   * animations, the ones every member follows, and shows the opacity those give the members with
   * the fade handles. Its title lists the members; clicking it selects them.
   */
  const renderClassClip = (node: ClassNode, start: number, end: number, isCollapsed: boolean, top: number) => {
    if (!model) return null
    const { group } = node
    const key = classKey(group.className)
    const standIn = standIns.get(group.className) ?? null
    const items = classItems(node, start, end)
    const { lanes, count } = assignLanes(items)
    const left = xAt(start)
    const clipWidth = Math.max(12, (end - start) * view.pps)
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name))
    const selected = allSelected || group.actions.some((a) => selectedClassActions.has(a))
    return (
      <div key={key} className={`oclip class${selected ? ' selected' : ''}${isCollapsed ? ' collapsed' : ''}`} style={{ left, top, width: clipWidth, height: classClipHeight(node, start, end, isCollapsed) }} data-class={group.className} data-start={start} data-end={end} onContextMenu={classMenu(node)}>
        <div className="oclip-title" onPointerDown={(e) => e.stopPropagation()} onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} title={`Class ${group.className}`}>
          <button
            className="oclip-fold"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed('timeline', key)
            }}
            title={isCollapsed ? 'Expand: show the animations with their names and the opacity' : 'Collapse: show the animations as thin lines'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="name">{group.className}</span>
          <span className="kind">class</span>
          <span className="kind members">{group.members.map((m) => m.name).join(' · ')}</span>
        </div>
        <div
          className="oclip-body"
          style={{ height: isCollapsed ? THIN_STRIP_H : count * LANE_H + 4 }}
          onContextMenu={(e) => {
            e.stopPropagation()
            classTrackMenu(node)(e)
          }}
        >
          {items.map((item) => renderClassActionClip(node, item, lanes, left, 2, isCollapsed))}
        </div>
        {standIn && !isCollapsed && (
          <div className="oclip-opacity" style={{ height: OPACITY_H }} onDoubleClick={toggleClassExistence(group.className, standIn)} title="Opacity, for every member">
            <OpacityLane model={model} obj={standIn} scrollTime={start} pps={view.pps} width={clipWidth} height={OPACITY_H} />
            {renderClassFadeHandles(node, standIn, left, start, end)}
          </div>
        )}
      </div>
    )
  }

  /** The height an object's clip needs in the objects view: a title, its lanes of actions, and its opacity; collapsed, a title and a strip of lines (D153). */
  const clipHeight = (obj: SceneObject, start: number, end: number, isCollapsed: boolean): number => {
    if (isCollapsed) return CLIP_TITLE_H + THIN_STRIP_H
    const { count } = assignLanes(clipActions(obj, start, end).map((i) => i.action))
    return CLIP_TITLE_H + count * LANE_H + 4 + (attrSchema(obj.className, 'opacity') ? OPACITY_H : 0)
  }

  /**
   * One object as a clip from when it begins to when it is removed, its actions inside and its
   * opacity along the bottom with the fade handles (D139, D144, D150), `top` pixels down its
   * lane. The arrow in its corner collapses it to a title over thin lines, one per action (D153).
   * Whatever an animation does past the object's life is cut off at the clip's edge.
   */
  const renderObjectClip = (obj: SceneObject, start: number, end: number, isCollapsed: boolean, top: number) => {
    if (!model) return null
    const items = clipActions(obj, start, end)
    const { lanes, count } = assignLanes(items.map((i) => i.action))
    const hasOpacity = !!attrSchema(obj.className, 'opacity')
    const left = xAt(start)
    const clipWidth = Math.max(12, (end - start) * view.pps)
    const selected = selection.includes(obj.name)
    const isGroup = obj.className === GROUP
    const locked = !obj.decl || obj.codeDriven
    const openEnded = obj.until === null && !isGroup
    const title = `${obj.name}  ${timecode(start, fps)} to ${openEnded ? 'the end' : timecode(end, fps)}`
    const dragging = clipDrag?.name === obj.name
    return (
      <div
        key={obj.name}
        className={`oclip${selected ? ' selected' : ''}${isGroup ? ' group' : ''}${locked ? ' locked' : ''}${isCollapsed ? ' collapsed' : ''}${dragging ? ' dragging' : ''}`}
        style={{ left, top: dragging ? clipDrag!.top : top, width: clipWidth, height: clipHeight(obj, start, end, isCollapsed) }}
        data-object={obj.name}
        data-start={start}
        data-end={end}
        onContextMenu={objectClipMenu(obj)}
      >
        <div className="oclip-title" onPointerDown={beginLifetimeDrag(obj, 'move')} onDoubleClick={() => jumpToObject(obj.name)} title={title}>
          <button
            className="oclip-fold"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed('timeline', obj.name)
            }}
            title={isCollapsed ? 'Expand: show the animations with their names and the opacity' : 'Collapse: show the animations as thin lines'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="name">{obj.name}</span>
          <span className="kind">{obj.className}</span>
          {isGroup && <span className="kind members">{(model.groups.get(obj.name) ?? []).join(' · ')}</span>}
          {!isGroup && obj.classes.length > 0 && <span className="kind classes">{obj.classes.join(' · ')}</span>}
          {openEnded && <span className="kind">→ end</span>}
          {renderLinks(objectLinks(obj), dependents.get(targetKey({ object: obj })))}
          {obj.codeDriven && <span className="kind">code</span>}
          {anchored.includes(obj.name) && (
            <span className="kind anchored" title="Anchored: a push never moves it">
              anchored
            </span>
          )}
        </div>
        {!locked && !isGroup && <div className="oclip-edge left" onPointerDown={beginLifetimeDrag(obj, 'start')} title={`Begins at ${timecode(start, fps)}`} />}
        {!locked && !isGroup && <div className="oclip-edge right" onPointerDown={beginLifetimeDrag(obj, 'end')} title={openEnded ? 'Lasts to the end' : `Removed at ${timecode(end, fps)}`} />}
        <div
          className="oclip-body"
          style={{ height: isCollapsed ? THIN_STRIP_H : count * LANE_H + 4 }}
          onContextMenu={(e) => {
            e.stopPropagation()
            trackMenu(obj)(e)
          }}
        >
          {items.map((i) => renderActionClip(i.owner, i.action, i.index, lanes, left, 2, i.carried, isCollapsed))}
        </div>
        {hasOpacity && !isCollapsed && (
          <div className="oclip-opacity" style={{ height: OPACITY_H }} onDoubleClick={toggleExistence(obj)} title="Opacity. Double-click to appear or disappear here; drag the handles of a fade.">
            <OpacityLane model={model} obj={obj} scrollTime={start} pps={view.pps} width={clipWidth} height={OPACITY_H} />
            {editable &&
              !obj.codeDriven &&
              obj.actions.map((action, index) => {
                if (!('opacity' in action.changes) || !action.stmt || action.codeDriven || action.overridden || typeof action.changes['opacity'] !== 'number') return null
                if (action.end <= start || action.start >= end) return null
                const isSelected = isActionSelected(selectedActions, obj.name, index)
                return [
                  <div key={`s${action.id}`} className={`opacity-handle start${isSelected ? ' selected' : ''}`} style={{ left: xAt(action.start) - left, top: opacityY(valueAt(model, obj, 'opacity', action.start)) }} onPointerDown={beginFadeDrag(obj, index, 'start')} title="Drag sideways to move this fade, up or down to set the opacity before it" />,
                  <div key={`e${action.id}`} className={`opacity-handle end${isSelected ? ' selected' : ''}`} style={{ left: xAt(action.end) - left, top: opacityY(valueAt(model, obj, 'opacity', action.end)) }} onPointerDown={beginFadeDrag(obj, index, 'end')} title="Fade end: drag for length and opacity" />,
                ]
              })}
          </div>
        )}
      </div>
    )
  }

  /**
   * The objects view (D139, D152, D164): the Objects, Groups, and Classes lanes, like the tracks
   * of a video editor. Within a lane the clips stack by drawing order, not by time: a clip sits
   * above whatever it overlaps in time and was declared after, so whatever is higher up appears
   * on top, and clips that never share a moment can share a level. Drag a clip's title up or down
   * to change that order, sideways to move it in time.
   */
  const renderObjectsView = () => {
    if (!model) return null
    const endOf = (o: SceneObject): number => o.until ?? Math.max(contentEnd ?? playbackEnd ?? 0, o.at + frameSeconds(fps))
    const unionOf = (members: SceneObject[], own: { end: number }[]): { start: number; end: number } => {
      if (members.length === 0) return { start: 0, end: Math.max(contentEnd ?? playbackEnd ?? 0, frameSeconds(fps), ...own.map((a) => a.end)) }
      return { start: Math.min(...members.map((m) => m.at)), end: Math.max(...members.map(endOf)) }
    }
    const spanOf = (obj: SceneObject): { start: number; end: number } => {
      if (obj.className !== GROUP) return { start: obj.at, end: endOf(obj) }
      const members = groupMembers(model, obj.name).map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o)
      return unionOf(members, obj.actions)
    }
    interface LaneItem {
      key: string
      start: number
      end: number
      collapsed: boolean
      height: number
      render: (top: number) => ReactNode
    }
    const objectItem = (obj: SceneObject): LaneItem => {
      const { start, end } = spanOf(obj)
      const isCollapsed = !!collapsed[obj.name]
      return { key: obj.name, start, end, collapsed: isCollapsed, height: clipHeight(obj, start, end, isCollapsed), render: (top) => renderObjectClip(obj, start, end, isCollapsed, top) }
    }
    const classItem = (node: ClassNode): LaneItem => {
      const spans = node.group.actions.map(classSpan).filter((x): x is { start: number; end: number } => !!x)
      const { start, end } = unionOf(node.group.members, spans)
      const key = classKey(node.group.className)
      const isCollapsed = !!collapsed[key]
      return { key, start, end, collapsed: isCollapsed, height: classClipHeight(node, start, end, isCollapsed), render: (top) => renderClassClip(node, start, end, isCollapsed, top) }
    }
    const lane = (key: 'objects' | 'groups' | 'classes', label: string, hint: string, items: LaneItem[]) => {
      // A clip's level: one above the highest of the earlier clips it overlaps in time, else the bottom.
      const level = new Map<string, number>()
      for (const item of items) {
        let l = 0
        for (const other of items) {
          if (other === item) break
          if (other.end > item.start && other.start < item.end) l = Math.max(l, (level.get(other.key) ?? 0) + 1)
        }
        level.set(item.key, l)
      }
      const levelCount = items.length > 0 ? Math.max(...level.values()) + 1 : 0
      const heights = Array.from({ length: levelCount }, (_, l) => Math.max(0, ...items.filter((i) => level.get(i.key) === l).map((i) => i.height)))
      // Level 0 sits at the bottom; a level's top is what every level above it takes.
      const tops: number[] = []
      let y = 4
      for (let l = levelCount - 1; l >= 0; l--) {
        tops[l] = y
        y += heights[l]! + 4
      }
      const names = items.map((i) => i.key)
      const anyExpanded = items.some((i) => !i.collapsed)
      return (
        <div key={key} className="tl-row lane" style={{ height: Math.max(y, 34) }} data-lane={key}>
          <div className="tl-row-header lane-header" title={hint}>
            <span className="name">{label}</span>
            {names.length > 0 && (
              <button
                className="fold-all"
                onClick={() => {
                  const keep = Object.keys(collapsed).filter((k) => !names.includes(k))
                  setAllCollapsed('timeline', anyExpanded ? [...keep, ...names] : keep)
                }}
                title={anyExpanded ? 'Collapse every clip in the lane' : 'Expand every clip in the lane'}
              >
                {anyExpanded ? '▾' : '▸'}
              </button>
            )}
          </div>
          <div className="tl-track" onPointerDown={clearSelection} onContextMenu={laneMenu}>
            {ticks.map((t) => (
              <div key={t} className="grid-line" style={{ left: xAt(t) }} />
            ))}
            {items.map((item) => item.render(tops[level.get(item.key)!]!))}
          </div>
        </div>
      )
    }
    const flat = (nodes: ClassNode[]): ClassNode[] => nodes.flatMap((n) => [n, ...flat(n.children)])
    const objects = model.objects.filter((o) => o.className !== GROUP).map(objectItem)
    const groups = model.objects.filter((o) => o.className === GROUP).map(objectItem)
    const classNodes = tree ? flat(tree.roots) : []
    return [
      lane('objects', 'Objects', 'Stacked by drawing order, highest on top', objects),
      ...(groups.length > 0 ? [lane('groups', 'Groups', 'Every group, spanning its members, with its own animations and opacity inside. Its moves also show inside its members, labelled with its name.', groups)] : []),
      ...(classNodes.length > 0 ? [lane('classes', 'Classes', "Every class, spanning its members, with the animations written on all('name') inside: they run on every member, and show dashed inside each member's clip.", classNodes.map(classItem))] : []),
    ]
  }

  return (
    <div className="timeline" onPointerEnter={() => setHoverTimeline(true)} onPointerLeave={() => setHoverTimeline(false)}>
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
          title="Play, or pause and return to where it started (space)"
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
          title={snap ? 'Snapping to seconds, animations, and fifth frames' : 'Free placement'}
          aria-label="Snap"
          aria-pressed={snap}
        >
          Snap
        </button>
        <button
          className={`transport-button text${frameSnap ? ' on' : ''}`}
          onClick={(e) => {
            toggleFrameSnap()
            e.currentTarget.blur()
          }}
          title={frameSnap ? 'Every time the timeline writes lands on a frame. Click for free timing.' : 'Times are free. Click to keep every time the timeline writes on a frame.'}
          aria-label="Frame snap"
          aria-pressed={frameSnap}
        >
          Frames
        </button>
        <NumberField label="Frames per wheel tick with Shift" value={wheelStep} unit="f" onChange={setWheelStep} />
        <span className="time mono">{formatTime(time, fps)}</span>
        <span className="dim">
          {fps} fps{contentEnd !== null ? `, ends at ${timecode(contentEnd, fps)}` : ''}
          {!editable ? ', code has an error' : ''}
        </span>
      </div>
      <div className="tl-grid" ref={gridRef}>
        <div className="tl-corner" />
        <div className="tl-ruler" ref={rulerRef} onPointerDown={beginScrub} title="Click or drag to move the playhead">
          {frameTicks.map((t) => (
            <div key={`f${t}`} className="frame-tick" style={{ left: xAt(t) }} />
          ))}
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: xAt(t) }}>
              <span>{tickLabel(t, step, fps)}</span>
            </div>
          ))}
          {contentEnd !== null && <div className="end-marker" style={{ left: xAt(contentEnd) }} title="End of the content" />}
          {playheadVisible && <div className="playhead head" style={{ left: playheadX }} />}
        </div>
        <div className="tl-body" ref={bodyRef}>
          <div className="tl-rows" ref={rowsRef} onContextMenu={blankMenu}>
            {model && model.objects.length === 0 && <div className="empty">No objects yet. Right-click to add one.</div>}
            {renderObjectsView()}
            <div className="tl-playhead-layer" aria-hidden="true">
              {snapLine !== null && <div className="tl-snap-line" style={{ left: xAt(snapLine) }} />}
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
    </div>
  )
}
