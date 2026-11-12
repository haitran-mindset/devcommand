import { SavedCommandService } from '../services/saved-commands/service'
import { savedCommandSaveSchema, savedCommandReferenceSchema, savedCommandTagUpdateSchema, savedCommandMoveSchema, savedCommandsClearSchema, savedCommandRunSchema } from '../../shared/saved-commands'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { conciseCommandDisplay, hasControlCharacters } from '../../shared/text'
import { dialog, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { executeSchema, idSchema, terminalAckSchema, terminalCreateSchema, terminalResizeSchema, terminalWriteSchema } from '../../shared/runtime'
import { TerminalManager } from '../services/terminal/manager'
import type { SettingsStore } from '../infrastructure/database/store'
import { WorkspaceService, PublicError } from '../services/workspace/service'
import { CommandService } from '../services/commands/service'
import { commandRequestSchema, comparisonFilePickerSchema, commandExecuteSchema, searchSchema, favoriteMoveSchema } from '../../shared/commands'
import { GitService } from '../services/git/service'
import { GitWatcher } from '../services/git/watcher'
import { gitSnapshotSchema, gitDiffSchema } from '../../shared/git'
import { registerWorkspace } from './workspace'
import { ManagedRunner } from '../services/execution/runner'
import { CliProbe } from '../services/cli/probe'
import { SshService } from '../services/ssh/service'
import { sshActionSchema, dockerActionSchema } from '../../shared/extended'
import { DockerService } from '../services/docker/service'

export type IpcHandle = <T>(channel: string, fn: (payload: unknown) => T) => void
export function registerRuntime(handle: IpcHandle, window: BrowserWindow, store: SettingsStore) {
  const send = (channel: string, event: unknown) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    try { window.webContents.send(channel, event) } catch { /* Renderer may have exited between the lifecycle check and send. */ }
  }
  const terminals = new TerminalManager((event) => send('terminal:data', event), (event) => send('terminal:exit', event))
  const workspace = new WorkspaceService(store)
  const saved = new SavedCommandService(store, workspace, terminals)
  handle('saved-commands:list', (payload) => { if (payload !== undefined) throw new PublicError('Unexpected payload.'); return store.listSavedCommands() })
  handle('saved-commands:save', (payload) => store.saveSavedCommand(savedCommandSaveSchema.parse(payload)))
  handle('saved-commands:remove', (payload) => { store.removeSavedCommand(savedCommandReferenceSchema.parse(payload)); return null })
  handle('saved-commands:clear', (payload) => { store.clearSavedCommands(savedCommandsClearSchema.parse(payload)); return null })
  handle('saved-commands:tag', (payload) => { store.tagSavedCommands(savedCommandTagUpdateSchema.parse(payload)); return null })
  handle('saved-commands:move', (payload) => { store.moveSavedCommand(savedCommandMoveSchema.parse(payload)); return null })
  handle('saved-commands:preview', (payload) => saved.preview(savedCommandRunSchema.parse(payload)))
  handle('saved-commands:run', (payload) => { const { token, ...request } = savedCommandRunSchema.extend({ token: z.uuid() }).strict().parse(payload); return saved.run(request, token) })
  const git = new GitService(workspace)
  const watcher = new GitWatcher(workspace, (id) => send('git:changed', id))
  handle('git:snapshot', async (payload) => {
    const request = gitSnapshotSchema.parse(payload)
    const watching = await watcher.watch(request.workspaceId)
    const snapshot = await git.snapshot(request)
    if (!watching) snapshot.warnings.push('Live file watching is limited; focus and periodic refresh remain available.')
    return snapshot
  })
  handle('git:diff', (payload) => git.diff(gitDiffSchema.parse(payload)))
  const runner: ManagedRunner = new ManagedRunner((event) => {
    send('commands:event', event)
    if (event.type === 'status' && event.status !== 'running') {
      try { commands.completed(event.executionId) } catch { send('history:error', 'Execution finished, but history could not be saved.') }
    }
  })
  const probe = new CliProbe()
  const ssh = new SshService((executable, argv, cwd) => probe.run(executable, argv, cwd), undefined, () => send('ssh:changed', null))
  const commands = new CommandService(store, workspace, runner, undefined, () => send('history:error', 'The command was started, but local history could not be saved. Check disk space and permissions.'), probe.run, ssh)
  registerWorkspace(handle, window, store, workspace)
  const empty = (payload: unknown) => z.undefined().parse(payload)
  const docker = new DockerService(probe.run, workspace, runner)
  handle('docker:snapshot', (payload) => { empty(payload); return docker.snapshot() })
  handle('docker:preview', (payload) => docker.preview(dockerActionSchema.parse(payload)))
  handle('docker:execute', (payload) => { const { action, token } = z.object({ action: dockerActionSchema, token: z.string().uuid() }).strict().parse(payload); return docker.execute(action, token) })
  handle('ssh:snapshot', (payload) => { empty(payload); return ssh.snapshot() })
  handle('ssh:public-key', (payload) => ssh.publicKey(z.string().max(68).parse(payload)))
  handle('ssh:preview', (payload) => ssh.preview(sshActionSchema.parse(payload)))
  handle('ssh:execute', (payload) => { const { action, token } = z.object({ action: sshActionSchema, token: z.string().uuid() }).strict().parse(payload); return ssh.execute(action, token, terminals, runner) })
  handle('terminal:environment', (payload) => { empty(payload); return terminals.getEnvironment() })
  handle('terminal:create', (payload) => terminals.create(terminalCreateSchema.parse(payload)))
  handle('terminal:write', (payload) => { const { sessionId, data } = terminalWriteSchema.parse(payload); terminals.write(sessionId, data); return null })
  handle('terminal:resize', (payload) => { const { sessionId, cols, rows } = terminalResizeSchema.parse(payload); terminals.resize(sessionId, cols, rows); return null })
  handle('terminal:acknowledge', (payload) => { const { sessionId, sequence } = terminalAckSchema.parse(payload); terminals.acknowledge(sessionId, sequence); return null })
  handle('terminal:close', async (payload) => { await terminals.close(idSchema.parse(payload)); return null })
  handle('commands:execute', (payload) => commands.execute({ ...executeSchema.parse(payload), params: {} }))
  handle('library:search', (payload) => commands.search(searchSchema.parse(payload)))
  handle('library:preview', (payload) => commands.preview(commandRequestSchema.parse(payload)))
  handle('library:execute', (payload) => { const { request, confirmationToken } = commandExecuteSchema.parse(payload); return commands.execute(request, confirmationToken) })
  handle('library:favorite', (payload) => { const { commandId, favorite } = z.object({ commandId: z.string().max(80), favorite: z.boolean() }).strict().parse(payload); commands.favorite(commandId, favorite); return null })
  handle('library:move-favorite', (payload) => { commands.moveFavorite(favoriteMoveSchema.parse(payload)); return null })
  handle('library:clear-history', (payload) => { empty(payload); commands.clearHistory(); return null })
  let choosingComparisonFile = false
  handle('library:choose-comparison-file', async (payload) => {
    const { workspaceId } = comparisonFilePickerSchema.parse(payload)
    if (choosingComparisonFile) throw new PublicError('Finish choosing a file before opening another picker.')
    choosingComparisonFile = true
    try {
      const defaultPath = workspaceId ? (await workspace.resolve(workspaceId)).rootPath : homedir()
      const selection = await dialog.showOpenDialog(window, { title: 'Choose comparison file', buttonLabel: 'Choose file', defaultPath, properties: ['openFile'] })
      if (selection.canceled || !selection.filePaths[0]) return null
      try {
        const path = realpathSync(selection.filePaths[0])
        if (path.length > 2048 || hasControlCharacters(path) || !statSync(path).isFile()) throw new Error()
        return path
      } catch { throw new PublicError('Choose an existing regular file with a supported path.') }
    } finally { choosingComparisonFile = false }
  })
  handle('library:history', (payload) => { empty(payload); return commands.history() })
  handle('library:launch', (payload) => {
    const { request, confirmationToken } = z.object({ request: commandRequestSchema, confirmationToken: z.string().uuid() }).strict().parse(payload)
    return commands.launch(request, confirmationToken, terminals)
  })
  handle('library:insert', async (payload) => {
    const prepared = await commands.prepare(commandRequestSchema.parse(payload))
    if (process.platform === 'win32') throw new PublicError('Terminal insertion currently supports POSIX shells only.')
    if (prepared.definition.parameters.some((parameter) => parameter.sensitive)) throw new PublicError('Sensitive parameters cannot be copied or inserted. Use managed execution.')
    const environment = terminals.getEnvironment()
    const shell = environment.shells.find((entry) => entry.label === 'zsh') ?? environment.shells.find((entry) => entry.label === 'bash')
    if (!shell) throw new PublicError('Install zsh or bash to insert a command safely.')
    const draft = conciseCommandDisplay(prepared.preview.display)
    if (hasControlCharacters(draft) || draft.length > 8192) throw new PublicError('This command cannot be inserted safely into a terminal draft. Use managed execution instead.')
    if (prepared.definition.id === 'ssh.key.generate' && !existsSync(prepared.process.cwd)) throw new PublicError('Use Run Command to create your SSH directory before inserting a key-generation command.')
    const session = terminals.create({ shellId: shell.id, cols: 100, rows: 24 }, prepared.process.cwd)
    terminals.setDraft(session.id, draft)
    return session
  })
  handle('commands:list', (payload) => { empty(payload); return runner.list() })
  handle('commands:clear-finished', (payload) => { empty(payload); return runner.clearFinished() })
  handle('commands:cancel', async (payload) => { await runner.cancel(idSchema.parse(payload)); return null })
  let pending = Promise.resolve()
  const reset = () => {
    saved.clear()
    commands.clearConfirmations()
    ssh.clear()
    docker.clear()
    pending = Promise.all([terminals.closeAll(), runner.closeAll(), watcher.clear(), probe.closeAll()]).then(() => {})
    return pending
  }
  const onNavigation = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => { if (isMainFrame && !_inPlace) void reset() }
  window.webContents.on('did-start-navigation', onNavigation)
  window.webContents.on('render-process-gone', reset)
  return async () => {
    window.webContents.removeListener('did-start-navigation', onNavigation)
    window.webContents.removeListener('render-process-gone', reset)
    await reset()
    await pending
  }
}
