import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, FileChange, ProjectData } from '../shared/api'

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
}

contextBridge.exposeInMainWorld('api', api)
