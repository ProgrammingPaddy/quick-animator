import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { registerProjectIpc } from './project'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    show: false,
    backgroundColor: '#121212',
    title: 'Quick Animator',
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

  win.on('ready-to-show', () => win.show())
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

void app.whenReady().then(() => {
  // No system menu: nothing in it applies to the app, and Alt would pop it up (D108).
  Menu.setApplicationMenu(null)
  registerProjectIpc(() => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
