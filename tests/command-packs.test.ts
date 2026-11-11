import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { permissionArguments, permissionTarget } from '../src/main/services/commands/permissions'
import { getDefinition, registry, validateParams } from '../src/main/services/commands/registry'
import { CommandService } from '../src/main/services/commands/service'
import type { SettingsStore } from '../src/main/infrastructure/database/store'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import type { ManagedRunner, ProcessDefinition } from '../src/main/services/execution/runner'
import type { TerminalManager } from '../src/main/services/terminal/manager'

vi.mock('../src/main/services/cli/probe', async (original) => ({ ...await original<object>(), findExecutable: (name: string) => `/usr/bin/${name}` }))
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'devcommand-packs-')); roots.push(root)
  const directory = join(root, 'repo'); mkdirSync(directory); const repo = realpathSync(directory)
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
  writeFileSync(join(repo, 'sample.txt'), 'fixture')
  chmodSync(join(repo, 'sample.txt'), 0o644)
  const workspaceId = randomUUID()
  let fingerprint = 'original'
  const workspace = { resolve: async () => ({ rootPath: repo }), status: async () => ({ rootPath: repo, branch: 'main', clean: true, remotes: [] }), fingerprint: async () => fingerprint } as unknown as WorkspaceService
  const execute = vi.fn<(definition: ProcessDefinition) => string>(() => 'fixture-run')
  const runner = { execute, list: () => [{ id: 'fixture-run', commandId: 'permissions.chmod', status: 'running', preview: 'fixture', startedAt: new Date().toISOString(), output: [] }] } as unknown as ManagedRunner
  const store = { saveHistory: vi.fn() } as unknown as SettingsStore
  const service = new CommandService(store, workspace, runner, () => 1000)
  const startProgram = vi.fn(() => ({ id: randomUUID(), shell: 'fixture', cwd: repo, status: 'running' as const }))
  const terminals = { startProgram } as unknown as TerminalManager
  return { root, repo, workspaceId, execute, service, terminals, startProgram, changeProject: () => { fingerprint = 'changed' } }
}

describe('Permissions command pack', () => {
  it('rejects traversal, metadata, absolute paths, missing paths and symbolic links', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'outside.txt'), 'outside')
    symlinkSync(f.root, join(f.repo, 'linked'))
    for (const target of ['../outside.txt', '/etc/passwd', '.git/config', '.GIT/config', '.Git/hooks', 'linked/outside.txt', 'missing']) expect(() => permissionTarget(f.repo, target, true)).toThrow()
    expect(permissionTarget(f.repo, '.', false).target).toBe(f.repo)
  })
  it('rejects mutation through a hard link and fingerprints mode changes', () => {
    const f = fixture()
    const before = permissionTarget(f.repo, 'sample.txt', true).state
    chmodSync(join(f.repo, 'sample.txt'), 0o600)
    expect(permissionTarget(f.repo, 'sample.txt', true).state).not.toBe(before)
    linkSync(join(f.repo, 'sample.txt'), join(f.root, 'hard.txt'))
    expect(() => permissionTarget(f.repo, 'sample.txt', true)).toThrow('hard-linked')
  })
  it('validates chmod, chown and ACL inputs without accepting command options', () => {
    for (const mode of ['7777', '-R', '-w', '755;id', 'u+x\n']) expect(() => validateParams(getDefinition('permissions.chmod'), { target: 'sample.txt', mode })).toThrow()
    for (const mode of ['755', '0644', 'u+x', 'u+rw,go-rwx']) expect(validateParams(getDefinition('permissions.chmod'), { target: 'sample.txt', mode }).mode).toBe(mode)
    for (const owner of ['-R', 'root;id', 'root:group:extra', 'root group']) expect(() => validateParams(getDefinition('permissions.chown'), { target: 'sample.txt', owner })).toThrow()
    const args = permissionArguments(getDefinition('permissions.acl.add'), { principal: 'user', identity: 'alice', access: 'rw' }, '/repo/file with spaces')
    expect(args).toEqual(process.platform === 'darwin' ? ['+a', 'user:alice allow read,write', '/repo/file with spaces'] : ['-m', 'u:alice:rw-', '--', '/repo/file with spaces'])
  })
  it('requires confirmation and rejects changed targets before chmod executes', async () => {
    const f = fixture()
    const request = { commandId: 'permissions.chmod', workspaceId: f.workspaceId, params: { target: 'sample.txt', mode: '600' } }
    const preview = await f.service.preview(request)
    expect(preview.display).toContain('chmod 600')
    await expect(f.service.execute(request)).rejects.toThrow('Confirmation')
    chmodSync(join(f.repo, 'sample.txt'), 0o640)
    await expect(f.service.execute(request, preview.confirmationToken)).rejects.toThrow()
    expect(f.execute).not.toHaveBeenCalled()
    const fresh = await f.service.preview(request)
    await f.service.execute(request, fresh.confirmationToken)
    expect(f.execute.mock.calls[0][0].argv).toEqual(['600', join(f.repo, 'sample.txt')])
  })
})

describe('AI Developer CLI command pack', () => {
  it('includes interactive start/resume commands and no bypass flags', () => {
    for (const id of ['codex', 'claude', 'gemini', 'antigravity']) {
      expect(getDefinition(`ai.${id}.start`).interactive).toBe(true)
      expect(getDefinition(`ai.${id}.resume`).requiresRepository).toBe(true)
      expect(getDefinition(`ai.${id}.help`).mutation).toBe(false)
    }
    expect(registry.filter((entry) => entry.category === 'AI Developer CLI').map((entry) => entry.arguments).flat().join(' ')).not.toMatch(/yolo|skip-permissions|bypass/)
    expect(getDefinition('ai.antigravity.start').executable).toBe('agy')
  })
  it('only launches an AI PTY after a valid single-use confirmation', async () => {
    const f = fixture()
    const request = { commandId: 'ai.codex.start', workspaceId: f.workspaceId, params: {} }
    const preview = await f.service.preview(request)
    await expect(f.service.execute(request, preview.confirmationToken)).rejects.toThrow('interactive terminal')
    expect(f.execute).not.toHaveBeenCalled()
    await expect(f.service.launch(request, preview.confirmationToken!, f.terminals)).rejects.toThrow('Confirmation')
    const fresh = await f.service.preview(request)
    await f.service.launch(request, fresh.confirmationToken!, f.terminals)
    expect(f.startProgram).toHaveBeenCalledWith({ executable: '/usr/bin/codex', argv: [], cwd: f.repo, label: 'Start Codex' })
    await expect(f.service.launch(request, fresh.confirmationToken!, f.terminals)).rejects.toThrow('Confirmation')
    expect(f.startProgram).toHaveBeenCalledTimes(1)
  })
  it('rejects project state changes and refuses using launch for a non-interactive command', async () => {
    const f = fixture()
    const request = { commandId: 'ai.gemini.resume', workspaceId: f.workspaceId, params: {} }
    const preview = await f.service.preview(request)
    f.changeProject()
    await expect(f.service.launch(request, preview.confirmationToken!, f.terminals)).rejects.toThrow('project changed')
    await expect(f.service.launch({ commandId: 'ai.codex.version', params: {} }, randomUUID(), f.terminals)).rejects.toThrow('not an interactive')
    expect(f.startProgram).not.toHaveBeenCalled()
  })
})
