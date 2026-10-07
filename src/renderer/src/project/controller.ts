import type { FileChange, ProjectData } from '../../../shared/api'
import { createEditor, resetEditorDoc, setEditorDoc } from '../code/editor'
import { evaluateScene } from '../model/evaluate'
import { useStore } from '../state/store'
import { SAMPLE_SCENE } from './sample'

/** Where a new version of the scene text came from. */
export type SourceOrigin = 'editor' | 'external' | 'load'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeWatch: (() => void) | null = null

/**
 * The one way the scene text changes. Re-evaluates, keeps the last good model on error, pushes
 * the text into the editor when it did not come from there, and saves when it did.
 */
export function commitSource(source: string, origin: SourceOrigin): void {
  const { model, error } = evaluateScene(source)
  useStore.setState((s) => ({
    source,
    model: model ?? s.model,
    error,
    contentEnd: model ? model.contentEnd : s.contentEnd,
  }))
  if (origin === 'load') resetEditorDoc(source)
  else if (origin === 'external') setEditorDoc(source)
  else scheduleSave(source)
}

function scheduleSave(source: string): void {
  const project = useStore.getState().project
  if (!project || project.inMemory || !window.api) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void window.api?.project.write(project.path, project.sceneFile, source)
  }, 200)
}

export function applyProject(data: ProjectData): void {
  const scene = data.scenes[0]
  useStore.setState({
    settings: data.settings,
    project: { path: data.path, name: data.name, sceneFile: scene?.file ?? 'scenes/main.js', inMemory: false },
    selection: [],
    time: 0,
    playing: false,
    tool: 'select',
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
    if (change.source !== source) commitSource(change.source, 'external')
  })
  if (!useStore.getState().project) {
    void window.api.project.last().then((last) => {
      if (last) return openProject(last)
      return undefined
    })
  }
}
