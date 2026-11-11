import { dialog, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type { SettingsStore } from '../infrastructure/database/store'
import { PublicError, WorkspaceService } from '../services/workspace/service'
import { idSchema } from '../../shared/runtime'
import type { IpcHandle } from './runtime'
export function registerWorkspace(handle: IpcHandle, window: BrowserWindow, store: SettingsStore, workspaces: WorkspaceService) {
  handle('workspace:list', (payload) => { z.undefined().parse(payload); return { entries: store.listWorkspaces(), selectedId: store.selectedWorkspace() } })
  handle('workspace:add', async (payload) => {
    z.undefined().parse(payload)
    const selection = await dialog.showOpenDialog(window, { title: 'Add Git repository', properties: ['openDirectory'] })
    if (selection.canceled || !selection.filePaths[0]) return null
    return workspaces.addDirectory(selection.filePaths[0])
  })
  handle('workspace:select', async (payload) => { const id = idSchema.parse(payload); await workspaces.resolve(id); store.selectWorkspace(id); return null })
  handle('workspace:remove', (payload) => { store.removeWorkspace(idSchema.parse(payload)); return null })
  handle('workspace:favorite', (payload) => { const { id, favorite } = z.object({ id: idSchema, favorite: z.boolean() }).strict().parse(payload); store.favoriteWorkspace(id, favorite); return null })
  handle('workspace:status', (payload) => workspaces.status(idSchema.parse(payload)))
  handle('workspace:open', async (payload) => {
    const workspace = await workspaces.resolve(idSchema.parse(payload))
    const error = await shell.openPath(workspace.rootPath)
    if (error) throw new PublicError('Unable to open the repository folder. Check its path and permissions.')
    return null
  })
}
