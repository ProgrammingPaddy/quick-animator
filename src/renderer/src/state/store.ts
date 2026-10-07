import { create } from 'zustand'
import type { SceneError, SceneModel } from '../model/types'
import { snapToFrame } from './time'

export interface ProjectSettings {
  width: number
  height: number
  fps: number
}

/** What a click in the preview does: select, or place a new object of a class. */
export type Tool = 'select' | 'Rect' | 'Circle' | 'Text'

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

interface State {
  settings: ProjectSettings
  /** Playhead position in seconds. Never negative, not limited at the top. */
  time: number
  playing: boolean
  /** Whether playback wraps at the content end. Off by default: it stops there. */
  loop: boolean
  /** Where the content ends, or null while nothing animates. */
  contentEnd: number | null
  /** Names of the selected objects. Shared by every pane. */
  selection: string[]
  project: ProjectInfo | null
  /** The scene file text. The truth; everything else derives from it. */
  source: string
  /** The last good model. Kept while the source has an error. */
  model: SceneModel | null
  error: SceneError | null
  tool: Tool
  contextMenu: ContextMenuState | null

  setTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  /** Play or pause. Playing from the end starts over. */
  togglePlaying: () => void
  toggleLoop: () => void
  /** Pause and move the playhead by a number of frames, snapped to the frame grid. */
  stepFrames: (frames: number) => void
  select: (names: string[]) => void
  setTool: (tool: Tool) => void
  openMenu: (menu: ContextMenuState) => void
  closeMenu: () => void
}

function createAppStore() {
  return create<State>((set, get) => ({
    settings: { width: 1920, height: 1080, fps: 30 },
    time: 0,
    playing: false,
    loop: false,
    contentEnd: null,
    selection: [],
    project: null,
    source: '',
    model: null,
    error: null,
    tool: 'select',
    contextMenu: null,

    setTime: (time) => set({ time: Math.max(0, time) }),
    setPlaying: (playing) => set({ playing }),
    togglePlaying: () =>
      set((s) => {
        if (!s.playing && s.contentEnd !== null && s.time >= s.contentEnd) return { playing: true, time: 0 }
        return { playing: !s.playing }
      }),
    toggleLoop: () => set((s) => ({ loop: !s.loop })),
    stepFrames: (frames) => {
      const { time, settings } = get()
      const next = snapToFrame(time, settings.fps) + frames / settings.fps
      set({ playing: false, time: Math.max(0, snapToFrame(next, settings.fps)) })
    },
    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    openMenu: (contextMenu) => set({ contextMenu }),
    closeMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : s)),
  }))
}

type AppStore = ReturnType<typeof createAppStore>

// One store per page. Vite hot updates re-execute this module when anything it imports changes;
// without this, each update would create a second store and the panes would stop agreeing.
const hot = import.meta.hot
export const useStore: AppStore = (hot?.data.store as AppStore | undefined) ?? createAppStore()
if (hot) hot.data.store = useStore
