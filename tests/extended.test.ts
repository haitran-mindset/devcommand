import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseConfig, updateConfig } from '../src/main/services/ssh/config'
import { configState, readSshText, writeConfig } from '../src/main/services/ssh/files'
import { SshService } from '../src/main/services/ssh/service'
import { DockerService } from '../src/main/services/docker/service'
import { Confirmations } from '../src/main/security/confirmations'
import { findExecutable, type ProbeRun } from '../src/main/services/cli/probe'
import type { TerminalManager } from '../src/main/services/terminal/manager'
import type { ManagedRunner, ProcessDefinition } from '../src/main/services/execution/runner'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import { getDefinition, validateParams, expand } from '../src/main/services/commands/registry'
import { dockerActionSchema, sshActionSchema } from '../src/shared/extended'

vi.mock('../src/main/services/cli/probe', async (original) => ({ ...await original<object>(), findExecutable: vi.fn((name: string) => `/usr/bin/${name}`) }))
const roots: string[] = []
function directory() { const root = mkdtempSync(join(tmpdir(), 'devcommand ssh 日本語 ')); roots.push(root); const dir = join(root, '.ssh'); mkdirSync(dir, { mode: 0o700 }); return dir }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.mocked(findExecutable).mockImplementation((name) => `/usr/bin/${name}`); vi.unstubAllEnvs() })
const probe: ProbeRun = async (name) => name === 'ssh-keygen' ? { code: 0, stdout: '256 SHA256:FixtureFingerprint comment (ED25519)\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }
function execution() {
  const execute = vi.fn((definition: ProcessDefinition) => { void definition; return 'fixture-execution' })
  const runner = { execute, list: () => [], cancel: vi.fn() } as unknown as ManagedRunner
  const startProgram = vi.fn(() => ({ id: 'fixture-terminal', cwd: '/tmp', shell: 'ssh-keygen', status: 'running' as const }))
  return { execute, runner, startProgram, terminals: { startProgram } as unknown as TerminalManager }
}

describe('SSH config preservation and file boundaries', () => {
  it('updates managed fields with comments and unknown directives preserved, and removes only the chosen block', () => {
    const text = '# header\r\nHost work # alias\r\n  HostName old.example # endpoint\r\n  User git\r\n  Compression yes\r\n  # keep me\r\nHost other\r\n  HostName other.example\r\n'
    const parsed = parseConfig(text, () => undefined)
    expect(parsed.blocks[0].host).toMatchObject({ alias: 'work', editable: true })
    const next = updateConfig(text, parsed, { kind: 'host.update', alias: 'work', hostName: 'new.example', user: 'alice', port: 2222, identityName: '' }, '/tmp/.ssh')
    expect(next).toContain('HostName new.example # endpoint\r\n'); expect(next).toContain('Compression yes\r\n'); expect(next).toContain('# keep me\r\n'); expect(next).toContain('Port 2222\r\n'); expect(next).toContain('Host other\r\n  HostName other.example\r\n')
    const removed = updateConfig(next, parseConfig(next, () => undefined), { kind: 'host.remove', alias: 'work' }, '/tmp/.ssh')
    expect(removed).not.toContain('Compression'); expect(removed).toContain('# keep me'); expect(removed).toContain('Host other')
  })
  it('refuses ambiguous Includes, Match, duplicate aliases/directives and outside identities', () => {
    for (const text of ['Include extra\nHost work\n HostName x\n', 'Host work\n Match exec "anything"\n', 'Host work\n User a\n User b\n', 'Host work\nHost work\n', 'Host *\n', 'Host work\n IdentityFile /outside/private\n']) {
      const parsed = parseConfig(text, () => undefined)
      expect(parsed.blocks[0].host.editable).toBe(false)
      expect(() => updateConfig(text, parsed, { kind: 'host.remove', alias: parsed.blocks[0].host.alias }, '/tmp/.ssh')).toThrow()
    }
  })
  it('creates 0600 backups, detects stale revisions and never opens a private filename', () => {
    const dir = directory(), file = join(dir, 'config'); writeFileSync(file, '# original\n', { mode: 0o600 })
    writeFileSync(join(dir, 'id_private'), 'PRIVATE SENTINEL', { mode: 0o600 })
    const state = configState(dir), backup = writeConfig(dir, '# changed\n', state.revision)!
    expect(readFileSync(backup, 'utf8')).toBe('# original\n'); expect(lstatSync(backup).mode & 0o777).toBe(0o600); expect(lstatSync(file).mode & 0o777).toBe(0o600)
    expect(() => writeConfig(dir, 'stale', state.revision)).toThrow('changed')
    expect(() => readSshText(dir, 'id_private', 100)).toThrow('Only SSH config and public')
    expect(readFileSync(file, 'utf8')).toBe('# changed\n'); expect(readdirSync(dir).some((name) => name.endsWith('.lock') || name.endsWith('.tmp'))).toBe(false)
  })
  it('refuses symlinked metadata and unsafe directories', () => {
    const dir = directory(); symlinkSync('/etc/hosts', join(dir, 'fake.pub'))
    expect(() => readSshText(dir, 'fake.pub', 100)).toThrow('Symlink')
    chmodSync(dir, 0o777); expect(() => configState(dir)).toThrow('user-owned')
  })
})

describe('SSH confirmed actions', () => {
  it('uses passphrase-free argv, never overwrites existing names and serializes simultaneous generation', async () => {
    const dir = directory(), service = new SshService(probe, dir), f = execution(), action = { kind: 'key.generate' as const, name: 'id_new', comment: 'fixture' }
    const a = await service.preview(action), b = await service.preview(action)
    const results = await Promise.allSettled([service.execute(action, a.token, f.terminals, f.runner), service.execute(action, b.token, f.terminals, f.runner)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(f.startProgram).toHaveBeenCalledOnce()
    const program = f.startProgram.mock.calls[0] as unknown as [{ argv: string[]; onClosed: () => void }]
    expect(program[0].argv).toEqual(['-t', 'ed25519', '-a', '64', '-C', 'fixture', '-f', join(dir, 'id_new')]); expect(program[0].argv).not.toContain('-N')
    program[0].onClosed(); writeFileSync(join(dir, 'id_new.pub'), 'exists')
    await expect(service.preview(action)).rejects.toThrow('exists')
    expect(existsSync(join(dir, 'id_new'))).toBe(false)
  })
  it('keeps private content out of snapshots and validates public fingerprints and agent requests', async () => {
    const dir = directory(); writeFileSync(join(dir, 'id_one'), 'PRIVATE SECRET SENTINEL', { mode: 0o600 }); writeFileSync(join(dir, 'id_one.pub'), 'ssh-ed25519 AAAAFixture public comment\n')
    const service = new SshService(probe, dir), snapshot = await service.snapshot()
    expect(snapshot.keys[0]).toMatchObject({ fingerprint: 'SHA256:FixtureFingerprint', privateAvailable: true }); expect(JSON.stringify(snapshot)).not.toContain('PRIVATE SECRET')
    expect(await service.publicKey('id_one.pub')).toBe('ssh-ed25519 AAAAFixture public comment')
    await expect(service.publicKey('id_one')).rejects.toThrow('public .pub')
    const action = { kind: 'agent.add' as const, publicKeyName: 'id_one.pub', fingerprint: snapshot.keys[0].fingerprint }, f = execution(), preview = await service.preview(action)
    await service.execute(action, preview.token, f.terminals, f.runner)
    expect((f.startProgram.mock.calls[0] as unknown as [{ argv: string[] }])[0].argv).toEqual(['-t', '3600', join(dir, 'id_one')])
  })
  it('bypasses executable SSH config, quotes paths with spaces and enforces strict checking without prompting', async () => {
    const dir = directory(); writeFileSync(join(dir, 'config'), 'Host work\n HostName git.example.invalid\n User git\n ProxyCommand sh -c evil\n LocalCommand evil\n')
    const service = new SshService(probe, dir), f = execution(), action = { kind: 'connection.test' as const, alias: 'work', revision: (await service.snapshot()).revision }, preview = await service.preview(action)
    await service.execute(action, preview.token, f.terminals, f.runner)
    const args = f.execute.mock.calls[0][0].argv
    expect(args.slice(0, 2)).toEqual(['-F', '/dev/null']); expect(args).toContain('StrictHostKeyChecking=yes'); expect(args).toContain('BatchMode=yes'); expect(args).toContain('ProxyCommand=none'); expect(args).toContain(`UserKnownHostsFile="${join(dir, 'known_hosts')}"`); expect(args).not.toContain('evil'); expect(args.slice(-2)).toEqual(['--', 'git.example.invalid'])
    await expect(service.execute(action, preview.token, f.terminals, f.runner)).rejects.toThrow('Confirmation')
  })
  it('binds config writes to revision, creates a backup and rejects renderer extras', async () => {
    const dir = directory(), service = new SshService(probe, dir), f = execution()
    const action = { kind: 'host.add' as const, alias: 'work', hostName: 'git.example.invalid', user: 'git', port: 22, identityName: '', revision: configState(dir).revision }
    const p = await service.preview(action); await service.execute(action, p.token, f.terminals, f.runner)
    expect(readFileSync(join(dir, 'config'), 'utf8')).toContain('Host work')
    const next = { ...action, kind: 'host.update' as const, revision: configState(dir).revision }, q = await service.preview(next)
    writeFileSync(join(dir, 'config'), '# external edit\n'); await expect(service.execute(next, q.token, f.terminals, f.runner)).rejects.toThrow('changed')
    expect(sshActionSchema.safeParse({ ...action, passphrase: 'never' }).success).toBe(false)
  })
})

function dockerFixture() {
  let state = 'exited', daemon = 'daemon-one', endpoint = 'unix:///fixture/docker.sock', refs = '', usedNetwork = false, composeImage = 'fixture:one'
  const container = 'a'.repeat(64), network = 'b'.repeat(64), image = `sha256:${'c'.repeat(64)}`
  const calls: string[][] = []
  const run: ProbeRun = async (_name, args) => {
    calls.push(args)
    if (args[0] === 'context' && args[1] === 'show') return { code: 0, stdout: 'fixture\n', stderr: '' }
    if (args[0] === 'context') return { code: 0, stdout: JSON.stringify([{ Endpoints: { docker: { Host: endpoint } } }]), stderr: '' }
    const command = args.slice(2)
    const json = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value) + '\n', stderr: '' })
    if (command[0] === 'compose' && command.includes('config')) return json({ services: { app: { image: composeImage } } })
    if (command[0] === 'info') return json({ ID: daemon, ServerVersion: 'fixture', Secret: 'never expose' })
    if (command[0] === 'ps') return command.includes('--quiet') ? { code: 0, stdout: refs, stderr: '' } : json({ ID: container, Names: 'fixture', Image: 'fixture:latest', State: state, Status: state, Ports: '' })
    if (command[0] === 'image') return json({ ID: image, Repository: 'fixture', Tag: 'latest', Size: '1 MB' })
    if (command[0] === 'volume') return command[1] === 'inspect' ? json([{ Name: 'fixture_data', Mountpoint: '/fixture', CreatedAt: 'fixture', Driver: 'local' }]) : json({ Name: 'fixture_data', Driver: 'local' })
    if (command[0] === 'network') return command[1] === 'inspect' ? json([{ Id: network, Containers: usedNetwork ? { attached: {} } : {} }]) : json({ ID: network, Name: 'custom', Driver: 'bridge' })
    throw new Error(`Unexpected fixture command: ${args.join(' ')}`)
  }
  const f = execution(), composeRoot = directory(), workspace = { resolve: async () => ({ rootPath: composeRoot }) } as unknown as WorkspaceService
  writeFileSync(join(composeRoot, 'compose.yaml'), 'services:\n  app:\n    image: fixture:one\n')
  const service = new DockerService(run, workspace, f.runner)
  return { service, ...f, calls, container, network, image, setState: (value: string) => { state = value }, setDaemon: (value: string) => { daemon = value }, setEndpoint: (value: string) => { endpoint = value }, setRefs: (value: string) => { refs = value }, useNetwork: () => { usedNetwork = true }, changeCompose: () => { composeImage = 'fixture:changed-include' } }
}
describe('Docker read models and controlled execution', () => {
  it('reports missing CLI and offline daemon without exposing raw output', async () => {
    vi.mocked(findExecutable).mockReturnValue(undefined)
    expect(await dockerFixture().service.snapshot()).toMatchObject({ cliAvailable: false, daemonAvailable: false })
    vi.mocked(findExecutable).mockReturnValue('/fixture/docker')
    const f = execution(), offline = new DockerService(async () => ({ code: 1, stdout: '', stderr: 'secret daemon error' }), {} as WorkspaceService, f.runner)
    const snapshot = await offline.snapshot(); expect(snapshot.daemonAvailable).toBe(false); expect(JSON.stringify(snapshot)).not.toContain('secret daemon error')
  })
  it('returns selected metadata only, pins context and requires matching one-time confirmation', async () => {
    const f = dockerFixture(), snapshot = await f.service.snapshot(); expect(snapshot.containers[0].id).toBe(f.container); expect(JSON.stringify(snapshot)).not.toContain('never expose')
    const action = { kind: 'container.start' as const, target: f.container }, p = await f.service.preview(action)
    await f.service.execute(action, p.token)
    expect(f.execute.mock.calls[0][0].argv).toEqual(['--context', 'fixture', 'start', f.container])
    await expect(f.service.execute(action, p.token)).rejects.toThrow('Confirmation')
  })
  it('rejects daemon/context/entity changes after review and active-container removal', async () => {
    for (const change of ['daemon', 'endpoint', 'state']) {
      const f = dockerFixture(), action = { kind: 'container.start' as const, target: f.container }, p = await f.service.preview(action)
      if (change === 'daemon') f.setDaemon('other'); else if (change === 'endpoint') f.setEndpoint('unix:///other.sock'); else f.setState('running')
      await expect(f.service.execute(action, p.token)).rejects.toThrow('changed'); expect(f.execute).not.toHaveBeenCalled()
    }
    const f = dockerFixture(); f.setState('running'); await expect(f.service.preview({ kind: 'container.remove', target: f.container })).rejects.toThrow('Stop the container')
  })
  it('guards referenced volumes/nonempty networks and makes data loss explicit for unused volumes', async () => {
    const f = dockerFixture(), action = { kind: 'volume.remove' as const, target: 'fixture_data' }
    f.setRefs('container-id'); await expect(f.service.preview(action)).rejects.toThrow('referenced')
    f.setRefs(''); const p = await f.service.preview(action); expect(p.consequences.join(' ')).toContain('PERMANENT DATA LOSS')
    await f.service.execute(action, p.token); expect(f.execute.mock.calls[0][0].argv).toEqual(['--context', 'fixture', 'volume', 'rm', 'fixture_data'])
    f.useNetwork(); await expect(f.service.preview({ kind: 'network.remove', target: f.network })).rejects.toThrow('Disconnect')
  })
  it('uses immutable image IDs, bounded logs and strict payloads', async () => {
    const f = dockerFixture(), action = { kind: 'image.remove' as const, target: f.image }, p = await f.service.preview(action)
    await f.service.execute(action, p.token); expect(f.execute.mock.calls[0][0].argv.at(-1)).toBe(f.image)
    const logs = await f.service.preview({ kind: 'container.follow', target: f.container }); expect(logs.display).toContain('logs --tail 200 --follow')
    expect(dockerActionSchema.safeParse({ kind: 'container.remove', target: '--force', argv: [] }).success).toBe(false)
  })
  it('rejects password-bearing endpoints for context and environment transports', async () => {
    const f = dockerFixture(); f.setEndpoint('ssh://alice:plainpass@host')
    expect(JSON.stringify(await f.service.snapshot())).not.toContain('plainpass')
    await expect(f.service.preview({ kind: 'container.start', target: f.container })).rejects.toThrow('credential-free')
    vi.stubEnv('DOCKER_CONTEXT', ''); vi.stubEnv('DOCKER_HOST', 'tcp://alice:plainpass@host:2375')
    await expect(f.service.preview({ kind: 'container.start', target: f.container })).rejects.toThrow('credential-free')
  })
  it('binds Compose confirmation to effective included config and uses nonbuilding, nonpulling flags', async () => {
    const f = dockerFixture(), action = { kind: 'compose.up' as const, target: 'workspace', workspaceId: 'b68ab029-742a-4e25-ad32-37ac984d716c' }, p = await f.service.preview(action)
    expect(p.display).toContain('up --detach --no-build --pull never')
    f.changeCompose(); await expect(f.service.execute(action, p.token)).rejects.toThrow('changed')
    expect(f.execute).not.toHaveBeenCalled()
    const q = await f.service.preview({ ...action, kind: 'compose.down' }); await f.service.execute({ ...action, kind: 'compose.down' }, q.token)
    expect(f.execute.mock.calls[0][0].argv.at(-1)).toBe('down'); expect(f.execute.mock.calls[0][0].argv).not.toContain('--volumes')
  })
})

describe('extended command packs and confirmation expiry', () => {
  it('restricts port arguments, npm scripts and Flutter analytics flags', () => {
    for (const port of ['-1', '0', '65536', '3000;evil', '80\n']) expect(() => validateParams(getDefinition('system.port'), { port })).toThrow()
    expect(expand(getDefinition('system.port'), { port: '3000' })).toEqual(['-nP', '-iTCP:3000', '-sTCP:LISTEN'])
    expect(getDefinition('npm.dependencies').arguments).toContain('--ignore-scripts'); expect(getDefinition('npm.dependencies').projectFile).toBe('package.json')
    for (const id of ['flutter.version', 'flutter.doctor', 'flutter.devices']) { expect(getDefinition(id).arguments[0]).toBe('--suppress-analytics'); expect(getDefinition(id).mutation).toBe(true) }
    expect(() => getDefinition('npm.run')).toThrow('Unknown')
  })
  it('expires and consumes mismatched confirmations', () => {
    let now = 0; const confirmations = new Confirmations(() => now), request = { action: 'one' }
    const a = confirmations.issue(request, 'state'); now = 60001; expect(() => confirmations.take(a.token, request)).toThrow('expired')
    const b = confirmations.issue(request, 'state'); expect(() => confirmations.take(b.token, { action: 'two' })).toThrow('mismatched'); expect(() => confirmations.take(b.token, request)).toThrow()
  })
})

describe('SSH agent lifetime and removal controls', () => {
  it.each(['600', '3600', '28800', '86400', 'unlimited'] as const)('loads only the confirmed lifetime %s', async (lifetimeSeconds) => {
    const dir = directory(); writeFileSync(join(dir, 'id_lifetime'), 'PRIVATE FIXTURE', { mode: 0o600 }); writeFileSync(join(dir, 'id_lifetime.pub'), 'ssh-ed25519 AAAA fixture\n')
    const service = new SshService(probe, dir), f = execution()
    const action = { kind: 'agent.add' as const, publicKeyName: 'id_lifetime.pub', fingerprint: 'SHA256:FixtureFingerprint', lifetimeSeconds }
    const preview = await service.preview(action)
    await service.execute(action, preview.token, f.terminals, f.runner)
    expect((f.startProgram.mock.calls[0] as unknown as [{ argv: string[] }])[0].argv).toEqual(lifetimeSeconds === 'unlimited' ? [join(dir, 'id_lifetime')] : ['-t', lifetimeSeconds, join(dir, 'id_lifetime')])
  })
  it('rejects an unconfirmed lifetime change and unsupported lifetimes', async () => {
    const dir = directory(); writeFileSync(join(dir, 'id_lifetime'), 'PRIVATE FIXTURE', { mode: 0o600 }); writeFileSync(join(dir, 'id_lifetime.pub'), 'ssh-ed25519 AAAA fixture\n')
    const service = new SshService(probe, dir), f = execution()
    const action = { kind: 'agent.add' as const, publicKeyName: 'id_lifetime.pub', fingerprint: 'SHA256:FixtureFingerprint', lifetimeSeconds: '600' as const }
    const preview = await service.preview(action)
    await expect(service.execute({ ...action, lifetimeSeconds: '86400' }, preview.token, f.terminals, f.runner)).rejects.toThrow('mismatched')
    expect(sshActionSchema.safeParse({ ...action, lifetimeSeconds: '0' }).success).toBe(false)
    expect(sshActionSchema.safeParse({ ...action, lifetimeSeconds: '600;id' }).success).toBe(false)
    expect(f.startProgram).not.toHaveBeenCalled()
  })
  it('removes an identity via its public file without requiring or deleting its private file', async () => {
    const dir = directory(); writeFileSync(join(dir, 'id_remove.pub'), 'ssh-ed25519 AAAA fixture\n')
    const agentProbe: ProbeRun = async (tool) => tool === 'ssh-keygen' ? probe(tool, []) : { code: 0, stdout: '256 SHA256:FixtureFingerprint fixture (ED25519)\n', stderr: '' }
    const service = new SshService(agentProbe, dir), f = execution()
    const action = { kind: 'agent.remove' as const, publicKeyName: 'id_remove.pub', fingerprint: 'SHA256:FixtureFingerprint' }
    const preview = await service.preview(action)
    await service.execute(action, preview.token, f.terminals, f.runner)
    expect((f.startProgram.mock.calls[0] as unknown as [{ argv: string[] }])[0].argv).toEqual(['-d', join(dir, 'id_remove.pub')])
    expect(readFileSync(join(dir, 'id_remove.pub'), 'utf8')).toBe('ssh-ed25519 AAAA fixture\n')
    expect(existsSync(join(dir, 'id_remove'))).toBe(false)
  })
  it('refuses stale agent contents and binds removal to the current agent endpoint', async () => {
    const dir = directory(), f = execution()
    let identities = '256 SHA256:First first (ED25519)'
    const agentProbe: ProbeRun = async () => ({ code: 0, stdout: identities, stderr: '' })
    const service = new SshService(agentProbe, dir), action = { kind: 'agent.clear' as const }
    const first = await service.preview(action)
    identities = '256 SHA256:Second second (ED25519)'
    await expect(service.execute(action, first.token, f.terminals, f.runner)).rejects.toThrow('changed')
    const second = await service.preview(action)
    vi.stubEnv('SSH_AUTH_SOCK', '/tmp/fixture-different-agent.sock')
    await expect(service.execute(action, second.token, f.terminals, f.runner)).rejects.toThrow('changed')
    expect(f.startProgram).not.toHaveBeenCalled()
    const fresh = await service.preview(action)
    expect(fresh.consequences.join(' ')).toContain('every repository')
    await service.execute(action, fresh.token, f.terminals, f.runner)
    expect((f.startProgram.mock.calls[0] as unknown as [{ argv: string[] }])[0].argv).toEqual(['-D'])
    expect(readdirSync(dir)).toEqual([])
  })
})
