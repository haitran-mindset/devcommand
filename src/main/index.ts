import { app, BrowserWindow, dialog, session } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import log from 'electron-log/main'
import { openSettingsStore, type SettingsStore } from './infrastructure/database/store'
import { MenuBarCompanion } from './tray/companion'
import { registerIpc } from './ipc/register'

const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride) app.setPath('userData', userDataOverride)

let store: SettingsStore | undefined
let unregister: (() => Promise<void>) | undefined
let companion: MenuBarCompanion | undefined
let primaryWindow: BrowserWindow | undefined
let openingWindow: Promise<void> | undefined
let quitting = false
let readyToQuit = false
let pendingDispose = Promise.resolve()
function disposeCurrent(): Promise<void> {
  const dispose = unregister
  unregister = undefined
  if (dispose) pendingDispose = Promise.all([pendingDispose, dispose()]).then(() => {})
  return pendingDispose
}
const appIcon = () => app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png')
const createWindow = async () => {
  if (quitting) return
  if (primaryWindow && !primaryWindow.isDestroyed()) {
    if (primaryWindow.isMinimized()) primaryWindow.restore()
    primaryWindow.show(); primaryWindow.focus(); return
  }
  const rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 650,
    title: 'DevCommand', icon: appIcon(), backgroundColor: '#0e101a', frame: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  })
  primaryWindow = window
  window.on('closed', () => { if (primaryWindow === window) primaryWindow = undefined })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  await disposeCurrent()
  unregister = registerIpc(window, rendererUrl, store!, { takeQuickTerminal: () => companion?.takeQuickTerminal() ?? false })
  window.on('close', event => {
    if (readyToQuit || quitting) return
    event.preventDefault()
    window.hide()
  })
  await window.loadURL(rendererUrl)
  window.show()
}
const openMainWindow = () => {
  if (!openingWindow) openingWindow = createWindow().catch(fatal).finally(() => { openingWindow = undefined })
  return openingWindow
}
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon())
  log.initialize({ preload: false })
  log.transports.file.maxSize = 1024 * 1024
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    store = openSettingsStore(join(app.getPath('userData'), 'devcommand.sqlite'))
    companion = new MenuBarCompanion(appIcon(), openMainWindow, () => { if (primaryWindow && !primaryWindow.isDestroyed()) primaryWindow.webContents.send('tray:quick-terminal') }, () => app.quit())
    await openMainWindow()
    app.on('activate', () => { void openMainWindow() })
  } catch { fatal() }
}).catch(fatal)
function fatal() {
  log.error('Application initialization failed')
  dialog.showErrorBox('DevCommand could not start', 'Unable to open the application or local settings database. Check available disk space and user-data permissions. Your data has not been reset.')
  app.quit()
}
app.on('window-all-closed', () => { if (!companion && process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  companion?.destroy(); companion = undefined
  void disposeCurrent().finally(() => { store?.close(); store = undefined; readyToQuit = true; app.quit() })
})
