import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { basename, extname, join } from 'node:path'
import * as opentype from 'opentype.js'
import type { ProjectData, ProjectFile, ProjectFont, ProjectSettings } from '../shared/api'

const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 60, hold: 0, background: '#1c1c1c' }

const TEMPLATE_SCENE = `// The cast: every object, one attribute per line.
box = Rect({
  x: 0,
  y: 0,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

// The script, in time order.
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
  // The project's fonts (D267): every font file in assets/fonts, known by its file name.
  const fontsDir = join(path, 'assets', 'fonts')
  const fonts: ProjectFont[] = []
  if (await exists(fontsDir)) {
    const names = (await fs.readdir(fontsDir)).filter((n) => /\.(ttf|otf|woff2?)$/i.test(n)).sort()
    for (const name of names) fonts.push({ name: basename(name, extname(name)), file: `assets/fonts/${name}`, data: new Uint8Array(await fs.readFile(join(fontsDir, name))) })
  }
  return { path, name: basename(path), settings, scenes, fonts }
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
          const full = join(path, file)
          fs.readFile(full, 'utf8')
            .then(async (source) => {
              // An empty read usually means the writer truncated the file and has not written
              // the new text yet; look again before reporting an empty scene.
              if (source === '') {
                await new Promise((resolve) => setTimeout(resolve, 100))
                source = await fs.readFile(full, 'utf8')
              }
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

export function registerProjectIpc(getWindow: () => BrowserWindow | null, options: { rememberLast?: boolean } = {}): void {
  ipcMain.handle('project:pick', async () => {
    const win = getWindow()
    // Start where the last project was, so the examples folder is a step away.
    const last = (await readSettings()).lastProject
    const options: Electron.OpenDialogOptions = { title: 'Open project folder', message: 'Pick the folder that holds project.json', properties: ['openDirectory'], defaultPath: last ?? join(app.getPath('documents')) }
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
    // A headless render must not become the project the window reopens.
    if (options.rememberLast !== false) await writeSettings({ ...(await readSettings()), lastProject: path })
    return data
  })

  ipcMain.handle('project:last', async () => {
    const settings = await readSettings()
    return settings.lastProject && (await exists(settings.lastProject)) ? settings.lastProject : null
  })

  ipcMain.handle('project:write', async (_event, path: string, file: string, source: string) => {
    await fs.writeFile(join(path, file), source)
  })

  ipcMain.handle('project:readFile', async (_event, path: string) => {
    if (!/\.svg$/i.test(path)) throw new Error('Only an .svg can be read')
    return fs.readFile(path, 'utf8')
  })

  ipcMain.handle('project:findFont', async (_event, family: string) => findFont(family))

  ipcMain.handle('project:importSvg', async () => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = { title: 'Import SVG', filters: [{ name: 'SVG', extensions: ['svg'] }], properties: ['openFile'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? undefined : result.filePaths[0]
    if (!path) return null
    return { name: basename(path, extname(path)), text: await fs.readFile(path, 'utf8') }
  })
}

/** The installed fonts by family, read once per run: each file's names, which takes a moment the first time (D273). */
let fontIndex: Promise<Map<string, { file: string; regular: boolean }>> | null = null

function fontDirs(): string[] {
  const dirs = [join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts')]
  if (process.env['LOCALAPPDATA']) dirs.push(join(process.env['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'))
  return dirs
}

function fontName(names: opentype.Font['names'], key: string): string | undefined {
  for (const platform of ['windows', 'macintosh', 'unicode']) {
    const entry = names[platform]?.[key]
    if (entry) return entry['en'] ?? Object.values(entry)[0]
  }
  const flat = (names as Record<string, Record<string, string> | undefined>)[key]
  return flat ? (flat['en'] ?? Object.values(flat)[0]) : undefined
}

async function indexFonts(): Promise<Map<string, { file: string; regular: boolean }>> {
  const index = new Map<string, { file: string; regular: boolean }>()
  const add = (name: string | undefined, file: string, regular: boolean): void => {
    if (!name) return
    const key = name.trim().toLowerCase()
    const known = index.get(key)
    if (!known || (regular && !known.regular)) index.set(key, { file, regular })
  }
  for (const dir of fontDirs()) {
    if (!(await exists(dir))) continue
    for (const name of await fs.readdir(dir)) {
      if (!/\.(ttf|otf)$/i.test(name)) continue
      const file = join(dir, name)
      try {
        const data = await fs.readFile(file)
        if (data.byteLength > 25 * 1024 * 1024) continue
        const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { lowMemory: true })
        const sub = fontName(font.names, 'fontSubfamily') ?? ''
        const regular = sub === '' || /^(regular|normal|book|roman)$/i.test(sub)
        add(fontName(font.names, 'preferredFamily'), file, regular)
        add(fontName(font.names, 'fontFamily'), file, regular)
        add(basename(name, extname(name)), file, regular)
      } catch {
        // Not a font this reader takes; the next.
      }
    }
  }
  return index
}

/** The file of an installed family, with its bytes, or null (D273). */
async function findFont(family: string): Promise<ProjectFont | null> {
  if (!fontIndex) fontIndex = indexFonts()
  const found = (await fontIndex).get(family.trim().toLowerCase())
  if (!found) return null
  return { name: family, file: found.file, data: new Uint8Array(await fs.readFile(found.file)) }
}
