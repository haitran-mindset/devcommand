import { clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import log from 'electron-log/main'
import { assertTrustedSender } from '../security/sender'
import { settingsPatchSchema, windowActionSchema, type ApiResult } from '../../shared/contracts'
import { PublicError } from '../services/workspace/service'
import { registerRuntime } from './runtime'
import type { SettingsStore } from '../infrastructure/database/store'

export function registerIpc(window: BrowserWindow, rendererUrl: string, store: SettingsStore, tray?: { takeQuickTerminal: () => boolean }): () => Promise<void> {
  const authorize = (event: IpcMainInvokeEvent) => assertTrustedSender({
    senderId: event.sender.id, expectedId: window.webContents.id,
    frameUrl: event.senderFrame?.url, isMainFrame: event.senderFrame === window.webContents.mainFrame,
    rendererUrl
  })
  const channels: string[] = []
  const handle = <T>(channel: string, fn: (payload: unknown) => T) => {
    channels.push(channel)
    ipcMain.handle(channel, async (event, payload: unknown): Promise<ApiResult<Awaited<T>>> => {
      try {
        authorize(event)
        return { ok: true, data: await fn(payload) }
      } catch (error) {
        // Do not log payloads or raw exceptions: they may contain local paths or input.
        log.warn('IPC request rejected or failed', channel)
        return { ok: false, error: error instanceof PublicError ? error.message : 'Unable to complete this request. Check your settings and try again.' }
      }
    })
  }
  handle('tray:take-quick-terminal', payload => { if (payload !== undefined) throw new Error('Unexpected payload'); return tray?.takeQuickTerminal() ?? false })
  handle('settings:get', (payload) => {
    if (payload !== undefined) throw new Error('Unexpected payload')
    return store.get()
  })
  handle('settings:update', (payload) => store.update(settingsPatchSchema.parse(payload)))
  handle('clipboard:write-text', (payload) => {
    const text = z.string().max(1_048_576).parse(payload)
    clipboard.writeText(text)
    return null
  })
  handle('window:control', (payload) => {
    const action = windowActionSchema.parse(payload)
    if (action === 'minimize') window.minimize()
    if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize() }
    if (action === 'close') window.close()
    return null
  })
  const disposeRuntime = registerRuntime(handle, window, store)
  return async () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    await disposeRuntime()
  }
}
