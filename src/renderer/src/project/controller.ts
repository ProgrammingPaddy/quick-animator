import type { FileChange, ProjectData } from '../../../shared/api'
import { createEditor, recordSelection, recordSettings, resetEditorDoc, setEditorDoc, setSettingsSink } from '../code/editor'
import { evaluateScene } from '../model/evaluate'
import type { SceneModel } from '../model/types'
import { applySelection, currentSelection, loadAnchored, loadSoft, setSelectionSink, useStore, type ProjectSettings } from '../state/store'
import { SAMPLE_SCENE } from './sample'
import { dropTargets } from '../state/dropTargets'
import { loadProjectFonts } from './fonts'
import { importSvg } from './operations'

/** Where a new version of the scene text came from. */
export type SourceOrigin = 'editor' | 'external' | 'load'

let saveTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null
/** The text of our most recent write, so the watcher's echo of it is not mistaken for an outside edit. */
let lastWritten: string | null = null
let unsubscribeWatch: (() => void) | null = null

/** Where the content ends: the last action plus the hold, or the hold alone, or nothing. */
export function contentEndFor(model: SceneModel | null): number | null {
  // The last action's end, or the last `until` an object names, whichever is later (D138). The hold is not part of it (D143).
  return model?.contentEnd ?? null
}

/** Where playback and export stop: the content end plus the hold that keeps the final frame (D54). */
export function playbackEndFor(model: SceneModel | null, settings: ProjectSettings): number | null {
  const end = contentEndFor(model)
  if (end === null) return settings.hold > 0 ? settings.hold : null
  return end + settings.hold
}

/**
 * The one way the scene text changes. Re-evaluates, keeps the last good model on error, pushes
 * the text into the editor when it did not come from there, and saves when it did.
 */
export function commitSource(source: string, origin: SourceOrigin): void {
  const { model, error } = evaluateScene(source, useStore.getState().settings.fps)
  useStore.setState((s) => {
    const next = model ?? s.model
    return { source, model: next, error, contentEnd: contentEndFor(next), playbackEnd: playbackEndFor(next, s.settings) }
  })
  // An anchor belongs to an object while it exists: one that is gone takes its anchor with it, so a new object with its name starts free (D161).
  if (model) useStore.getState().pruneAnchored(model.objects.map((o) => o.name))
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
  useStore.setState({ settings, contentEnd: contentEndFor(s.model), playbackEnd: playbackEndFor(s.model, settings) })
  const project = s.project
  if (!project || project.inMemory || !window.api) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    settingsTimer = null
    void window.api?.project.write(project.path, 'project.json', `${JSON.stringify(settings, null, 2)}\n`)
  }, 200)
}

/** The background's color as its picker was opened on it, while the picker is open (D384). */
let backgroundWas: string | null = null

/** The background's picker opens: what is picked in it shows at once, and is one undo step when it closes (D384). */
export function openBackground(): void {
  backgroundWas = useStore.getState().settings.background
}

/** Set the background's color (D364): from the open picker it shows at once and is a step when the picker closes; from anywhere else, a color beside the picker, it is a step of its own (D384). */
export function setBackground(color: string): void {
  const now = useStore.getState().settings.background
  if (color === now) return
  if (backgroundWas !== null) updateSettings({ background: color })
  else recordSettings({ background: now }, { background: color })
}

/** The background's picker closes: the color it was opened on and the one it leaves are one step of the history (D384). */
export function closeBackground(): void {
  const before = backgroundWas
  backgroundWas = null
  const after = useStore.getState().settings.background
  if (before !== null && before !== after) recordSettings({ background: before }, { background: after })
}

export function applyProject(data: ProjectData): void {
  const scene = data.scenes[0]
  lastWritten = null
  useStore.setState({
    settings: data.settings,
    project: { path: data.path, name: data.name, sceneFile: scene?.file ?? 'scenes/main.js', inMemory: false },
    selection: [],
    hidden: [],
    selectedAction: null,
    time: 0,
    playing: false,
    tool: 'select',
    contextMenu: null,
    soft: loadSoft(data.path),
    anchored: loadAnchored(data.path),
  })
  commitSource(scene?.source ?? '', 'load')
}

export async function openProject(path: string): Promise<void> {
  if (!window.api) return
  const data = await window.api.project.load(path)
  // The project's fonts first, so the scene is measured and drawn with them from its first frame (D267).
  await loadProjectFonts(data.fonts ?? [])
  applyProject(data)
}

export async function pickProject(): Promise<void> {
  const path = await window.api?.project.pick()
  if (path) await openProject(path)
}

export async function newProject(): Promise<void> {
  const path = await window.api?.project.create()
  if (path) await openProject(path)
}

/** Ask for an SVG file and put its drawing in the middle of the view (D241). */
export async function importSvgFile(): Promise<void> {
  const file = await window.api?.project.importSvg()
  if (!file) return
  importSvg(file.text, file.name, dropTargets.previewCenter?.() ?? { x: 0, y: 0 })
}

/** Wire the editor to the store, listen for outside edits, and reopen the last project. */
export function initProject(): void {
  createEditor((doc) => commitSource(doc, 'editor'), { onSelection: applySelection, getSelection: currentSelection })
  // Selection changes from the panes become steps of the one undo history (D90).
  setSelectionSink(recordSelection)
  // So do changes of the project's settings made in a pane (D384): a step says what to set, and this sets it.
  setSettingsSink(updateSettings)
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
