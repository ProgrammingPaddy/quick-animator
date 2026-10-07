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

interface State {
  settings: ProjectSettings
  /** Playhead position in seconds. Never negative, not limited at the top. */
  time: number
  playing: boolean
  /** Where the content ends, or null while nothing animates. Playback loops there. */
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

  setTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  togglePlaying: () => void
  /** Pause and move the playhead by a number of frames, snapped to the frame grid. */
  stepFrames: (frames: number) => void
  select: (names: string[]) => void
  setTool: (tool: Tool) => void
}

function createAppStore() {
  return create<State>((set, get) => ({
    settings: { width: 1920, height: 1080, fps: 30 },
    time: 0,
    playing: false,
    contentEnd: null,
    selection: [],
    project: null,
    source: '',
    model: null,
    error: null,
    tool: 'select',

    setTime: (time) => set({ time: Math.max(0, time) }),
    setPlaying: (playing) => set({ playing }),
    togglePlaying: () => set((s) => ({ playing: !s.playing })),
    stepFrames: (frames) => {
      const { time, settings } = get()
      const next = snapToFrame(time, settings.fps) + frames / settings.fps
      set({ playing: false, time: Math.max(0, snapToFrame(next, settings.fps)) })
    },
    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
  }))
}

type AppStore = ReturnType<typeof createAppStore>

// One store per page. Vite hot updates re-execute this module when anything it imports changes;
// without this, each update would create a second store and the panes would stop agreeing.
const hot = import.meta.hot
export const useStore: AppStore = (hot?.data.store as AppStore | undefined) ?? createAppStore()
if (hot) hot.data.store = useStore
