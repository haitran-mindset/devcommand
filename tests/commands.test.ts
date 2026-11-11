import { groupCommands } from '../src/shared/command-groups'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openSettingsStore } from '../src/main/infrastructure/database/store'
import { WorkspaceService } from '../src/main/services/workspace/service'
import { CommandService } from '../src/main/services/commands/service'
import { ManagedRunner } from '../src/main/services/execution/runner'
import { getDefinition, validateParams, expand, quotePosix } from '../src/main/services/commands/registry'
import { commandRequestSchema } from '../src/shared/commands'
import { defaultSettings } from '../src/shared/contracts'

function fixture(persistenceFailure = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'devcommand-phase3-'))
  const repo = join(root, 'repo with 日本語')
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  writeFileSync(join(repo, 'tracked.txt'), 'initial\n')
  git(['add', '.']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture'])
  git(['remote', 'add', 'origin', 'git@github.com:example/old.git'])
  const store = openSettingsStore(join(root, 'app.sqlite'))
  const workspace = new WorkspaceService(store)
  const runner: ManagedRunner = new ManagedRunner((event) => { if (event.type === 'status' && event.status !== 'running') commands.completed(event.executionId) })
  let now = Date.now()
  const commands = new CommandService(store, workspace, runner, () => now, persistenceFailure)
  return { root, repo, git, store, workspace, runner, commands, expire: () => { now += 61000 }, close: async () => { await runner.closeAll(); store.close(); rmSync(root, { recursive: true, force: true }) } }
}
async function finished(runner: ManagedRunner, id: string) {
  const deadline = Date.now() + 5000
  while (!runner.list().find((entry) => entry.id === id)?.finishedAt) {
    if (Date.now() > deadline) throw new Error('Execution timed out in test')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
describe('command validation and display', () => {
  it('rejects option injection, credentials and arbitrary renderer paths/process options', () => {
    for (const name of ['--upload-pack=sh', 'origin;touch /tmp/bad', '\norigin']) expect(() => validateParams(getDefinition('git.remote.remove'), { name })).toThrow()
    for (const url of ['ext::sh -c evil', 'https://token@github.com/a/b', 'https://user:secret@host/a', 'https://host/repo?token=secret', 'ssh://git@-oProxyCommand=evil/repo']) expect(() => validateParams(getDefinition('git.remote.set-url'), { name: 'origin', url })).toThrow()
    expect(commandRequestSchema.safeParse({ commandId: 'git.status', cwd: '/', executable: 'sh' }).success).toBe(false)
    expect(() => validateParams(getDefinition('git.config.set'), { scope: 'local', key: 'core.sshCommand', value: 'evil' })).toThrow()
    expect(expand(getDefinition('git.remote.set-url'), { name: 'origin', url: 'git@github.com:a/b.git' })).toEqual(['remote', 'set-url', '--', 'origin', 'git@github.com:a/b.git'])
    expect(quotePosix("a'b")).toBe("'a'\\''b'")
  })
  it('migrates v1 settings without losing preferences and persists workspace/favorites', async () => {
    const root = mkdtempSync(join(tmpdir(), 'devcommand-migration-')), path = join(root, 'old.sqlite')
    try {
      const raw = new Database(path)
      raw.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL); PRAGMA user_version=1')
      raw.prepare('INSERT INTO app_settings VALUES (?, ?)').run('preferences', JSON.stringify({ ...defaultSettings, theme: 'light' }))
      raw.close()
      const store = openSettingsStore(path)
      expect(store.get().theme).toBe('light')
      const workspace = store.addWorkspace(root)
      store.favoriteWorkspace(workspace.id, true); store.favoriteCommand('git.status', true); store.close()
      const reopened = openSettingsStore(path)
      expect(reopened.selectedWorkspace()).toBe(workspace.id)
      expect(reopened.listWorkspaces()[0].favorite).toBe(true)
      expect(reopened.favorites()).toEqual(['git.status'])
      reopened.removeWorkspace(workspace.id)
      expect(existsSync(root)).toBe(true); expect(reopened.selectedWorkspace()).toBeNull()
      reopened.close()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
describe('workspace and execution safety against real Git repositories', () => {
  it('canonicalizes roots and reports clean, dirty, detached, unborn and bare state', async () => {
    const f = fixture()
    try {
      const workspace = await f.workspace.addDirectory(f.repo)
      expect(await f.workspace.status(workspace.id)).toMatchObject({ clean: true, branch: 'main', bare: false, unborn: false, detached: false })
      writeFileSync(join(f.repo, 'tracked.txt'), 'changed\n')
      expect((await f.workspace.status(workspace.id)).clean).toBe(false)
      f.git(['checkout', '--detach'])
      expect((await f.workspace.status(workspace.id)).detached).toBe(true)
      const unborn = join(f.root, 'unborn'), bare = join(f.root, 'bare.git')
      execFileSync('git', ['init', '-b', 'main', unborn], { stdio: 'ignore' }); execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' })
      expect((await f.workspace.status((await f.workspace.addDirectory(unborn)).id)).unborn).toBe(true)
      const bareId = (await f.workspace.addDirectory(bare)).id
      expect((await f.workspace.status(bareId)).bare).toBe(true)
      await expect(f.commands.preview({ commandId: 'git.restore', params: {}, workspaceId: bareId })).rejects.toThrow('working tree')
    } finally { await f.close() }
  })
  it('validates remote, previews old/new values, executes with a one-time confirmation and saves history', async () => {
    const f = fixture()
    try {
      const workspaceId = (await f.workspace.addDirectory(f.repo)).id
      const request = { commandId: 'git.remote.set-url', params: { name: 'origin', url: 'git@github.com:example/new.git' }, workspaceId }
      await expect(f.commands.execute(request)).rejects.toThrow('Confirmation')
      const preview = await f.commands.preview(request)
      expect(preview.consequences.join(' ')).toContain('example/old.git → git@github.com:example/new.git')
      const { executionId } = await f.commands.execute(request, preview.confirmationToken)
      await finished(f.runner, executionId)
      expect(f.git(['remote', 'get-url', 'origin'])).toBe(request.params.url)
      expect(f.commands.history()[0].execution.status).toBe('succeeded')
      await expect(f.commands.execute(request, preview.confirmationToken)).rejects.toThrow('Confirmation')
      expect(f.commands.search({ query: 'change remote', category: 'all', risk: 'all', platform: 'all', favoritesOnly: false }).some((command) => command.id === request.commandId)).toBe(true)
    } finally { await f.close() }
  })
  it('rejects expired/mismatched/state-stale tokens and blocks dangerous reset/restore without confirmation', async () => {
    const f = fixture()
    try {
      const workspaceId = (await f.workspace.addDirectory(f.repo)).id
      const request = { commandId: 'git.restore', params: {}, workspaceId }
      await expect(f.commands.execute(request)).rejects.toThrow('Confirmation')
      const stale = await f.commands.preview(request)
      writeFileSync(join(f.repo, 'tracked.txt'), 'changed after preview\n')
      await expect(f.commands.execute(request, stale.confirmationToken)).rejects.toThrow('state changed')
      const mismatch = await f.commands.preview(request)
      await expect(f.commands.execute({ commandId: 'git.reset.hard', params: { ref: 'HEAD' }, workspaceId }, mismatch.confirmationToken)).rejects.toThrow('does not match')
      const expired = await f.commands.preview(request)
      f.expire()
      await expect(f.commands.execute(request, expired.confirmationToken)).rejects.toThrow('expired')
      const valid = await f.commands.preview(request)
      const { executionId } = await f.commands.execute(request, valid.confirmationToken)
      await finished(f.runner, executionId)
      expect(f.git(['diff'])).toBe('')
    } finally { await f.close() }
  })
  it('invalidates confirmation when a protected staged change becomes unstaged', async () => {
    const f = fixture()
    try {
      const workspaceId = (await f.workspace.addDirectory(f.repo)).id
      writeFileSync(join(f.repo, 'tracked.txt'), 'staged work must survive\n')
      f.git(['add', 'tracked.txt'])
      const request = { commandId: 'git.restore', params: {}, workspaceId }
      const preview = await f.commands.preview(request)
      f.git(['reset', 'HEAD', '--', 'tracked.txt'])
      await expect(f.commands.execute(request, preview.confirmationToken)).rejects.toThrow('state changed')
      expect(f.git(['diff'])).toContain('staged work must survive')
    } finally { await f.close() }
  })
  it.each(['git.remote.remove', 'git.branch.delete', 'git.reset.mixed', 'git.reset.hard'])('requires confirmation for %s and executes only in a temporary fixture', async (commandId) => {
    const f = fixture()
    try {
      const workspaceId = (await f.workspace.addDirectory(f.repo)).id
      f.git(['branch', 'finished'])
      const params: Record<string, string> = commandId === 'git.remote.remove' ? { name: 'origin' } : commandId === 'git.branch.delete' ? { branch: 'finished' } : { ref: 'HEAD' }
      const request = { commandId, params, workspaceId }
      await expect(f.commands.execute(request)).rejects.toThrow('Confirmation')
      const preview = await f.commands.preview(request)
      expect(preview.risk).toBe('dangerous')
      const { executionId } = await f.commands.execute(request, preview.confirmationToken)
      await finished(f.runner, executionId)
      expect(f.runner.list().find((entry) => entry.id === executionId)?.status).toBe('succeeded')
    } finally { await f.close() }
  })
  it('reports history storage failure without losing the started execution ID', async () => {
    let failures = 0
    const f = fixture(() => { failures++ })
    try {
      f.store.saveHistory = () => { throw new Error('simulated read-only database') }
      const { executionId } = await f.commands.execute({ commandId: 'git.version', params: {} })
      await finished(f.runner, executionId)
      expect(f.runner.list().find((entry) => entry.id === executionId)?.status).toBe('succeeded')
      expect(failures).toBeGreaterThan(0)
    } finally { await f.close() }
  })
  it('never persists sensitive config values, and revalidates removed repositories', async () => {
    const f = fixture()
    try {
      const workspaceId = (await f.workspace.addDirectory(f.repo)).id
      const request = { commandId: 'git.config.set', params: { scope: 'local', key: 'user.name', value: 'private-custom-value' }, workspaceId }
      const preview = await f.commands.preview(request)
      expect(preview.display).not.toContain('private-custom-value')
      const { executionId } = await f.commands.execute(request, preview.confirmationToken)
      await finished(f.runner, executionId)
      expect(f.git(['config', 'user.name'])).toBe('private-custom-value')
      expect(JSON.stringify(f.commands.history())).not.toContain('private-custom-value')
      expect(f.commands.history()[0].rerunnable).toBe(false)
      f.store.removeWorkspace(workspaceId)
      await expect(f.commands.preview({ commandId: 'git.status', params: {}, workspaceId })).rejects.toThrow('workspace')
    } finally { await f.close() }
  })
})

it('clears saved history without cancelling active runs or restoring cleared entries on completion', async () => {
  const f = fixture()
  try {
    const request = { commandId: 'git.version', params: {} }
    const first = await f.commands.execute(request)
    expect(f.commands.history()).toHaveLength(1)
    f.commands.clearHistory()
    expect(f.commands.history()).toHaveLength(0)
    await finished(f.runner, first.executionId)
    expect(f.runner.list().find((run) => run.id === first.executionId)?.status).toBe('succeeded')
    expect(f.commands.history()).toHaveLength(0)
    const next = await f.commands.execute(request)
    await finished(f.runner, next.executionId)
    expect(f.commands.history()).toHaveLength(1)
    f.commands.clearHistory()
    expect(f.commands.history()).toHaveLength(0)
  } finally { await f.close() }
})

describe('favorite group order', () => {
  it('moves complete groups, preserves hidden groups and leaves Commands order unchanged', async () => {
    const f = fixture()
    const query = { query: '', category: 'all' as const, risk: 'all' as const, platform: 'all' as const, favoritesOnly: true }
    try {
      for (const id of ['git.remote.list', 'git.remote.add', 'git.status', 'ngrok.http']) f.commands.favorite(id, true)
      const original = f.commands.search({ ...query, favoritesOnly: false }).map((command) => command.id)
      const groups = () => groupCommands(f.commands.search(query)).map((group) => group.id)
      expect(groups()).toEqual(['git.remotes', 'git.changes', 'ngrok'])
      f.commands.moveFavorite({ sourceId: 'ngrok', targetId: 'git.remotes', placement: 'before' })
      expect(groups()).toEqual(['ngrok', 'git.remotes', 'git.changes'])
      f.commands.moveFavorite({ sourceId: 'ngrok', targetId: 'git.remotes', placement: 'after' })
      expect(groups()).toEqual(['git.remotes', 'ngrok', 'git.changes'])
      f.commands.moveFavorite({ sourceId: 'git.changes', targetId: 'git.remotes', placement: 'before' })
      expect(groups()).toEqual(['git.changes', 'git.remotes', 'ngrok'])
      expect(groupCommands(f.commands.search({ ...query, category: 'Git' })).map((group) => group.id)).toEqual(['git.changes', 'git.remotes'])
      expect(f.commands.search(query).filter((command) => command.id.startsWith('git.remote.')).map((command) => command.id)).toEqual(['git.remote.add', 'git.remote.list'])
      expect(f.commands.search({ ...query, favoritesOnly: false }).map((command) => command.id)).toEqual(original)
      expect(new Set(f.store.favorites()).size).toBe(4)
      const reopened = openSettingsStore(join(f.root, 'app.sqlite'))
      try { expect(reopened.favoriteOrder()).toEqual(['git.changes', 'git.remotes', 'ngrok']) } finally { reopened.close() }
    } finally { await f.close() }
  })
  it('rejects stale/nonfavorite groups and malformed payloads without changing saved order', async () => {
    const f = fixture()
    try {
      f.commands.favorite('git.status', true); f.commands.favorite('ngrok.http', true)
      f.commands.moveFavorite({ sourceId: 'ngrok', targetId: 'git.changes', placement: 'before' })
      const before = f.store.favoriteOrder()
      for (const payload of [{ sourceId: 'not-a-group', targetId: 'ngrok', placement: 'after' }, { sourceId: 'git.remotes', targetId: 'ngrok', placement: 'before' }, { sourceId: 'ngrok', targetId: 'git.changes', placement: 'invalid' }, { sourceId: 'ngrok', targetId: 'git.changes', placement: 'before', extra: true }]) expect(() => f.commands.moveFavorite(payload)).toThrow()
      expect(f.store.favoriteOrder()).toEqual(before)
      f.commands.favorite('ngrok.http', false)
      expect(() => f.commands.moveFavorite({ sourceId: 'ngrok', targetId: 'git.changes', placement: 'before' })).toThrow()
    } finally { await f.close() }
  })
})
