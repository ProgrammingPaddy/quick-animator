import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import type { ProjectData, ProjectFile, ProjectSettings } from '../shared/api'

const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 60, hold: 0 }

const TEMPLATE_SCENE = `// Cast: every object, one attribute per line.

box = Rect({
  x: 0,
  y: 0,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

// Script: what happens, in time order.

box.move({
  x: 320,
  at: 0.5,
  duration: 1,
})
`

interface AppSettings {
  lastProject?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as AppSettings
  } catch {
    return {}
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2))
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export async function readProject(path: string): Promise<ProjectData> {
  let settings = DEFAULT_SETTINGS
  try {
    settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(await fs.readFile(join(path, 'project.json'), 'utf8')) as Partial<ProjectSettings>) }
  } catch {
    // No or unreadable project.json: defaults apply.
  }
  const scenesDir = join(path, 'scenes')
  const scenes: ProjectFile[] = []
  if (await exists(scenesDir)) {
    const names = (await fs.readdir(scenesDir)).filter((n) => n.endsWith('.js')).sort()
    for (const name of names) scenes.push({ file: `scenes/${name}`, source: await fs.readFile(join(scenesDir, name), 'utf8') })
  }
  if (scenes.length === 0) {
    await fs.mkdir(scenesDir, { recursive: true })
    await fs.writeFile(join(scenesDir, 'main.js'), TEMPLATE_SCENE)
    scenes.push({ file: 'scenes/main.js', source: TEMPLATE_SCENE })
  }
  return { path, name: basename(path), settings, scenes }
}

export async function createProject(path: string): Promise<void> {
  await fs.mkdir(join(path, 'scenes'), { recursive: true })
  await fs.mkdir(join(path, 'assets'), { recursive: true })
  await fs.mkdir(join(path, 'lib'), { recursive: true })
  await fs.writeFile(join(path, 'project.json'), `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
  await fs.writeFile(join(path, 'scenes', 'main.js'), TEMPLATE_SCENE)
}

let watcher: FSWatcher | null = null

/** Report outside edits to scene files. Our own writes are reported too; the renderer ignores them by content. */
function watchProject(path: string, win: BrowserWindow): void {
  watcher?.close()
  watcher = null
  const timers = new Map<string, NodeJS.Timeout>()
  try {
    watcher = watch(path, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const file = filename.toString().replace(/\\/g, '/')
      if (!(file.startsWith('scenes/') && file.endsWith('.js'))) return
      clearTimeout(timers.get(file))
      timers.set(
        file,
        setTimeout(() => {
          timers.delete(file)
          fs.readFile(join(path, file), 'utf8')
            .then((source) => {
              if (!win.isDestroyed()) win.webContents.send('project:changed', { path, file, source })
            })
            .catch(() => {
              // Deleted or still being written; the next event will catch up.
            })
        }, 60),
      )
    })
  } catch (err) {
    console.error('Could not watch the project folder', err)
  }
}

export function registerProjectIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:pick', async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = { title: 'Open project folder', properties: ['openDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('project:create', async () => {
    const win = getWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'New project',
      buttonLabel: 'Create',
      defaultPath: join(app.getPath('documents'), 'my-animation'),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await createProject(result.filePath)
    return result.filePath
  })

  ipcMain.handle('project:load', async (_event, path: string) => {
    const data = await readProject(path)
    const win = getWindow()
    if (win) watchProject(path, win)
    await writeSettings({ ...(await readSettings()), lastProject: path })
    return data
  })

  ipcMain.handle('project:last', async () => {
    const settings = await readSettings()
    return settings.lastProject && (await exists(settings.lastProject)) ? settings.lastProject : null
  })

  ipcMain.handle('project:write', async (_event, path: string, file: string, source: string) => {
    await fs.writeFile(join(path, file), source)
  })
}
