import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { parseRenderCommand, registerExportIpc, registerRenderIpc } from './export'
import { registerProjectIpc } from './project'

let mainWindow: BrowserWindow | null = null

/** The headless command the app was started with (R111), its error, or null for the normal app. */
const command = parseRenderCommand(process.argv)

/** The one window. Hidden, it still renders: that is the headless mode (D25). */
function createWindow(hidden: boolean): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    show: false,
    backgroundColor: '#121212',
    title: 'Quick Animator',
    icon: join(__dirname, '../../resources/icon.png'),
    // The app draws its own top bar; the system keeps only the window controls, overlaid (D108).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#202020', symbolColor: '#d8d8d8', height: 32 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      // Keep playing and reacting while another window has focus; Chromium would otherwise
      // slow timers and animation frames to once a second in a background window.
      backgroundThrottling: false,
    },
  })
  mainWindow = win

  if (!hidden) win.on('ready-to-show', () => win.show())
  else {
    // Headless: the renderer's own errors are the only thing the terminal would otherwise never see.
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`render failed: the window ${details.reason}`)
      app.exit(1)
    })
  }
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // Pinch gestures zoom a pane, never the whole app.
  void win.webContents.setVisualZoomLevelLimits(1, 1)

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (command && 'error' in command) {
  console.error(command.error)
  app.exit(1)
} else {
  const job = command
  void app.whenReady().then(() => {
    // No system menu: nothing in it applies to the app, and Alt would pop it up (D108).
    Menu.setApplicationMenu(null)
    registerProjectIpc(() => mainWindow, { rememberLast: !job })
    registerExportIpc(() => mainWindow)
    registerRenderIpc(job, (code) => app.exit(code))
    createWindow(!!job)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(!!job)
    })
  })
}

app.on('window-all-closed', () => app.quit())
