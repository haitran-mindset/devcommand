import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSettingsStore, type SettingsStore } from '../src/main/infrastructure/database/store'
import { savedCommandFieldsSchema, savedCommandSaveSchema, savedCommandTitle } from '../src/shared/saved-commands'
import { SavedCommandService } from '../src/main/services/saved-commands/service'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import type { TerminalManager } from '../src/main/services/terminal/manager'

vi.mock('../src/main/services/cli/probe', () => ({ findExecutable: (name: string) => name === 'bash' ? '/bin/bash' : undefined }))
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const fields = { title: 'Local server', command: 'npm run dev', description: 'Development', tags: ['node'] }
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'devcommand-saved-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const store = openSettingsStore(join(root, 'settings.sqlite'))
  cleanups.push(() => store.close())
  const directory = join(root, 'repository'); mkdirSync(directory)
  let currentRoot = directory, terminalRoot = directory, now = 1000
  const terminalId = randomUUID()
  const workspace = { resolve: vi.fn(async () => ({ rootPath: currentRoot })) } as unknown as WorkspaceService
  const startProgram = vi.fn(() => ({ id: randomUUID(), shell: 'fixture', cwd: directory, status: 'running' as const }))
  const currentDirectory = vi.fn(async (id: string) => { if (id !== terminalId) throw new Error('Unknown terminal'); return terminalRoot })
  const terminals = { startProgram, currentDirectory } as unknown as TerminalManager
  const service = new SavedCommandService(store, workspace, terminals, () => now)
  return { root, store, directory, service, startProgram, currentDirectory, terminalId, setTerminalRoot: (path: string) => { terminalRoot = path }, workspace, workspaceId: randomUUID(), setRoot: (path: string) => { currentRoot = path }, expire: () => { now += 60001 } }
}
describe('saved command contracts', () => {
  it('preserves shell content and normalizes tags and line endings', () => {
    const command = "printf '%s\\n' \"$HOME\"\r\nprintf 'done'"
    const parsed = savedCommandFieldsSchema.parse({ ...fields, command, tags: [' Git ', 'git', 'deploy'] })
    expect(parsed.command).toBe(command.replace(/\r\n/g, '\n'))
    expect(parsed.tags).toEqual(['git', 'deploy'])
  })
  it('accepts blank or omitted titles and derives a compact display title without changing command text', () => {
    const command = "\n  printf 'hello'\n  printf 'world'"
    const parsed = savedCommandSaveSchema.parse({ command, description: '', tags: [] })
    expect(parsed.title).toBe('')
    expect(parsed.command).toBe(command)
    expect(savedCommandTitle(parsed)).toBe("printf 'hello'")
    expect(savedCommandTitle({ ...parsed, title: 'My command' })).toBe('My command')
    expect(savedCommandTitle({ title: '', command: 'x'.repeat(500) })).toHaveLength(100)
    const f = fixture(), entry = f.store.saveSavedCommand({ command, description: '', tags: [] })
    expect(entry.title).toBe('')
    expect(f.store.listSavedCommands()[0].title).toBe('')
  })
  it('rejects control sequences, empty text, unknown fields and incomplete edit references', () => {
    for (const command of ['', '  \n', 'echo ok\u001b[31m', 'echo\0bad', 'a'.repeat(8193)]) expect(savedCommandFieldsSchema.safeParse({ ...fields, command }).success).toBe(false)
    expect(savedCommandFieldsSchema.safeParse({ ...fields, tags: ['bad,tag'] }).success).toBe(false)
    expect(savedCommandFieldsSchema.safeParse({ ...fields, tags: Array.from({ length: 13 }, (_, n) => `tag${n}`) }).success).toBe(false)
    expect(savedCommandSaveSchema.safeParse({ ...fields, id: randomUUID() }).success).toBe(false)
    expect(savedCommandSaveSchema.safeParse({ ...fields, cwd: '/tmp' }).success).toBe(false)
  })
})
describe('saved command persistence', () => {
  it('migrates v4 without losing preferences, repositories or favorites; CRUD persists across reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'devcommand-saved-migration-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, 'settings.sqlite')
    let store: SettingsStore = openSettingsStore(path)
    store.update({ theme: 'light' }); store.addWorkspace('/fixture/repository'); store.favoriteCommand('git.status', true)
    store.close()
    const old = new Database(path); old.exec('DROP TABLE saved_commands; PRAGMA user_version=4;'); old.close()
    store = openSettingsStore(path)
    expect(store.get().theme).toBe('light'); expect(store.listWorkspaces()).toHaveLength(1); expect(store.favorites()).toEqual(['git.status'])
    const created = store.saveSavedCommand(fields)
    const edited = store.saveSavedCommand({ ...fields, title: 'New title', id: created.id, revision: created.revision })
    expect(edited.id).toBe(created.id)
    store.close()
    store = openSettingsStore(path)
    try {
      expect(store.listSavedCommands()).toEqual([edited])
      store.removeSavedCommand({ id: edited.id, revision: edited.revision })
      expect(store.listSavedCommands()).toEqual([])
    } finally { store.close() }
  })
  it('rejects stale edits and deletes and treats SQL punctuation as data', () => {
    const f = fixture()
    const entry = f.store.saveSavedCommand({ ...fields, title: "'; DROP TABLE saved_commands; --" })
    const updated = f.store.saveSavedCommand({ ...fields, id: entry.id, revision: entry.revision, command: 'printf changed' })
    expect(() => f.store.saveSavedCommand({ ...fields, id: entry.id, revision: entry.revision })).toThrow('changed')
    expect(() => f.store.removeSavedCommand({ id: entry.id, revision: entry.revision })).toThrow('changed')
    expect(f.store.listSavedCommands()[0]).toEqual(updated)
  })
  it('persists manual order, keeps hidden entries and does not reorder on edits or tag changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'devcommand-saved-order-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, 'settings.sqlite')
    let store = openSettingsStore(path)
    try {
      const a = store.saveSavedCommand({ ...fields, title: 'A' }), b = store.saveSavedCommand({ ...fields, title: 'B' }), c = store.saveSavedCommand({ ...fields, title: 'C' }), d = store.saveSavedCommand({ ...fields, title: 'D' })
      const ids = () => store.listSavedCommands().map(entry => entry.id)
      expect(ids()).toEqual([d.id, c.id, b.id, a.id])
      store.moveSavedCommand({ sourceId: a.id, targetId: c.id, placement: 'before' })
      expect(ids()).toEqual([d.id, a.id, c.id, b.id])
      store.moveSavedCommand({ sourceId: d.id, targetId: b.id, placement: 'after' })
      expect(ids()).toEqual([a.id, c.id, b.id, d.id])
      expect(store.requireSavedCommand(a.id, a.revision)).toEqual(a)
      store.saveSavedCommand({ ...fields, title: 'Edited A', id: a.id, revision: a.revision })
      store.tagSavedCommands({ ids: [b.id], tag: 'group', operation: 'add' })
      expect(ids()).toEqual([a.id, c.id, b.id, d.id])
      store.moveSavedCommand({ sourceId: c.id, targetId: c.id, placement: 'before' })
      expect(() => store.moveSavedCommand({ sourceId: a.id, targetId: randomUUID(), placement: 'after' })).toThrow('changed')
      expect(ids()).toEqual([a.id, c.id, b.id, d.id])
      store.removeSavedCommand({ id: c.id, revision: c.revision })
      const e = store.saveSavedCommand({ ...fields, title: 'E' })
      expect(ids()).toEqual([e.id, a.id, b.id, d.id])
      store.close(); store = openSettingsStore(path)
      expect(ids()).toEqual([e.id, a.id, b.id, d.id])
    } finally { store.close() }
  })
  it('renames tags globally, merges duplicates and preserves commands and manual ordering across reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'devcommand-tag-rename-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, 'settings.sqlite')
    let store = openSettingsStore(path)
    try {
      const a = store.saveSavedCommand({ ...fields, tags: ['old', 'deploy', 'node'] })
      const b = store.saveSavedCommand({ ...fields, title: 'B', tags: ['old'] })
      const c = store.saveSavedCommand({ ...fields, title: 'C', tags: ['other'] })
      store.moveSavedCommand({ sourceId: a.id, targetId: c.id, placement: 'before' })
      const order = store.listSavedCommands().map(entry => entry.id)
      expect(store.renameSavedCommandTag({ from: ' OLD ', to: ' Deploy ' })).toBe(2)
      const after = store.listSavedCommands()
      expect(after.map(entry => entry.id)).toEqual(order)
      expect(after.find(entry => entry.id === a.id)?.tags).toEqual(['deploy', 'node'])
      expect(after.find(entry => entry.id === b.id)?.tags).toEqual(['deploy'])
      expect(after.find(entry => entry.id === c.id)).toEqual(c)
      expect(after.every(entry => entry.command === fields.command)).toBe(true)
      expect(() => store.requireSavedCommand(a.id, a.revision)).toThrow('changed')
      store.close(); store = openSettingsStore(path)
      expect(store.listSavedCommands()).toEqual(after)
      expect(store.renameSavedCommandTag({ from: 'deploy', to: 'deploy' })).toBe(0)
    } finally { store.close() }
  })
  it('rejects missing or invalid rename targets without changing any tags', () => {
    const f = fixture(), entry = f.store.saveSavedCommand(fields)
    expect(() => f.store.renameSavedCommandTag({ from: 'missing', to: 'new' })).toThrow('no longer exists')
    for (const to of ['', 'bad,tag', 'x'.repeat(41), 'bad\u0000tag']) expect(() => f.store.renameSavedCommandTag({ from: 'node', to })).toThrow()
    expect(f.store.listSavedCommands()).toEqual([entry])
  })
  it('clears only saved commands and ordering, preserving preferences, repositories and Favorites', () => {
    const f = fixture()
    f.store.update({ theme: 'light' }); f.store.favoriteCommand('git.status', true)
    const workspace = f.store.addWorkspace(f.directory)
    const a = f.store.saveSavedCommand(fields), b = f.store.saveSavedCommand({ ...fields, title: '' })
    f.store.moveSavedCommand({ sourceId: a.id, targetId: b.id, placement: 'before' })
    f.store.clearSavedCommands({ entries: [a, b].map(({ id, revision }) => ({ id, revision })) })
    expect(f.store.listSavedCommands()).toEqual([])
    expect(f.store.get().theme).toBe('light'); expect(f.store.favorites()).toEqual(['git.status'])
    expect(f.store.listWorkspaces()[0].id).toBe(workspace.id)
    const fresh = f.store.saveSavedCommand(fields)
    expect(f.store.listSavedCommands().map(entry => entry.id)).toEqual([fresh.id])
  })
  it('refuses delete-all when its snapshot is missing, duplicated or stale', () => {
    const f = fixture(), a = f.store.saveSavedCommand(fields)
    const snapshot = { entries: [{ id: a.id, revision: a.revision }] }
    const b = f.store.saveSavedCommand({ ...fields, title: 'Added later' })
    expect(() => f.store.clearSavedCommands(snapshot)).toThrow('changed')
    expect(() => f.store.clearSavedCommands({ entries: [] })).toThrow()
    expect(() => f.store.clearSavedCommands({ entries: [snapshot.entries[0], snapshot.entries[0]] })).toThrow()
    const both = { entries: [a, b].map(({ id, revision }) => ({ id, revision })) }
    f.store.saveSavedCommand({ ...fields, id: a.id, revision: a.revision, title: 'Edited later' })
    expect(() => f.store.clearSavedCommands(both)).toThrow('changed')
    expect(f.store.listSavedCommands()).toHaveLength(2)
  })
  it('tags multiple commands and rolls back all changes if one selection is missing or a tag limit is exceeded', () => {
    const f = fixture(), a = f.store.saveSavedCommand(fields), b = f.store.saveSavedCommand({ ...fields, title: 'Second' })
    f.store.tagSavedCommands({ ids: [a.id, b.id], tag: ' Deploy ', operation: 'add' })
    expect(f.store.listSavedCommands().every(entry => entry.tags.includes('deploy'))).toBe(true)
    const before = f.store.listSavedCommands()
    expect(() => f.store.tagSavedCommands({ ids: [a.id, randomUUID()], tag: 'atomic', operation: 'add' })).toThrow('removed')
    expect(f.store.listSavedCommands()).toEqual(before)
    const full = f.store.saveSavedCommand({ ...fields, title: 'Full', tags: Array.from({ length: 12 }, (_, n) => `tag${n}`) })
    expect(() => f.store.tagSavedCommands({ ids: [a.id, full.id], tag: 'overflow', operation: 'add' })).toThrow('12')
    expect(f.store.listSavedCommands().find(entry => entry.id === a.id)?.tags).not.toContain('overflow')
    f.store.tagSavedCommands({ ids: [a.id, b.id], tag: 'deploy', operation: 'remove' })
    expect(f.store.listSavedCommands().every(entry => !entry.tags.includes('deploy'))).toBe(true)
  })
})
describe('saved command terminal confirmation', () => {
  it('never executes during save/preview; passes multiline code as one argv only after confirmation', async () => {
    const f = fixture(), command = "printf '%s\\n' 'hello; world'\nprintf '%s' \"$HOME\""
    const entry = f.store.saveSavedCommand({ ...fields, command })
    const request = { id: entry.id, revision: entry.revision, workspaceId: f.workspaceId }
    const preview = await f.service.preview(request)
    expect(preview.command).toBe(command); expect(preview.cwd).toBe(f.directory); expect(f.startProgram).not.toHaveBeenCalled()
    await expect(f.service.run(request, randomUUID())).rejects.toThrow('Confirmation')
    await f.service.run(request, preview.token)
    expect(f.startProgram).toHaveBeenCalledExactlyOnceWith({ executable: '/bin/bash', argv: ['-c', command], cwd: f.directory, label: entry.title, keepShell: true })
    await expect(f.service.run(request, preview.token)).rejects.toThrow('Confirmation')
  })
  it('uses the live active terminal directory, rechecks it on run and refuses closed terminals', async () => {
    const f = fixture(), entry = f.store.saveSavedCommand(fields)
    const downloads = join(f.root, 'Downloads with spaces'); mkdirSync(downloads)
    f.setTerminalRoot(downloads)
    const request = { id: entry.id, revision: entry.revision, workspaceId: null, terminalId: f.terminalId }
    const preview = await f.service.preview(request)
    expect(preview.cwd).toBe(downloads)
    expect(f.workspace.resolve).not.toHaveBeenCalled()
    await f.service.run(request, preview.token)
    expect(f.startProgram).toHaveBeenCalledWith(expect.objectContaining({ cwd: downloads }))
    const changed = await f.service.preview(request)
    f.setTerminalRoot(f.directory)
    await expect(f.service.run(request, changed.token)).rejects.toThrow('changed')
    const closed = await f.service.preview(request)
    f.currentDirectory.mockRejectedValueOnce(new Error('Terminal closed'))
    await expect(f.service.run(request, closed.token)).rejects.toThrow('closed')
    await expect(f.service.preview({ ...request, workspaceId: f.workspaceId })).rejects.toThrow('one Run target')
    expect(f.startProgram).toHaveBeenCalledTimes(1)
  })
  it('refuses expired, edited or deleted command previews', async () => {
    const f = fixture(), entry = f.store.saveSavedCommand(fields)
    const request = { id: entry.id, revision: entry.revision, workspaceId: f.workspaceId }
    const expiring = await f.service.preview(request); f.expire()
    await expect(f.service.run(request, expiring.token)).rejects.toThrow('Confirmation')
    const stale = await f.service.preview(request)
    const updated = f.store.saveSavedCommand({ ...fields, id: entry.id, revision: entry.revision, command: 'printf edited' })
    await expect(f.service.run(request, stale.token)).rejects.toThrow('changed')
    const nextRequest = { ...request, revision: updated.revision }, removed = await f.service.preview(nextRequest)
    f.store.removeSavedCommand({ id: updated.id, revision: updated.revision })
    await expect(f.service.run(nextRequest, removed.token)).rejects.toThrow('removed')
    expect(f.startProgram).not.toHaveBeenCalled()
  })
  it('rechecks the record after asynchronous workspace checks and cancels pending runs on reset', async () => {
    for (const action of ['edit', 'delete', 'reset'] as const) {
      const f = fixture(), entry = f.store.saveSavedCommand(fields)
      const request = { id: entry.id, revision: entry.revision, workspaceId: f.workspaceId }
      const preview = await f.service.preview(request)
      const resolved = await f.workspace.resolve(f.workspaceId)
      let release!: (value: Awaited<ReturnType<WorkspaceService['resolve']>>) => void
      vi.mocked(f.workspace.resolve).mockImplementationOnce(() => new Promise<Awaited<ReturnType<WorkspaceService['resolve']>>>(resolve => { release = resolve }))
      const pending = f.service.run(request, preview.token)
      if (action === 'edit') f.store.saveSavedCommand({ ...fields, id: entry.id, revision: entry.revision, command: 'printf edited' })
      else if (action === 'delete') f.store.removeSavedCommand({ id: entry.id, revision: entry.revision })
      else f.service.clear()
      release(resolved)
      await expect(pending).rejects.toThrow(action === 'edit' ? 'changed' : action === 'delete' ? 'removed' : 'session changed')
      expect(f.startProgram).not.toHaveBeenCalled()
    }
  })
  it('refuses changed or missing target directories and mismatched workspace choices', async () => {
    const f = fixture(), entry = f.store.saveSavedCommand(fields)
    const request = { id: entry.id, revision: entry.revision, workspaceId: f.workspaceId }
    const first = await f.service.preview(request)
    const other = join(f.root, 'another'); mkdirSync(other); f.setRoot(other)
    await expect(f.service.run(request, first.token)).rejects.toThrow('changed')
    const second = await f.service.preview(request)
    await expect(f.service.run({ ...request, workspaceId: null }, second.token)).rejects.toThrow('Confirmation')
    const third = await f.service.preview(request); rmSync(other, { recursive: true })
    await expect(f.service.run(request, third.token)).rejects.toThrow('directory')
    expect(f.startProgram).not.toHaveBeenCalled()
  })
})
