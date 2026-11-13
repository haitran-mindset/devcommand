import { contextBridge, ipcRenderer } from 'electron'
import type { TerminalDataEvent, TerminalExitEvent, ExecutionEvent } from '../shared/runtime'
import type { DevCommandAPI } from '../shared/contracts'
function subscribe<T>(channel: string, handler: (event: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => handler(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const api: DevCommandAPI = {
  tray: { takeQuickTerminal: () => ipcRenderer.invoke('tray:take-quick-terminal'), onQuickTerminal: handler => subscribe('tray:quick-terminal', handler) },
  projectScripts: {
    list: input => ipcRenderer.invoke('project-scripts:list', input),
    preview: input => ipcRenderer.invoke('project-scripts:preview', input),
    run: input => ipcRenderer.invoke('project-scripts:run', input),
  },
  savedCommands: {
    list: () => ipcRenderer.invoke('saved-commands:list'),
    save: (input) => ipcRenderer.invoke('saved-commands:save', input),
    remove: (input) => ipcRenderer.invoke('saved-commands:remove', input),
    clear: (input) => ipcRenderer.invoke('saved-commands:clear', input),
    tag: (input) => ipcRenderer.invoke('saved-commands:tag', input),
    renameTag: (input) => ipcRenderer.invoke('saved-commands:rename-tag', input),
    move: (input) => ipcRenderer.invoke('saved-commands:move', input),
    preview: (input) => ipcRenderer.invoke('saved-commands:preview', input),
    run: (input) => ipcRenderer.invoke('saved-commands:run', input)
  },
  clipboard: { writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text) },
  ssh: {
    snapshot: () => ipcRenderer.invoke('ssh:snapshot'),
    publicKey: (name) => ipcRenderer.invoke('ssh:public-key', name),
    preview: (action) => ipcRenderer.invoke('ssh:preview', action),
    execute: (action, token) => ipcRenderer.invoke('ssh:execute', { action, token }),
    onChanged: (handler) => subscribe('ssh:changed', handler)
  },
  docker: {
    snapshot: () => ipcRenderer.invoke('docker:snapshot'),
    preview: (action) => ipcRenderer.invoke('docker:preview', action),
    execute: (action, token) => ipcRenderer.invoke('docker:execute', { action, token })
  },
  git: {
    snapshot: (request) => ipcRenderer.invoke('git:snapshot', request),
    diff: (request) => ipcRenderer.invoke('git:diff', request),
    onChanged: (handler) => subscribe<string>('git:changed', handler)
  },
  workspace: {
    open: (id) => ipcRenderer.invoke('workspace:open', id),
    list: () => ipcRenderer.invoke('workspace:list'),
    addDirectory: () => ipcRenderer.invoke('workspace:add'),
    select: (id) => ipcRenderer.invoke('workspace:select', id),
    remove: (id) => ipcRenderer.invoke('workspace:remove', id),
    favorite: (id, favorite) => ipcRenderer.invoke('workspace:favorite', { id, favorite }),
    status: (id) => ipcRenderer.invoke('workspace:status', id)
  },
  library: {
    chooseComparisonFile: (input) => ipcRenderer.invoke('library:choose-comparison-file', input),
    launch: (request, confirmationToken) => ipcRenderer.invoke('library:launch', { request, confirmationToken }),
    clearHistory: () => ipcRenderer.invoke('library:clear-history'),
    search: (request) => ipcRenderer.invoke('library:search', request),
    preview: (request) => ipcRenderer.invoke('library:preview', request),
    execute: (request, confirmationToken) => ipcRenderer.invoke('library:execute', { request, confirmationToken }),
    favorite: (commandId, favorite) => ipcRenderer.invoke('library:favorite', { commandId, favorite }),
    moveFavorite: (input) => ipcRenderer.invoke('library:move-favorite', input),
    history: () => ipcRenderer.invoke('library:history'),
    onHistoryError: (handler) => subscribe<string>('history:error', handler),
    insert: (request) => ipcRenderer.invoke('library:insert', request)
  },
  terminal: {
    environment: () => ipcRenderer.invoke('terminal:environment'),
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
    acknowledge: (sessionId, sequence) => ipcRenderer.invoke('terminal:acknowledge', { sessionId, sequence }),
    close: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId),
    onData: (handler) => subscribe<TerminalDataEvent>('terminal:data', handler),
    onExit: (handler) => subscribe<TerminalExitEvent>('terminal:exit', handler)
  },
  commands: {
    execute: (request) => ipcRenderer.invoke('commands:execute', request),
    listExecutions: () => ipcRenderer.invoke('commands:list'),
    clearFinished: () => ipcRenderer.invoke('commands:clear-finished'),
    cancel: (id) => ipcRenderer.invoke('commands:cancel', id),
    onExecutionEvent: (handler) => subscribe<ExecutionEvent>('commands:event', handler)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  },
  window: { control: (action) => ipcRenderer.invoke('window:control', action) }
}
contextBridge.exposeInMainWorld('devcommand', api)
