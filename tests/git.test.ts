import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openSettingsStore } from '../src/main/infrastructure/database/store'
import { WorkspaceService } from '../src/main/services/workspace/service'
import { GitService, validateGitPath } from '../src/main/services/git/service'
import { GitWatcher } from '../src/main/services/git/watcher'
import { parseStatus, nulRecords } from '../src/main/services/git/parse'
import { CommandService } from '../src/main/services/commands/service'
import { ManagedRunner } from '../src/main/services/execution/runner'
import { gitSnapshotSchema, gitDiffSchema } from '../src/shared/git'
import type { CommandRequest } from '../src/shared/commands'

function fixture(initialCommit = true) {
  const root = mkdtempSync(join(tmpdir(), 'devcommand-git-manager-')), repo = join(root, 'repo with 日本語')
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
  const git = (args: string[]) => execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  if (initialCommit) { writeFileSync(join(repo, 'tracked.txt'), 'base\n'); git(['add', '.']); git(['commit', '-m', 'Initial fixture']) }
  const store = openSettingsStore(join(root, 'data.sqlite')), workspace = new WorkspaceService(store), reader = new GitService(workspace)
  const runner: ManagedRunner = new ManagedRunner((event) => { if (event.type === 'status' && event.status !== 'running') commands.completed(event.executionId) })
  const commands = new CommandService(store, workspace, runner)
  const id = workspace.addDirectory(repo).then((entry) => entry.id)
  const execute = async (commandId: string, params: Record<string, string> = {}) => {
    const request: CommandRequest = { commandId, params, workspaceId: await id }
    const preview = await commands.preview(request)
    const { executionId } = await commands.execute(request, preview.confirmationToken)
    await until(() => !!runner.list().find((entry) => entry.id === executionId)?.finishedAt)
    return runner.list().find((entry) => entry.id === executionId)!
  }
  return { root, repo, git, store, workspace, reader, runner, commands, id, execute, close: async () => { await runner.closeAll(); store.close(); rmSync(root, { recursive: true, force: true }) } }
}
async function until(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Git condition timed out'); await new Promise((resolve) => setTimeout(resolve, 15)) }
}
describe('Git machine-readable contracts', () => {
  it('preserves rename order, Unicode, whitespace and conflict markers in porcelain -z', () => {
    const files = parseStatus('R  new 日本語.txt\0old name.txt\0?? trailing \0UU conflict.txt\0')
    expect(files[0]).toMatchObject({ path: 'new 日本語.txt', originalPath: 'old name.txt', indexStatus: 'R' })
    expect(files[1]).toMatchObject({ path: 'trailing ', untracked: true })
    expect(files[2].conflicted).toBe(true)
    expect(nulRecords('main\0abc\0*\0\nfeature\0def\0 \0\n', 3)).toEqual([['main', 'abc', '*'], ['feature', 'def', ' ']])
    expect(() => parseStatus('R  missing-source\0')).toThrow()
  })
  it('rejects arbitrary paths/process options and incompatible diff selectors', () => {
    for (const path of ['../outside', '/etc/passwd', '.git/config', 'a/../../x', 'C:/secret', 'a\\b', '.']) expect(() => validateGitPath(path)).toThrow()
    expect(() => validateGitPath(':(glob)* 日本語.txt')).not.toThrow()
    expect(gitSnapshotSchema.safeParse({ workspaceId: 'invalid', section: 'overview', executable: 'sh' }).success).toBe(false)
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    expect(gitDiffSchema.safeParse({ workspaceId, commit: 'HEAD;sh' }).success).toBe(false)
    expect(gitDiffSchema.safeParse({ workspaceId, commit: 'a'.repeat(40), path: 'file' }).success).toBe(false)
  })
})
describe('Git Manager real repository operations', () => {
  it('stages literal Unicode/magic paths, reads diff and unstages without losing worktree data', async () => {
    const f = fixture()
    try {
      const workspaceId = await f.id, path = ':(glob)* 日本語.txt'
      writeFileSync(join(f.repo, path), 'only this file\n'); writeFileSync(join(f.repo, 'other.txt'), 'untouched\n')
      const request = { commandId: 'git.stage', params: { path }, workspaceId }
      await expect(f.commands.execute(request)).rejects.toThrow('Confirmation')
      expect((await f.execute('git.stage', { path })).status).toBe('succeeded')
      expect(f.git(['diff', '--cached', '--name-only'])).toContain(':(glob)*')
      expect(f.git(['diff', '--cached', '--name-only'])).not.toContain('other.txt')
      const data = await f.reader.snapshot({ workspaceId, section: 'overview' })
      expect(data.files.find((entry) => entry.path === path)?.indexStatus).toBe('A')
      expect((await f.reader.diff({ workspaceId, staged: true, path })).text).toContain('+only this file')
      expect((await f.execute('git.unstage', { path })).status).toBe('succeeded')
      expect(f.git(['diff', '--cached', '--name-only'])).toBe('')
      expect(readFileSync(join(f.repo, path), 'utf8')).toBe('only this file\n')
      const shellPath = 'literal;$(touch PWNED).txt'
      writeFileSync(join(f.repo, shellPath), 'literal shell punctuation\n')
      expect((await f.execute('git.stage', { path: shellPath })).status).toBe('succeeded')
      expect(existsSync(join(f.repo, 'PWNED'))).toBe(false)
      await expect(f.reader.diff({ workspaceId, path: '../outside' })).rejects.toThrow('repository-relative')
    } finally { await f.close() }
  })
  it('unstages before an initial commit and invalidates stage tokens when untracked contents change', async () => {
    const f = fixture(false)
    try {
      const workspaceId = await f.id, path = 'new.txt'
      writeFileSync(join(f.repo, path), 'first\n')
      const request = { commandId: 'git.stage', params: { path }, workspaceId }
      const preview = await f.commands.preview(request)
      writeFileSync(join(f.repo, path), 'different content\n')
      await expect(f.commands.execute(request, preview.confirmationToken)).rejects.toThrow('state changed')
      expect((await f.execute('git.stage', { path })).status).toBe('succeeded')
      const unstagePreview = await f.commands.preview({ commandId: 'git.unstage', params: { path }, workspaceId })
      expect(unstagePreview.display).toContain('rm --cached --force')
      expect((await f.execute('git.unstage', { path })).status).toBe('succeeded')
      expect(f.git(['ls-files'])).toBe(''); expect(existsSync(join(f.repo, path))).toBe(true)
      expect((await f.reader.snapshot({ workspaceId, section: 'commits' })).commits).toEqual([])
    } finally { await f.close() }
  })
  it('reports config scopes/origin, remote updates and branch rename/switch/delete consistently with CLI', async () => {
    const f = fixture()
    try {
      const workspaceId = await f.id
      const config = (await f.reader.snapshot({ workspaceId, section: 'config' })).config.find((entry) => entry.key === 'user.name')!
      expect(config.local).toMatchObject({ value: 'Fixture', scope: 'local' }); expect(config.effective?.origin).toContain('config')
      expect((await f.execute('git.config.set', { scope: 'local', key: 'user.name', value: 'Updated fixture' })).status).toBe('succeeded')
      expect((await f.reader.snapshot({ workspaceId, section: 'config' })).config.find((entry) => entry.key === 'user.name')?.local?.value).toBe('Updated fixture')
      expect((await f.execute('git.remote.add', { name: 'origin', url: 'git@github.com:example/repo.git' })).status).toBe('succeeded')
      expect((await f.reader.snapshot({ workspaceId, section: 'remotes' })).status.remotes[0].fetchUrl).toContain('example/repo.git')
      await f.execute('git.branch.create', { branch: 'feature/test' })
      await f.execute('git.branch.rename', { branch: 'feature/test', newBranch: 'feature/renamed' })
      const branches = (await f.reader.snapshot({ workspaceId, section: 'branches' })).branches
      expect(branches.find((branch) => branch.name === 'main')?.current).toBe(true)
      expect(branches.find((branch) => branch.name === 'feature/renamed')?.merged).toBe(true)
      await f.execute('git.branch.switch', { branch: 'feature/renamed' })
      expect(f.git(['branch', '--show-current'])).toBe('feature/renamed')
      await f.execute('git.branch.switch', { branch: 'main' })
      expect((await f.execute('git.branch.delete', { branch: 'feature/renamed' })).status).toBe('succeeded')
    } finally { await f.close() }
  })
  it('refuses unmerged and linked-worktree branches and unstages both halves of a staged rename', async () => {
    const f = fixture()
    try {
      const workspaceId = await f.id
      f.git(['switch', '-c', 'unmerged']); writeFileSync(join(f.repo, 'extra.txt'), 'extra\n'); f.git(['add', '.']); f.git(['commit', '-m', 'unmerged fixture']); f.git(['switch', 'main'])
      await expect(f.commands.preview({ commandId: 'git.branch.delete', params: { branch: 'unmerged' }, workspaceId })).rejects.toThrow('unmerged commits')
      const linked = join(f.root, 'linked')
      f.git(['worktree', 'add', '-b', 'linked', linked])
      await expect(f.commands.preview({ commandId: 'git.branch.rename', params: { branch: 'linked', newBranch: 'renamed' }, workspaceId })).rejects.toThrow('worktree')
      f.git(['mv', 'tracked.txt', 'renamed.txt'])
      expect((await f.reader.snapshot({ workspaceId, section: 'overview' })).files[0].originalPath).toBe('tracked.txt')
      await f.execute('git.unstage', { path: 'renamed.txt' })
      expect(f.git(['diff', '--cached', '--name-only'])).toBe('')
      expect(existsSync(join(f.repo, 'renamed.txt'))).toBe(true)
    } finally { await f.close() }
  })
  it('paginates commits and detects stash identity shifts even when refs/stash is unchanged', async () => {
    const f = fixture()
    try {
      const workspaceId = await f.id
      for (let index = 0; index < 51; index++) f.git(['commit', '--allow-empty', '-m', `fixture ${index}`])
      const first = await f.reader.snapshot({ workspaceId, section: 'commits' }), second = await f.reader.snapshot({ workspaceId, section: 'commits', offset: 50 })
      expect(first.commits).toHaveLength(50); expect(first.hasMore).toBe(true); expect(second.commits).toHaveLength(2); expect(second.hasMore).toBe(false)
      expect((await f.reader.diff({ workspaceId, commit: second.commits.at(-1)!.oid })).text).toContain('Initial fixture')
      for (let index = 0; index < 3; index++) { writeFileSync(join(f.repo, 'tracked.txt'), `stash ${index}\n`); f.git(['stash', 'push', '-m', `fixture stash ${index}`]) }
      const stashes = (await f.reader.snapshot({ workspaceId, section: 'stash' })).stashes
      expect(stashes).toHaveLength(3)
      expect((await f.reader.diff({ workspaceId, stash: 'stash@{1}' })).text).toContain('stash 1')
      const request = { commandId: 'git.stash.drop', params: { stash: 'stash@{1}' }, workspaceId }
      await expect(f.commands.execute(request)).rejects.toThrow('Confirmation')
      const preview = await f.commands.preview(request), head = f.git(['rev-parse', 'refs/stash'])
      f.git(['stash', 'drop', 'stash@{1}'])
      expect(f.git(['rev-parse', 'refs/stash'])).toBe(head)
      await expect(f.commands.execute(request, preview.confirmationToken)).rejects.toThrow('state changed')
      await expect(f.commands.preview({ ...request, params: { ...request.params, expectedOid: stashes[1].oid } })).rejects.toThrow('selected stash changed')
      await expect(f.reader.diff({ workspaceId, stash: 'stash@{1}', expectedStashOid: stashes[1].oid })).rejects.toThrow('stash changed')
      expect((await f.execute('git.stash.drop', { stash: 'stash@{1}' })).status).toBe('succeeded')
      expect((await f.reader.snapshot({ workspaceId, section: 'stash' })).stashes).toHaveLength(1)
    } finally { await f.close() }
  }, 15000)
  it('applies/pops stashes, preserves conflicted stashes and exposes conflict state', async () => {
    const f = fixture()
    try {
      const workspaceId = await f.id
      writeFileSync(join(f.repo, 'tracked.txt'), 'saved\n')
      await f.execute('git.stash.push')
      expect((await f.execute('git.stash.apply', { stash: 'stash@{0}' })).status).toBe('succeeded')
      expect(f.git(['stash', 'list'])).not.toBe('')
      f.git(['restore', '--worktree', '--', 'tracked.txt'])
      expect((await f.execute('git.stash.pop', { stash: 'stash@{0}' })).status).toBe('succeeded')
      expect(f.git(['stash', 'list'])).toBe('')
      f.git(['restore', '--worktree', '--', 'tracked.txt'])
      writeFileSync(join(f.repo, 'tracked.txt'), 'stash conflict\n'); f.git(['stash', 'push'])
      writeFileSync(join(f.repo, 'tracked.txt'), 'branch change\n'); f.git(['add', '.']); f.git(['commit', '-m', 'conflicting fixture'])
      expect((await f.execute('git.stash.pop', { stash: 'stash@{0}' })).status).toBe('failed')
      expect(f.git(['stash', 'list'])).not.toBe('')
      const snapshot = await f.reader.snapshot({ workspaceId, section: 'overview' })
      expect(snapshot.status.conflicts).toBe(true); expect(snapshot.files.some((file) => file.conflicted)).toBe(true)
    } finally { await f.close() }
  })
  it('serializes managed operations across linked worktrees sharing Git metadata', async () => {
    const f = fixture()
    let activeId: string | undefined
    try {
      const workspaceId = await f.id, linked = join(f.root, 'linked')
      f.git(['worktree', 'add', '-b', 'linked', linked])
      const linkedId = (await f.workspace.addDirectory(linked)).id
      const execute = f.runner.execute.bind(f.runner)
      vi.spyOn(f.runner, 'execute').mockImplementation((definition) => execute({ ...definition, executable: process.execPath, argv: ['-e', 'setTimeout(()=>{},2000)'] }))
      activeId = (await f.commands.execute({ commandId: 'git.status', params: {}, workspaceId })).executionId
      await expect(f.commands.execute({ commandId: 'git.status', params: {}, workspaceId: linkedId })).rejects.toThrow('current command')
    } finally { if (activeId) await f.runner.cancel(activeId); vi.restoreAllMocks(); await f.close() }
  })
  it('does not lose trailing-space changes in confirmation fingerprints and debounces filesystem refresh', async () => {
    const f = fixture()
    let watcher: GitWatcher | undefined
    try {
      const workspaceId = await f.id
      writeFileSync(join(f.repo, 'tracked.txt'), 'changed  ')
      const request = { commandId: 'git.restore', params: {}, workspaceId }, preview = await f.commands.preview(request)
      writeFileSync(join(f.repo, 'tracked.txt'), 'changed   ')
      await expect(f.commands.execute(request, preview.confirmationToken)).rejects.toThrow('state changed')
      const events: string[] = []
      watcher = new GitWatcher(f.workspace, (id) => events.push(id))
      expect(await watcher.watch(workspaceId)).toBe(true)
      mkdirSync(join(f.repo, 'nested')); writeFileSync(join(f.repo, 'nested', 'file'), 'one'); writeFileSync(join(f.repo, 'nested', 'file'), 'two')
      await until(() => events.length > 0)
      expect(events).toEqual([workspaceId])
      await watcher.clear(); writeFileSync(join(f.repo, 'tracked.txt'), 'after close')
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(events).toHaveLength(1)
    } finally { await watcher?.clear(); await f.close() }
  })
})
