import { existsSync, readFileSync, chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { permissionArguments, permissionTarget } from '../src/main/services/commands/permissions'
import { getDefinition, registry, validateParams } from '../src/main/services/commands/registry'
import { shellChecks } from '../src/shared/runtime'
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
  return { root, repo, workspaceId, execute, service, store, terminals, startProgram, changeProject: () => { fingerprint = 'changed' } }
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
    expect(f.startProgram).toHaveBeenCalledWith({ executable: '/usr/bin/codex', argv: [], cwd: f.repo, label: 'Start Codex', keepShell: true })
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

describe('Cloudflare Tunnel command pack', () => {
  it('validates local origins and tunnel identifiers before expanding fixed arguments', async () => {
    const quick = getDefinition('cloudflared.quick')
    for (const originUrl of ['http://localhost:3000', 'https://127.0.0.1:8443', 'http://[::1]:8080']) expect(validateParams(quick, { originUrl }).originUrl).toBe(originUrl)
    for (const originUrl of ['file:///etc/passwd', 'http://example.com', 'http://user:pass@localhost:3000', 'http://localhost:3000?token=x', '--url', 'http://localhost:3000\n']) expect(() => validateParams(quick, { originUrl })).toThrow()
    for (const tunnel of ['--token', 'foo bar', '../credentials', 'foo;id']) expect(() => validateParams(getDefinition('cloudflared.run'), { tunnel })).toThrow()
    const f = fixture()
    const request = { commandId: 'cloudflared.quick', params: { originUrl: 'http://localhost:3000' } }
    const prepared = await f.service.prepare(request)
    expect(prepared.process.argv).toEqual(['tunnel', '--url', 'http://localhost:3000'])
    expect(prepared.preview.consequences.join(' ')).toContain('Ctrl+C')
    await expect(f.service.launch(request, 'unconfirmed', f.terminals)).rejects.toThrow('Confirmation')
    const preview = await f.service.preview(request)
    await f.service.launch(request, preview.confirmationToken!, f.terminals)
    expect(f.startProgram).toHaveBeenCalledWith(expect.objectContaining({ argv: ['tunnel', '--url', 'http://localhost:3000'] }))
    await expect(f.service.launch(request, preview.confirmationToken!, f.terminals)).rejects.toThrow('Confirmation')
  })
})

describe('ngrok command pack', () => {
  it('validates ports, local URLs, endpoint names and custom domains', async () => {
    for (const port of ['0', '65536', '--help', '3000;id']) expect(() => validateParams(getDefinition('ngrok.http'), { port })).toThrow()
    for (const originUrl of ['file:///etc/passwd', 'http://example.com', 'http://user:pass@localhost:3000', 'http://localhost:3000?token=x']) expect(() => validateParams(getDefinition('ngrok.http.url'), { originUrl })).toThrow()
    for (const publicUrl of ['--help', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=x']) expect(() => validateParams(getDefinition('ngrok.http.domain'), { port: '3000', publicUrl })).toThrow()
    expect(validateParams(getDefinition('ngrok.http.domain'), { port: '3000', publicUrl: 'https://demo.ngrok.app' }).publicUrl).toBe('https://demo.ngrok.app')
    expect(() => validateParams(getDefinition('ngrok.start'), { tunnel: '--all' })).toThrow()
    const f = fixture(), request = { commandId: 'ngrok.http', params: { port: '4321' } }
    const prepared = await f.service.prepare(request)
    expect(prepared.process.argv).toEqual(['http', '4321'])
    expect(prepared.preview.consequences.join(' ')).toContain('Ctrl+C')
    await expect(f.service.launch(request, 'unconfirmed', f.terminals)).rejects.toThrow('Confirmation')
    const preview = await f.service.preview(request)
    await f.service.launch(request, preview.confirmationToken!, f.terminals)
    expect(f.startProgram).toHaveBeenCalledWith(expect.objectContaining({ argv: ['http', '4321'], keepShell: true }))
  })
})

describe('Zsh command pack', () => {
  it('passes a validated lookup as a positional argument instead of shell code', async () => {
    const f = fixture()
    for (const commandName of ['git;id', '$(id)', '--help', '/bin/git', 'git status', 'git\n']) expect(() => validateParams(getDefinition('zsh.which'), { commandName })).toThrow()
    const prepared = await f.service.prepare({ commandId: 'zsh.which', params: { commandName: 'git' } })
    expect(prepared.process.argv).toEqual(['-f', '-c', 'whence -a -- "$1"', 'devcommand', 'git'])
    expect(() => validateParams(getDefinition('zsh.version'), { command: 'untrusted' })).toThrow()
  })
  it('opens Zsh directly so Ctrl+C stays in the shell rather than a wrapper', async () => {
    const f = fixture()
    for (const [commandId, argv] of [['zsh.start', ['-i']], ['zsh.clean', ['-f', '-i']]] as const) {
      const request = { commandId, params: {} }, preview = await f.service.preview(request)
      await f.service.launch(request, preview.confirmationToken!, f.terminals)
      expect(f.startProgram).toHaveBeenLastCalledWith(expect.objectContaining({ executable: '/usr/bin/zsh', argv, keepShell: false }))
    }
  })
  it('previews source and binds confirmation to the startup file before opening a persistent shell', async () => {
    const f = fixture(); vi.stubEnv('ZDOTDIR', f.root)
    try {
      const path = join(f.root, '.zshrc')
      writeFileSync(path, 'export SOURCE_TEST=first\n')
      const request = { commandId: 'zsh.source', params: {} }
      const preview = await f.service.preview(request)
      expect(preview.display).toBe(`source ${path}`)
      await expect(f.service.execute(request, preview.confirmationToken)).rejects.toThrow('interactive terminal')
      const changed = await f.service.preview(request)
      writeFileSync(path, 'export SOURCE_TEST=changed-value\n')
      await expect(f.service.launch(request, changed.confirmationToken!, f.terminals)).rejects.toThrow('does not match')
      expect(f.startProgram).not.toHaveBeenCalled()
      const fresh = await f.service.preview(request)
      await f.service.launch(request, fresh.confirmationToken!, f.terminals)
      expect(f.startProgram).toHaveBeenCalledWith(expect.objectContaining({ argv: ['-f', '-i'], initialCommand: `source ${path}`, keepShell: false }))
    } finally { vi.unstubAllEnvs() }
  })
  it('checks only allowlisted regular startup files without executing their content', async () => {
    const f = fixture(); vi.stubEnv('ZDOTDIR', f.root)
    try {
      writeFileSync(join(f.root, '.zshrc'), 'print should-not-execute\n')
      const prepared = await f.service.prepare({ commandId: 'zsh.syntax', params: { configFile: '.zshrc' } })
      expect(prepared.process.argv).toEqual(['-f', '-n', '--', join(f.root, '.zshrc')])
      expect(prepared.preview.display).toContain('.zshrc')
      expect(() => validateParams(getDefinition('zsh.syntax'), { configFile: '../.ssh/config' })).toThrow()
      await expect(f.service.prepare({ commandId: 'zsh.syntax', params: { configFile: '.zlogin' } })).rejects.toThrow('regular Zsh startup file')
      symlinkSync(join(f.root, '.zshrc'), join(f.root, '.zshenv'))
      await expect(f.service.prepare({ commandId: 'zsh.syntax', params: { configFile: '.zshenv' } })).rejects.toThrow('Symlinks')
      vi.stubEnv('ZDOTDIR', 'relative')
      await expect(f.service.prepare({ commandId: 'zsh.syntax', params: { configFile: '.zshrc' } })).rejects.toThrow('absolute')
    } finally { vi.unstubAllEnvs() }
  })
})


describe('Find command pack', () => {
  it('runs read-only predicates against an isolated tree without following links', async () => {
    const f = fixture()
    const tree = join(f.repo, 'search root'); mkdirSync(tree)
    mkdirSync(join(tree, 'nested')); mkdirSync(join(tree, 'empty-dir'))
    writeFileSync(join(tree, 'README.TXT'), 'readme')
    writeFileSync(join(tree, 'empty.txt'), '')
    writeFileSync(join(tree, 'nested', 'deep.ts'), 'typescript')
    writeFileSync(join(tree, '$(injected).txt'), 'literal')
    symlinkSync(f.root, join(tree, 'linked'))
    const run = async (commandId: string, extra: Record<string, string>, maxDepth = '5') => {
      const prepared = await f.service.prepare({ commandId, workspaceId: f.workspaceId, params: { searchRoot: 'search root', maxDepth, ...extra } })
      if (maxDepth === 'all') expect(prepared.process.argv.slice(0, 4)).toEqual(['-P', tree, '-mindepth', '1'])
      else expect(prepared.process.argv.slice(0, 6)).toEqual(['-P', tree, '-maxdepth', maxDepth, '-mindepth', '1'])
      const output = execFileSync('find', prepared.process.argv, { encoding: 'utf8' }).trim()
      return output ? output.split('\n').sort() : []
    }
    expect(await run('find.name', { pattern: '*.ts' })).toEqual([join(tree, 'nested', 'deep.ts')])
    expect(await run('find.name', { pattern: '*.ts' }, '1')).toEqual([])
    expect(await run('find.name', { pattern: '*.ts' }, 'all')).toEqual([join(tree, 'nested', 'deep.ts')])
    expect(await run('find.iname', { pattern: 'readme.*' })).toEqual([join(tree, 'README.TXT')])
    expect(await run('find.extension', { extension: 'ts' })).toEqual([join(tree, 'nested', 'deep.ts')])
    expect(await run('find.directory', { pattern: 'empty*' })).toEqual([join(tree, 'empty-dir')])
    expect(await run('find.empty', { entryType: 'f' })).toEqual([join(tree, 'empty.txt')])
    expect(await run('find.empty', { entryType: 'd' })).toEqual([join(tree, 'empty-dir')])
    expect(await run('find.size', { size: '1c' })).toEqual([join(tree, '$(injected).txt'), join(tree, 'README.TXT'), join(tree, 'nested', 'deep.ts')].sort())
    expect(await run('find.modified', { days: '1' })).toHaveLength(4)
    expect(await run('find.name', { pattern: '$(injected).txt' })).toEqual([join(tree, '$(injected).txt')])
  })
  it('defaults every Find action to the filesystem root without a depth limit, even with a repository selected', async () => {
    const f = fixture()
    for (const definition of registry.filter((entry) => entry.id.startsWith('find.'))) {
      const params = Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue!]))
      expect(params.searchRoot).toBe('/')
      expect(params.maxDepth).toBe('all')
      const prepared = await f.service.prepare({ commandId: definition.id, workspaceId: f.workspaceId, params })
      expect(prepared.process.argv.slice(0, 4)).toEqual(['-P', '/', '-mindepth', '1'])
      expect(prepared.process.argv).not.toContain('-maxdepth')
      expect(prepared.process.timeoutMs).toBe(60000)
    }
  })
  it('rejects invalid predicates and search roots instead of accepting find expressions', async () => {
    const f = fixture()
    for (const [id, params] of [
      ['find.name', { searchRoot: '.', maxDepth: '0', pattern: '*' }],
      ['find.name', { searchRoot: '.', maxDepth: '5', pattern: '../*' }],
      ['find.extension', { searchRoot: '.', maxDepth: '5', extension: '*.ts' }],
      ['find.size', { searchRoot: '.', maxDepth: '5', size: '1M -delete' }],
      ['find.modified', { searchRoot: '.', maxDepth: '5', days: '-1' }]
    ] as const) expect(() => validateParams(getDefinition(id), params)).toThrow()
    await expect(f.service.prepare({ commandId: 'find.name', workspaceId: f.workspaceId, params: { searchRoot: 'missing', maxDepth: '5', pattern: '*' } })).rejects.toThrow('search directory')
    expect(registry.filter((entry) => entry.id.startsWith('find.')).every((entry) => !entry.mutation && !entry.interactive && entry.risk === 'safe')).toBe(true)
  })
})


describe('File Operations command pack', () => {
  it('creates, copies, moves, renames and removes only fixture paths', async () => {
    const f = fixture()
    const run = async (commandId: string, params: Record<string, string>) => {
      const prepared = await f.service.prepare({ commandId, params, workspaceId: f.workspaceId })
      expect(prepared.preview.consequences.length).toBeGreaterThan(0)
      execFileSync(getDefinition(commandId).executable, prepared.process.argv, { cwd: f.repo })
    }
    await run('files.mkdir', { targetPath: 'folder with spaces' })
    await run('files.create', { targetPath: 'folder with spaces/-new file.txt' })
    expect(readFileSync(join(f.repo, 'folder with spaces/-new file.txt'), 'utf8')).toBe('')
    await run('files.copy', { sourcePath: 'sample.txt', destinationPath: 'folder with spaces/copied.txt' })
    expect(readFileSync(join(f.repo, 'folder with spaces/copied.txt'), 'utf8')).toBe('fixture')
    expect(existsSync(join(f.repo, 'sample.txt'))).toBe(true)
    await run('files.move', { sourcePath: 'folder with spaces/copied.txt', destinationPath: 'moved.txt' })
    expect(existsSync(join(f.repo, 'folder with spaces/copied.txt'))).toBe(false)
    await run('files.rename', { sourcePath: 'moved.txt', destinationPath: 'renamed.txt' })
    expect(readFileSync(join(f.repo, 'renamed.txt'), 'utf8')).toBe('fixture')
    await run('files.delete', { targetPath: 'renamed.txt' })
    expect(existsSync(join(f.repo, 'renamed.txt'))).toBe(false)
    await expect(run('files.rmdir', { targetPath: 'folder with spaces' })).rejects.toThrow()
    expect(existsSync(join(f.repo, 'folder with spaces/-new file.txt'))).toBe(true)
    await run('files.delete', { targetPath: 'folder with spaces/-new file.txt' })
    await run('files.rmdir', { targetPath: 'folder with spaces' })
    expect(existsSync(join(f.repo, 'folder with spaces'))).toBe(false)
  })
  it('refuses traversal, metadata, symbolic links, hard links and existing destinations', async () => {
    const f = fixture()
    symlinkSync(f.root, join(f.repo, 'linked'))
    linkSync(join(f.repo, 'sample.txt'), join(f.repo, 'hardlink.txt'))
    for (const targetPath of ['../outside', '/tmp/outside', '.git/config', '.GIT/config', '.', 'linked/outside', 'missing-parent/file', 'sample.txt']) {
      await expect(f.service.prepare({ commandId: 'files.create', workspaceId: f.workspaceId, params: { targetPath } })).rejects.toThrow()
    }
    await expect(f.service.prepare({ commandId: 'files.delete', workspaceId: f.workspaceId, params: { targetPath: 'hardlink.txt' } })).rejects.toThrow('Hard-linked')
    await expect(f.service.prepare({ commandId: 'files.delete', params: { targetPath: 'file.txt' } })).rejects.toThrow('workspace')
    expect(readFileSync(join(f.repo, 'sample.txt'), 'utf8')).toBe('fixture')
  })
  it('requires one-use confirmation and rejects changed source or destination state', async () => {
    const f = fixture()
    const request = { commandId: 'files.copy', workspaceId: f.workspaceId, params: { sourcePath: 'sample.txt', destinationPath: 'copy.txt' } }
    await expect(f.service.execute(request)).rejects.toThrow('Confirmation')
    const before = await f.service.preview(request)
    writeFileSync(join(f.repo, 'sample.txt'), 'changed contents')
    await expect(f.service.execute(request, before.confirmationToken)).rejects.toThrow('Confirmation')
    expect(f.execute).not.toHaveBeenCalled()
    const destinationReview = await f.service.preview(request)
    writeFileSync(join(f.repo, 'copy.txt'), 'do not overwrite')
    await expect(f.service.execute(request, destinationReview.confirmationToken)).rejects.toThrow('destination already exists')
    expect(readFileSync(join(f.repo, 'copy.txt'), 'utf8')).toBe('do not overwrite')
    const freshRequest = { ...request, params: { ...request.params, destinationPath: 'fresh.txt' } }
    const fresh = await f.service.preview(freshRequest)
    await f.service.execute(freshRequest, fresh.confirmationToken)
    expect(f.execute).toHaveBeenCalledOnce()
    await expect(f.service.execute(freshRequest, fresh.confirmationToken)).rejects.toThrow()
    expect(f.execute).toHaveBeenCalledOnce()
  })
})


describe('File Comparison command pack', () => {
  it('compares text with the selected rules and accepts both equal/different exit codes', async () => {
    const f = fixture()
    const left = join(f.repo, 'first file.txt'), right = join(f.repo, '-second file.txt')
    const run = async (commandId: string) => {
      const prepared = await f.service.prepare({ commandId, workspaceId: f.workspaceId, params: { leftFile: 'first file.txt', rightFile: '-second file.txt' } })
      expect(prepared.process.successExitCodes).toEqual([0, 1])
      expect(prepared.process.argv.slice(-2)).toEqual([left, right])
      expect(prepared.preview.confirmationToken).toBeUndefined()
      return spawnSync(getDefinition(commandId).executable, prepared.process.argv, { encoding: 'utf8' })
    }
    writeFileSync(left, 'hello world\n'); writeFileSync(right, 'hello world\n')
    expect((await run('compare.unified')).status).toBe(0)
    expect((await run('compare.unified')).stdout).toBe('')
    writeFileSync(right, 'HELLO WORLD\n')
    const different = await run('compare.unified')
    expect(different.status).toBe(1)
    expect(different.stdout).toContain('-hello world')
    expect(different.stdout).toContain('+HELLO WORLD')
    expect((await run('compare.case')).status).toBe(0)
    expect((await run('compare.brief')).status).toBe(1)
    writeFileSync(right, 'hello   world\n')
    expect((await run('compare.whitespace')).status).toBe(0)
    writeFileSync(left, Buffer.from([0, 1, 2])); writeFileSync(right, Buffer.from([0, 1, 3]))
    expect((await run('compare.bytes')).status).toBe(1)
    writeFileSync(right, Buffer.from([0, 1, 2]))
    expect((await run('compare.bytes')).status).toBe(0)
    expect(readFileSync(left)).toEqual(Buffer.from([0, 1, 2]))
  })
  it('refuses missing files/directories and resolves a regular-file symbolic link', async () => {
    const f = fixture()
    const request = { commandId: 'compare.unified', workspaceId: f.workspaceId, params: { leftFile: 'sample.txt', rightFile: 'missing.txt' } }
    await expect(f.service.prepare(request)).rejects.toThrow('regular files')
    await expect(f.service.prepare({ ...request, params: { ...request.params, rightFile: '.' } })).rejects.toThrow('regular files')
    symlinkSync(join(f.repo, 'sample.txt'), join(f.repo, 'linked.txt'))
    const prepared = await f.service.prepare({ ...request, params: { leftFile: join(f.repo, 'sample.txt'), rightFile: 'linked.txt' } })
    expect(prepared.process.argv.slice(-2)).toEqual([join(f.repo, 'sample.txt'), join(f.repo, 'sample.txt')])
  })
  it('removes Dart Version from the catalog and disables rerunning removed commands in history', async () => {
    const f = fixture()
    expect(registry.some((entry) => entry.id === 'dart.version')).toBe(false)
    expect(() => getDefinition('dart.version')).toThrow('Unknown')
    await f.service.execute({ commandId: 'zsh.version', params: {} })
    const existing = vi.mocked(f.store.saveHistory).mock.calls[0][0]
    const removed = { ...existing, request: { ...existing.request, commandId: 'dart.version' } }
    f.store.history = () => [existing, removed]
    expect(f.service.history().map((entry) => entry.rerunnable)).toEqual([true, false])
    expect(f.service.history().map((entry) => entry.commandAvailable)).toEqual([true, false])
    expect(registry.filter((entry) => entry.id.startsWith('compare.')).every((entry) => !entry.mutation && entry.risk === 'safe')).toBe(true)
  })
})


describe('Shell Tools checks', () => {
  it('maps the public allowlist to unique read-only definitions with fixed arguments', async () => {
    const f = fixture()
    expect(new Set(registry.map((entry) => entry.id)).size).toBe(registry.length)
    for (const check of shellChecks) {
      const definition = getDefinition(check.id)
      const prepared = await f.service.prepare({ commandId: check.id, params: {} })
      expect([definition.mutation, !!definition.network, !!definition.interactive, definition.requiresRepository]).toEqual([false, false, false, false])
      expect(definition.parameters).toEqual([])
      expect([definition.executable, ...prepared.process.argv].join(' ')).toBe(check.command)
      expect(prepared.preview.risk).toBe('safe')
    }
  })
})
