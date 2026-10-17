import { create } from 'zustand'
import { groupCarries, normalizeSelection } from '../model/groups'
import { GROUP } from '../model/registry'
import type { SceneError, SceneModel } from '../model/types'
import { snapToFrame } from './time'

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  /** Seconds kept after the last action, so the final state stays for export and looping (D54). */
  hold: number
  /** The color inside the frame, behind everything, in the preview and in exports without alpha (D131). */
  background: string
}

/** The kinds of object the GUI adds. */
export type ObjectKind = 'Rect' | 'Circle' | 'Text'
export const OBJECT_KINDS: ObjectKind[] = ['Rect', 'Circle', 'Text']

/** The preview's tool (D203): Select, the default, acts on objects and on the selected path's points; Object places one of the chosen kind per click (D163); Path starts a path on an object, draws points, and moves the path and its points. A tool stays until put away. */
export type Tool = 'select' | 'object' | 'path'

/**
 * What the preview's handles do to the selection (D86). `all` shows every handle: the body
 * moves, corner and edge handles resize, a handle above rotates. The single modes show one kind.
 * Shift makes the same change an animation (D79).
 */
export type TransformMode = 'all' | 'move' | 'rotate' | 'resize'
export const TRANSFORM_MODES: TransformMode[] = ['all', 'move', 'rotate', 'resize']

/** Snapping for preview drags: positions and sizes to a grid, angles to a step (D91). */
export interface PreviewSnap {
  /** Positions and sizes land on the grid, angles on the step (D91). */
  on: boolean
  /** Pixels. */
  grid: number
  /** Degrees. */
  angle: number
  /** A dragged box aligns to other objects' edges and centers and to the frame (D135). */
  edges: boolean
}

/** Where a new animation sits against the playhead: it starts here, or it ends here (D103). */
export type Pin = 'start' | 'end'
/** What a resize keeps in place: the far side, or the center (D104). */
export type Anchor = 'edge' | 'center'

/** Which pane's folding a key belongs to; the panes fold independently (D98). */
export type Pane = 'objects' | 'timeline'

export interface ProjectInfo {
  path: string
  name: string
  /** The scene file, relative to the project folder. */
  sceneFile: string
  /** True for the built-in sample when the app runs without file access. */
  inMemory: boolean
}

export interface MenuItem {
  label: string
  /** A word after the label shown in `color`, such as the kind of an action (D100). */
  keyword?: string
  color?: string
  /** What clicking the item does. An item with children may do nothing itself. */
  run?: () => void
  /** Items that open beside this one on hover (D109). */
  children?: MenuItem[]
  danger?: boolean
}

export interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** An action, named by its object and its position in that object's actions. */
export interface ActionRef {
  object: string
  index: number
}

/** What the links dialog is about: an object, or one of its actions, and the attribute to start on (D172, D182). */
export interface LinksTarget {
  object: string
  index?: number
  key?: string
}

/** What is selected, as one value, so a history step can carry it (D90). */
export interface SelectionState {
  selection: string[]
  /** Actions picked in the timeline or the object pane; the first is the primary one (D97). */
  selectedActions: ActionRef[]
}

/** A modal question: confirm something, optionally after typing a value. */
export interface DialogState {
  title: string
  message?: string
  /** Things affected, listed under the message. */
  items?: string[]
  /** When set, the dialog asks for text and passes it to onConfirm. */
  input?: { label: string; value: string; validate?: (value: string) => string | null }
  confirmLabel: string
  danger?: boolean
  onConfirm: (value: string) => void
}

/** One object in the clipboard: its declaration and its own actions, as source text. */
export interface ClipObject {
  name: string
  className: string
  propsText: string
  actions: { text: string; name: string | null }[]
}

/** One action in the clipboard, as source text. */
export interface ClipAction {
  objectName: string
  verb: string
  name: string | null
  propsText: string
}

/** What Ctrl+C took: objects with their actions, or actions, as source text (D81). */
export type Clip = { kind: 'objects'; items: ClipObject[] } | { kind: 'actions'; items: ClipAction[] }

const DEFAULTS_KEY = 'quick-animator.showDefaults'
const SNAP_KEY = 'quick-animator.previewSnap'
const COLLIDE_KEY = 'quick-animator.collide'
const PUSH_KEY = 'quick-animator.push'
const PREFS_KEY = 'quick-animator.prefs'

/** App preferences (D145). */
export interface Prefs {
  /** Seconds a new object lasts from where it is added, or null to last to the end of the content. */
  objectLength: number | null
}

export const DEFAULT_PREFS: Prefs = { objectLength: 2 }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const saved = JSON.parse(raw) as Partial<Prefs>
    const length = saved.objectLength
    return { objectLength: length === null ? null : typeof length === 'number' && length > 0 ? length : DEFAULT_PREFS.objectLength }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // A preference only.
  }
}
const SOFT_KEY = 'quick-animator.soft'
const ANCHORED_KEY = 'quick-animator.anchored'
const WHEEL_STEP_KEY = 'quick-animator.wheelStep'
const PIN_KEY = 'quick-animator.pin'
const CHAIN_KEY = 'quick-animator.chain'
const FRAME_SNAP_KEY = 'quick-animator.frameSnap'
const ANCHOR_KEY = 'quick-animator.anchor'
const SHOW_PATHS_KEY = 'quick-animator.showPaths'

function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

function saveChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference only.
  }
}

/** Object names kept per project folder under a key: editing state, not code (D136). */
function loadNames(key: string, path: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string[]>
    const names = all[path]
    return Array.isArray(names) ? names : []
  } catch {
    return []
  }
}

function saveNames(key: string, path: string, names: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string[]>
    if (names.length > 0) all[path] = names
    else delete all[path]
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    // Preference only.
  }
}

/** The objects drags pass through in a project. */
export function loadSoft(path: string): string[] {
  return loadNames(SOFT_KEY, path)
}

/** The objects nothing can push in a project. */
export function loadAnchored(path: string): string[] {
  return loadNames(ANCHORED_KEY, path)
}

function loadShowDefaults(): boolean {
  try {
    return localStorage.getItem(DEFAULTS_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadPreviewSnap(): PreviewSnap {
  const fallback: PreviewSnap = { on: false, grid: 10, angle: 15, edges: true }
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<PreviewSnap>
    return { on: saved.on === true, grid: saved.grid && saved.grid > 0 ? saved.grid : fallback.grid, angle: saved.angle && saved.angle > 0 ? saved.angle : fallback.angle, edges: saved.edges !== false }
  } catch {
    return fallback
  }
}

function loadWheelStep(): number {
  try {
    const n = Number(localStorage.getItem(WHEEL_STEP_KEY))
    return Number.isInteger(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}

function sameRefs(a: ActionRef[], b: ActionRef[]): boolean {
  return a.length === b.length && a.every((r, i) => r.object === b[i]!.object && r.index === b[i]!.index)
}

function sameSelection(a: SelectionState, b: SelectionState): boolean {
  return a.selection.length === b.selection.length && a.selection.every((n, i) => n === b.selection[i]) && sameRefs(a.selectedActions, b.selectedActions)
}

/** Where selection changes go to become history steps; registered by the controller (D90). */
let selectionSink: ((before: SelectionState, after: SelectionState) => void) | null = null
let applying = false

export function setSelectionSink(sink: ((before: SelectionState, after: SelectionState) => void) | null): void {
  selectionSink = sink
}

interface State {
  settings: ProjectSettings
  /** Playhead position in seconds. Never negative, not limited at the top. */
  time: number
  playing: boolean
  /** Where the playhead was when playback started, so that pausing returns there (D126). */
  playStart: number | null
  /** Whether playback wraps at the content end. Off by default: it stops there. */
  loop: boolean
  /** Whether timeline drags snap to whole seconds and to other actions' starts and ends (D64). */
  snap: boolean
  /** Whether every time the timeline writes lands on the project's frame grid (D119). */
  frameSnap: boolean
  /** Frames a wheel tick adds to or takes from the selected actions' durations (D97). */
  wheelStep: number
  /** Where the content ends: the last action or lifetime, or null while nothing is timed (D54 revised). */
  contentEnd: number | null
  /** Where playback and export stop: the content end plus the hold on the final frame. */
  playbackEnd: number | null
  /** Preferences (D145), kept per app. */
  prefs: Prefs
  prefsOpen: boolean
  /** Names of the selected objects. Shared by every pane. */
  selection: string[]
  /** The selected actions, when some were picked in the timeline or the object pane. */
  selectedActions: ActionRef[]
  /** The primary selected action: the first of `selectedActions`, or null. */
  selectedAction: ActionRef | null
  transformMode: TransformMode
  previewSnap: PreviewSnap
  /** Dragged objects stop at other objects instead of passing over them (D136). */
  collide: boolean
  /** Dragged objects shove what they meet along instead of stopping (D136). */
  push: boolean
  /** What a drag pushed stays where it was shoved; off, it springs back when the drag retreats (D136). */
  /** The objects in this project that drags pass through, by name (D136). */
  soft: string[]
  /** The objects in this project that nothing pushes, by name (D136). */
  anchored: string[]
  pin: Pin
  /** Whether the animations made while Shift is held follow one another instead of all starting at the playhead (D127). */
  chain: boolean
  /** The timeline shows objects as clips, or one row per object (D139). */
  /** The links dialog's subject: an object, or one of its actions by index (D172). */
  linksDialog: LinksTarget | null
  /** The pane the pointer last went down in: it decides what the arrow keys move (D141). */
  activePane: 'preview' | 'timeline' | 'objects' | 'code' | 'now' | null
  /** Whether the pointer is over the timeline, so Shift held there previews the selected animation as it does over the preview (D180). */
  hoverTimeline: boolean
  anchor: Anchor
  clipboard: Clip | null
  /** Objects and class groups whose rows are folded, per pane (D98). */
  collapsed: Record<Pane, Record<string, true>>
  /** Objects whose classes are being edited in the Classes dialog, or null (D88). */
  classesDialog: string[] | null
  project: ProjectInfo | null
  /** The scene file text. The truth; everything else derives from it. */
  source: string
  /** The last good model. Kept while the source has an error. */
  model: SceneModel | null
  error: SceneError | null
  tool: Tool
  /** With the Path tool: edit a path's points, or move whole paths (D208). */
  pathMode: 'edit' | 'move'
  /** Show the selected object's paths without one being selected (D209); persisted. */
  showPaths: boolean
  /** Paths hidden for now, while the Path tool is on, as object:index (D209). */
  hiddenPaths: string[]
  /** The kind of object the Add tool places (D163). */
  addKind: ObjectKind
  /** The points of the selected path that are picked: placed, clicked, or boxed; a drag of one moves them all and Delete removes them (D194, D198). */
  pathPoints: number[]
  contextMenu: ContextMenuState | null
  dialog: DialogState | null
  /** Show unset attributes as ghost lines in the code pane (D35). */
  showDefaults: boolean
  help: boolean
  /** The export dialog is open (D132). */
  exportOpen: boolean

  setTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  /** Play or pause. Playing from the end starts over. */
  togglePlaying: () => void
  toggleLoop: () => void
  toggleSnap: () => void
  toggleFrameSnap: () => void
  setWheelStep: (frames: number) => void
  /** Pause and move the playhead by a number of frames, snapped to the frame grid. */
  stepFrames: (frames: number) => void
  select: (names: string[]) => void
  selectAction: (object: string, index: number) => void
  selectActions: (refs: ActionRef[]) => void
  /** Add an action to the selected actions, or take it out (D97). */
  toggleSelectedAction: (object: string, index: number) => void
  /** Add an object to the selection, or take it out (D89). */
  toggleSelected: (name: string) => void
  setTransformMode: (mode: TransformMode) => void
  cycleTransformMode: () => void
  setPreviewSnap: (snap: Partial<PreviewSnap>) => void
  setCollide: (on: boolean) => void
  setPush: (on: boolean) => void
  setSoft: (name: string, soft: boolean) => void
  setAnchored: (name: string, anchored: boolean) => void
  setPin: (pin: Pin) => void
  setChain: (chain: boolean) => void
  openLinksDialog: (target: LinksTarget) => void
  closeLinksDialog: () => void
  setHoverTimeline: (over: boolean) => void
  setActivePane: (pane: 'preview' | 'timeline' | 'objects' | 'code' | 'now' | null) => void
  setAnchor: (anchor: Anchor) => void
  setClipboard: (clip: Clip | null) => void
  toggleCollapsed: (pane: Pane, key: string) => void
  /** Fold every listed key in a pane, or unfold all with null. */
  setAllCollapsed: (pane: Pane, keys: string[] | null) => void
  openClassesDialog: (names: string[]) => void
  closeClassesDialog: () => void
  setTool: (tool: Tool) => void
  setPathMode: (mode: 'edit' | 'move') => void
  toggleShowPaths: () => void
  setPathHidden: (key: string, hidden: boolean) => void
  setPathPoints: (indices: number[]) => void
  setAddKind: (kind: ObjectKind) => void
  openMenu: (menu: ContextMenuState) => void
  closeMenu: () => void
  openDialog: (dialog: DialogState) => void
  closeDialog: () => void
  toggleDefaults: () => void
  setHelp: (open: boolean) => void
  setExportOpen: (open: boolean) => void
  setPrefsOpen: (open: boolean) => void
  setPrefs: (prefs: Partial<Prefs>) => void
}

function createAppStore() {
  const store = create<State>((set, get) => {
    /** Change the selection and hand the step to the history, unless it is the history applying one. */
    const changeSelection = (after: SelectionState) => {
      const s = get()
      const before: SelectionState = { selection: s.selection, selectedActions: s.selectedActions }
      if (sameSelection(before, after)) return
      set({ selection: after.selection, selectedActions: after.selectedActions, selectedAction: after.selectedActions[0] ?? null, pathPoints: [] })
      if (!applying) selectionSink?.(before, after)
    }
    const objectsOf = (refs: ActionRef[]): string[] => [...new Set(refs.map((r) => r.object))]
    /** One set of things is one selection: members of a selected group drop out, and exactly a group's members become the group (D124). */
    const normalized = (names: string[]): string[] => {
      const model = get().model
      return model ? normalizeSelection(model, names) : names
    }
    return {
      settings: { width: 1920, height: 1080, fps: 60, hold: 0, background: '#1c1c1c' },
      time: 0,
      playing: false,
      playStart: null,
      loop: false,
      snap: true,
      frameSnap: loadChoice<'on' | 'off'>(FRAME_SNAP_KEY, ['on', 'off'], 'on') === 'on',
      wheelStep: loadWheelStep(),
      contentEnd: null,
      playbackEnd: null,
      prefs: loadPrefs(),
      prefsOpen: false,
      selection: [],
      selectedActions: [],
      selectedAction: null,
      transformMode: 'all',
      previewSnap: loadPreviewSnap(),
      collide: loadChoice<'on' | 'off'>(COLLIDE_KEY, ['on', 'off'], 'off') === 'on',
      push: loadChoice<'on' | 'off'>(PUSH_KEY, ['on', 'off'], 'off') === 'on',
      soft: [],
      anchored: [],
      pin: loadChoice<Pin>(PIN_KEY, ['start', 'end'], 'start'),
      chain: loadChoice<'on' | 'off'>(CHAIN_KEY, ['on', 'off'], 'off') === 'on',
      linksDialog: null,
      activePane: null,
      hoverTimeline: false,
      anchor: loadChoice<Anchor>(ANCHOR_KEY, ['edge', 'center'], 'edge'),
      clipboard: null,
      collapsed: { objects: {}, timeline: {} },
      classesDialog: null,
      project: null,
      source: '',
      model: null,
      error: null,
      tool: 'select',
      pathMode: 'edit',
      showPaths: loadChoice<'on' | 'off'>(SHOW_PATHS_KEY, ['on', 'off'], 'on') === 'on',
      hiddenPaths: [],
      addKind: 'Rect',
      pathPoints: [],
      contextMenu: null,
      dialog: null,
      showDefaults: loadShowDefaults(),
      help: false,
      exportOpen: false,

      setTime: (time) => set({ time: Math.max(0, time) }),
      setPlaying: (playing) => set((s) => (playing && !s.playing ? { playing, playStart: s.time } : { playing })),
      togglePlaying: () =>
        set((s) => {
          // Pausing returns the playhead to where playback started (D126); playing from the end starts over (D59).
          if (s.playing) return { playing: false, time: s.playStart ?? s.time }
          const from = s.playbackEnd !== null && s.time >= s.playbackEnd ? 0 : s.time
          return { playing: true, time: from, playStart: from }
        }),
      toggleLoop: () => set((s) => ({ loop: !s.loop })),
      toggleSnap: () => set((s) => ({ snap: !s.snap })),
      toggleFrameSnap: () =>
        set((s) => {
          saveChoice(FRAME_SNAP_KEY, s.frameSnap ? 'off' : 'on')
          return { frameSnap: !s.frameSnap }
        }),
      setWheelStep: (frames) => {
        const wheelStep = Math.max(1, Math.round(frames) || 1)
        try {
          localStorage.setItem(WHEEL_STEP_KEY, String(wheelStep))
        } catch {
          // Preference only.
        }
        set({ wheelStep })
      },
      stepFrames: (frames) => {
        const { time, settings } = get()
        const next = snapToFrame(time, settings.fps) + frames / settings.fps
        set({ playing: false, time: Math.max(0, snapToFrame(next, settings.fps)) })
      },
      select: (selection) => changeSelection({ selection: normalized(selection), selectedActions: [] }),
      selectAction: (object, index) => changeSelection({ selection: [object], selectedActions: [{ object, index }] }),
      selectActions: (refs) => changeSelection({ selection: objectsOf(refs), selectedActions: refs }),
      toggleSelectedAction: (object, index) => {
        const current = get().selectedActions
        const without = current.filter((r) => !(r.object === object && r.index === index))
        const refs = without.length < current.length ? without : [...current, { object, index }]
        changeSelection({ selection: objectsOf(refs), selectedActions: refs })
      },
      toggleSelected: (name) => {
        const { selection: current, model } = get()
        // Ctrl-click on something the selected group carries picks that thing alone; otherwise it joins or leaves (D89, D124).
        const group = current.length === 1 && model ? model.objects.find((o) => o.name === current[0] && o.className === GROUP) : undefined
        if (group && model && name !== group.name && groupCarries(model, group.name).includes(name)) {
          changeSelection({ selection: [name], selectedActions: [] })
          return
        }
        changeSelection({ selection: normalized(current.includes(name) ? current.filter((n) => n !== name) : [...current, name]), selectedActions: [] })
      },
      setTransformMode: (transformMode) => set({ transformMode }),
      cycleTransformMode: () => set((s) => ({ transformMode: TRANSFORM_MODES[(TRANSFORM_MODES.indexOf(s.transformMode) + 1) % TRANSFORM_MODES.length]! })),
      setPreviewSnap: (partial) =>
        set((s) => {
          const previewSnap = { ...s.previewSnap, ...partial }
          try {
            localStorage.setItem(SNAP_KEY, JSON.stringify(previewSnap))
          } catch {
            // Preference only.
          }
          return { previewSnap }
        }),
      setCollide: (collide) => {
        saveChoice(COLLIDE_KEY, collide ? 'on' : 'off')
        set({ collide })
      },
      setPush: (push) => {
        saveChoice(PUSH_KEY, push ? 'on' : 'off')
        set({ push })
      },
      setSoft: (name, soft) =>
        set((s) => {
          const next = soft ? [...new Set([...s.soft, name])] : s.soft.filter((n) => n !== name)
          saveNames(SOFT_KEY, s.project?.path ?? '', next)
          return { soft: next }
        }),
      setAnchored: (name, anchored) =>
        set((s) => {
          const next = anchored ? [...new Set([...s.anchored, name])] : s.anchored.filter((n) => n !== name)
          saveNames(ANCHORED_KEY, s.project?.path ?? '', next)
          return { anchored: next }
        }),
      setPin: (pin) => {
        saveChoice(PIN_KEY, pin)
        set({ pin })
      },
      setChain: (chain) => {
        saveChoice(CHAIN_KEY, chain ? 'on' : 'off')
        set({ chain })
      },
      openLinksDialog: (linksDialog) => set({ linksDialog, contextMenu: null }),
      closeLinksDialog: () => set({ linksDialog: null }),
      setActivePane: (activePane) => set((s) => (s.activePane === activePane ? s : { activePane })),
      setHoverTimeline: (hoverTimeline) => set((s) => (s.hoverTimeline === hoverTimeline ? s : { hoverTimeline })),
      setAnchor: (anchor) => {
        saveChoice(ANCHOR_KEY, anchor)
        set({ anchor })
      },
      setClipboard: (clipboard) => set({ clipboard }),
      toggleCollapsed: (pane, key) =>
        set((s) => {
          const keys = { ...s.collapsed[pane] }
          if (keys[key]) delete keys[key]
          else keys[key] = true
          return { collapsed: { ...s.collapsed, [pane]: keys } }
        }),
      setAllCollapsed: (pane, keys) => set((s) => ({ collapsed: { ...s.collapsed, [pane]: keys ? Object.fromEntries(keys.map((k) => [k, true as const])) : {} } })),
      openClassesDialog: (classesDialog) => set({ classesDialog, contextMenu: null }),
      closeClassesDialog: () => set((s) => (s.classesDialog ? { classesDialog: null } : s)),
      setTool: (tool) => set((s) => ({ tool, hiddenPaths: tool === 'path' ? s.hiddenPaths : [] })),
      setPathMode: (pathMode) => set({ pathMode }),
      toggleShowPaths: () =>
        set((s) => {
          saveChoice(SHOW_PATHS_KEY, s.showPaths ? 'off' : 'on')
          return { showPaths: !s.showPaths }
        }),
      setPathHidden: (key, hidden) => set((s) => ({ hiddenPaths: hidden ? [...new Set([...s.hiddenPaths, key])] : s.hiddenPaths.filter((k) => k !== key) })),
      setPathPoints: (pathPoints) => set({ pathPoints }),
      setAddKind: (addKind) => set({ addKind }),
      openMenu: (contextMenu) => set({ contextMenu }),
      closeMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : s)),
      openDialog: (dialog) => set({ dialog, contextMenu: null }),
      closeDialog: () => set((s) => (s.dialog ? { dialog: null } : s)),
      toggleDefaults: () =>
        set((s) => {
          const showDefaults = !s.showDefaults
          try {
            localStorage.setItem(DEFAULTS_KEY, String(showDefaults))
          } catch {
            // Preference only.
          }
          return { showDefaults }
        }),
      setHelp: (help) => set({ help }),
      setExportOpen: (exportOpen) => set({ exportOpen, contextMenu: null }),
      setPrefsOpen: (prefsOpen) => set({ prefsOpen, contextMenu: null }),
      setPrefs: (partial) =>
        set((s) => {
          const prefs = { ...s.prefs, ...partial }
          savePrefs(prefs)
          return { prefs }
        }),
    }
  })
  return store
}

type AppStore = ReturnType<typeof createAppStore>

// One store per page. Vite hot updates re-execute this module when anything it imports changes;
// without this, each update would create a second store and the panes would stop agreeing.
const hot = import.meta.hot
export const useStore: AppStore = (hot?.data.store as AppStore | undefined) ?? createAppStore()
if (hot) hot.data.store = useStore

/** The selection as one value, for history steps. */
export function currentSelection(): SelectionState {
  const s = useStore.getState()
  return { selection: s.selection, selectedActions: s.selectedActions }
}

/** Set the selection on behalf of the history: this is not a new step. */
export function applySelection(state: SelectionState): void {
  applying = true
  try {
    const s = useStore.getState()
    if (state.selectedActions.length > 0) s.selectActions(state.selectedActions)
    else s.select(state.selection)
  } finally {
    applying = false
  }
}

/** True when an action is among the selected ones. */
export function isActionSelected(refs: ActionRef[], object: string, index: number): boolean {
  return refs.some((r) => r.object === object && r.index === index)
}
