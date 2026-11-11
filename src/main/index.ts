import { app, BrowserWindow, dialog, session } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import log from 'electron-log/main'
import { openSettingsStore, type SettingsStore } from './infrastructure/database/store'
import { registerIpc } from './ipc/register'

const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride) app.setPath('userData', userDataOverride)

let store: SettingsStore | undefined
let unregister: (() => Promise<void>) | undefined
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
  const rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 650,
    title: 'DevCommand', icon: appIcon(), backgroundColor: '#0e101a', frame: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  await disposeCurrent()
  unregister = registerIpc(window, rendererUrl, store!)
  let closing = false
  window.on('close', (event) => {
    if (readyToQuit) return
    event.preventDefault()
    if (closing || quitting) return
    closing = true
    void disposeCurrent().finally(() => { if (!window.isDestroyed()) window.destroy() })
  })
  await window.loadURL(rendererUrl)
  window.show()
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
    await createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(fatal) })
  } catch { fatal() }
}).catch(fatal)
function fatal() {
  log.error('Application initialization failed')
  dialog.showErrorBox('DevCommand could not start', 'Unable to open the application or local settings database. Check available disk space and user-data permissions. Your data has not been reset.')
  app.quit()
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void disposeCurrent().finally(() => { store?.close(); store = undefined; readyToQuit = true; app.quit() })
})
