import type { FileChange, ProjectData } from '../../../shared/api'
import { createEditor, resetEditorDoc, setEditorDoc } from '../code/editor'
import { evaluateScene } from '../model/evaluate'
import type { SceneModel } from '../model/types'
import { useStore, type ProjectSettings } from '../state/store'
import { SAMPLE_SCENE } from './sample'

/** Where a new version of the scene text came from. */
export type SourceOrigin = 'editor' | 'external' | 'load'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null
/** The text of our most recent write, so the watcher's echo of it is not mistaken for an outside edit. */
let lastWritten: string | null = null
let unsubscribeWatch: (() => void) | null = null

/** Where the content ends: the last action plus the hold, or the hold alone, or nothing. */
export function contentEndFor(model: SceneModel | null, settings: ProjectSettings): number | null {
  if (!model || model.lastActionEnd === null) return settings.hold > 0 ? settings.hold : null
  return model.lastActionEnd + settings.hold
}

/**
 * The one way the scene text changes. Re-evaluates, keeps the last good model on error, pushes
 * the text into the editor when it did not come from there, and saves when it did.
 */
export function commitSource(source: string, origin: SourceOrigin): void {
  const { model, error } = evaluateScene(source)
  useStore.setState((s) => {
    const next = model ?? s.model
    return { source, model: next, error, contentEnd: contentEndFor(next, s.settings) }
  })
  if (origin === 'load') {
    cancelSave()
    resetEditorDoc(source)
  } else if (origin === 'external') {
    // The file on disk is now the truth; a pending save would overwrite it with stale text.
    cancelSave()
    setEditorDoc(source)
  } else {
    scheduleSave(source)
  }
}

function cancelSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

function scheduleSave(source: string): void {
  const project = useStore.getState().project
  if (!project || project.inMemory || !window.api) return
  cancelSave()
  saveTimer = setTimeout(() => {
    saveTimer = null
    lastWritten = source
    void window.api?.project.write(project.path, project.sceneFile, source)
  }, 200)
}

/** Change project settings, such as the hold, and write project.json. */
export function updateSettings(partial: Partial<ProjectSettings>): void {
  const s = useStore.getState()
  const settings = { ...s.settings, ...partial }
  useStore.setState({ settings, contentEnd: contentEndFor(s.model, settings) })
  const project = s.project
  if (!project || project.inMemory || !window.api) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    settingsTimer = null
    void window.api?.project.write(project.path, 'project.json', `${JSON.stringify(settings, null, 2)}\n`)
  }, 200)
}

export function applyProject(data: ProjectData): void {
  const scene = data.scenes[0]
  lastWritten = null
  useStore.setState({
    settings: data.settings,
    project: { path: data.path, name: data.name, sceneFile: scene?.file ?? 'scenes/main.js', inMemory: false },
    selection: [],
    selectedAction: null,
    time: 0,
    playing: false,
    tool: 'select',
    contextMenu: null,
  })
  commitSource(scene?.source ?? '', 'load')
}

export async function openProject(path: string): Promise<void> {
  if (!window.api) return
  applyProject(await window.api.project.load(path))
}

export async function pickProject(): Promise<void> {
  const path = await window.api?.project.pick()
  if (path) await openProject(path)
}

export async function newProject(): Promise<void> {
  const path = await window.api?.project.create()
  if (path) await openProject(path)
}

/** Wire the editor to the store, listen for outside edits, and reopen the last project. */
export function initProject(): void {
  createEditor((doc) => commitSource(doc, 'editor'))
  if (!window.api) {
    // No file access, for example in a plain browser: work on the sample in memory.
    if (!useStore.getState().project) {
      useStore.setState({ project: { path: '', name: 'sample (in memory)', sceneFile: 'scenes/main.js', inMemory: true } })
      commitSource(SAMPLE_SCENE, 'load')
    }
    return
  }
  unsubscribeWatch?.()
  unsubscribeWatch = window.api.project.onChanged((change: FileChange) => {
    const { project, source } = useStore.getState()
    if (!project || change.path !== project.path || change.file !== project.sceneFile) return
    // Our own save echoes back through the watcher; only a genuinely different file counts.
    if (change.source === source || change.source === lastWritten) return
    commitSource(change.source, 'external')
  })
  if (!useStore.getState().project) {
    void window.api.project.last().then((last) => {
      if (last) return openProject(last)
      return undefined
    })
  }
}
