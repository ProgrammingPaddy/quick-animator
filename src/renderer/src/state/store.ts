import { create } from 'zustand'
import type { SceneError, SceneModel } from '../model/types'
import { snapToFrame } from './time'

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  /** Seconds kept after the last action, so the final state stays for export and looping (D54). */
  hold: number
}

/** What a click in the preview does: select, or place a new object of a class. */
export type Tool = 'select' | 'Rect' | 'Circle' | 'Text'

/**
 * What the preview's handles do to the selected object (D86). `all` shows every handle: the body
 * moves, corner and edge handles resize, a handle above rotates. The single modes show one kind.
 * Shift makes the same change an animation (D79).
 */
export type TransformMode = 'all' | 'move' | 'rotate' | 'resize'
export const TRANSFORM_MODES: TransformMode[] = ['all', 'move', 'rotate', 'resize']

/** Snapping for preview drags: positions and sizes to a grid, angles to a step (D91). */
export interface PreviewSnap {
  on: boolean
  /** Pixels. */
  grid: number
  /** Degrees. */
  angle: number
}

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
  run: () => void
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

/** What is selected, as one value, so a history step can carry it (D90). */
export interface SelectionState {
  selection: string[]
  selectedAction: ActionRef | null
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

/** What Ctrl+C took: objects with their actions, or one action, as source text (D81). */
export type Clip = { kind: 'objects'; items: ClipObject[] } | { kind: 'action'; objectName: string; verb: string; name: string | null; propsText: string }

const DEFAULTS_KEY = 'quick-animator.showDefaults'
const SNAP_KEY = 'quick-animator.previewSnap'

function loadShowDefaults(): boolean {
  try {
    return localStorage.getItem(DEFAULTS_KEY) !== 'false'
  } catch {
    return true
  }
}

function loadPreviewSnap(): PreviewSnap {
  const fallback: PreviewSnap = { on: false, grid: 10, angle: 15 }
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<PreviewSnap>
    return { on: saved.on === true, grid: saved.grid && saved.grid > 0 ? saved.grid : fallback.grid, angle: saved.angle && saved.angle > 0 ? saved.angle : fallback.angle }
  } catch {
    return fallback
  }
}

function sameSelection(a: SelectionState, b: SelectionState): boolean {
  if (a.selection.length !== b.selection.length || a.selection.some((n, i) => n !== b.selection[i])) return false
  if (!a.selectedAction || !b.selectedAction) return a.selectedAction === b.selectedAction
  return a.selectedAction.object === b.selectedAction.object && a.selectedAction.index === b.selectedAction.index
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
  /** Whether playback wraps at the content end. Off by default: it stops there. */
  loop: boolean
  /** Whether timeline drags snap to whole seconds and to other actions' starts and ends (D64). */
  snap: boolean
  /** Where the content ends, hold included, or null while nothing animates. */
  contentEnd: number | null
  /** Names of the selected objects. Shared by every pane. */
  selection: string[]
  /** The selected action, when one was picked in the timeline or the object pane. */
  selectedAction: ActionRef | null
  transformMode: TransformMode
  previewSnap: PreviewSnap
  clipboard: Clip | null
  /** Objects and class groups whose actions are folded away in the panes. */
  collapsed: Record<string, true>
  /** Objects whose classes are being edited in the Classes dialog, or null (D88). */
  classesDialog: string[] | null
  project: ProjectInfo | null
  /** The scene file text. The truth; everything else derives from it. */
  source: string
  /** The last good model. Kept while the source has an error. */
  model: SceneModel | null
  error: SceneError | null
  tool: Tool
  contextMenu: ContextMenuState | null
  dialog: DialogState | null
  /** Show unset attributes as ghost lines in the code pane (D35). */
  showDefaults: boolean
  help: boolean

  setTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  /** Play or pause. Playing from the end starts over. */
  togglePlaying: () => void
  toggleLoop: () => void
  toggleSnap: () => void
  /** Pause and move the playhead by a number of frames, snapped to the frame grid. */
  stepFrames: (frames: number) => void
  select: (names: string[]) => void
  selectAction: (object: string, index: number) => void
  /** Add an object to the selection, or take it out (D89). */
  toggleSelected: (name: string) => void
  setTransformMode: (mode: TransformMode) => void
  cycleTransformMode: () => void
  setPreviewSnap: (snap: Partial<PreviewSnap>) => void
  setClipboard: (clip: Clip | null) => void
  toggleCollapsed: (name: string) => void
  /** Fold every listed key, or unfold all with null. */
  setAllCollapsed: (names: string[] | null) => void
  openClassesDialog: (names: string[]) => void
  closeClassesDialog: () => void
  setTool: (tool: Tool) => void
  openMenu: (menu: ContextMenuState) => void
  closeMenu: () => void
  openDialog: (dialog: DialogState) => void
  closeDialog: () => void
  toggleDefaults: () => void
  setHelp: (open: boolean) => void
}

function createAppStore() {
  const store = create<State>((set, get) => {
    /** Change the selection and hand the step to the history, unless it is the history applying one. */
    const changeSelection = (after: SelectionState) => {
      const s = get()
      const before: SelectionState = { selection: s.selection, selectedAction: s.selectedAction }
      if (sameSelection(before, after)) return
      set({ selection: after.selection, selectedAction: after.selectedAction })
      if (!applying) selectionSink?.(before, after)
    }
    return {
      settings: { width: 1920, height: 1080, fps: 60, hold: 0 },
      time: 0,
      playing: false,
      loop: false,
      snap: true,
      contentEnd: null,
      selection: [],
      selectedAction: null,
      transformMode: 'all',
      previewSnap: loadPreviewSnap(),
      clipboard: null,
      collapsed: {},
      classesDialog: null,
      project: null,
      source: '',
      model: null,
      error: null,
      tool: 'select',
      contextMenu: null,
      dialog: null,
      showDefaults: loadShowDefaults(),
      help: false,

      setTime: (time) => set({ time: Math.max(0, time) }),
      setPlaying: (playing) => set({ playing }),
      togglePlaying: () =>
        set((s) => {
          if (!s.playing && s.contentEnd !== null && s.time >= s.contentEnd) return { playing: true, time: 0 }
          return { playing: !s.playing }
        }),
      toggleLoop: () => set((s) => ({ loop: !s.loop })),
      toggleSnap: () => set((s) => ({ snap: !s.snap })),
      stepFrames: (frames) => {
        const { time, settings } = get()
        const next = snapToFrame(time, settings.fps) + frames / settings.fps
        set({ playing: false, time: Math.max(0, snapToFrame(next, settings.fps)) })
      },
      select: (selection) => changeSelection({ selection, selectedAction: null }),
      selectAction: (object, index) => changeSelection({ selection: [object], selectedAction: { object, index } }),
      toggleSelected: (name) => {
        const current = get().selection
        changeSelection({ selection: current.includes(name) ? current.filter((n) => n !== name) : [...current, name], selectedAction: null })
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
      setClipboard: (clipboard) => set({ clipboard }),
      toggleCollapsed: (name) =>
        set((s) => {
          const collapsed = { ...s.collapsed }
          if (collapsed[name]) delete collapsed[name]
          else collapsed[name] = true
          return { collapsed }
        }),
      setAllCollapsed: (names) => set({ collapsed: names ? Object.fromEntries(names.map((n) => [n, true as const])) : {} }),
      openClassesDialog: (classesDialog) => set({ classesDialog, contextMenu: null }),
      closeClassesDialog: () => set((s) => (s.classesDialog ? { classesDialog: null } : s)),
      setTool: (tool) => set({ tool }),
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
  return { selection: s.selection, selectedAction: s.selectedAction }
}

/** Set the selection on behalf of the history: this is not a new step. */
export function applySelection(state: SelectionState): void {
  applying = true
  try {
    const s = useStore.getState()
    if (state.selectedAction) s.selectAction(state.selectedAction.object, state.selectedAction.index)
    else s.select(state.selection)
  } finally {
    applying = false
  }
}
