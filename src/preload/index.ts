import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, ExportOptions, ExportPreset, ExportResult, FileChange, ProjectData, RenderJob } from '../shared/api'

const api: Api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  project: {
    pick: () => ipcRenderer.invoke('project:pick') as Promise<string | null>,
    create: () => ipcRenderer.invoke('project:create') as Promise<string | null>,
    load: (path) => ipcRenderer.invoke('project:load', path) as Promise<ProjectData>,
    last: () => ipcRenderer.invoke('project:last') as Promise<string | null>,
    write: (path, file, source) => ipcRenderer.invoke('project:write', path, file, source) as Promise<void>,
    onChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, change: FileChange) => callback(change)
      ipcRenderer.on('project:changed', listener)
      return () => ipcRenderer.removeListener('project:changed', listener)
    },
  },
  export: {
    pickOutput: (preset: ExportPreset, suggested: string) => ipcRenderer.invoke('export:pickOutput', preset, suggested) as Promise<string | null>,
    start: (options: ExportOptions) => ipcRenderer.invoke('export:start', options) as Promise<void>,
    frame: (pixels: Uint8Array) => ipcRenderer.invoke('export:frame', pixels) as Promise<void>,
    finish: () => ipcRenderer.invoke('export:finish') as Promise<ExportResult>,
    cancel: () => ipcRenderer.invoke('export:cancel') as Promise<void>,
    reveal: (path: string) => ipcRenderer.invoke('export:reveal', path) as Promise<void>,
  },
  render: {
    job: () => ipcRenderer.invoke('render:job') as Promise<RenderJob | null>,
    progress: (frame: number, total: number) => ipcRenderer.send('render:progress', frame, total),
    done: (result: ExportResult) => ipcRenderer.send('render:done', result),
  },
}

contextBridge.exposeInMainWorld('api', api)
