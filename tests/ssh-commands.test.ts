import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CommandService } from '../src/main/services/commands/service'
import { expand, getDefinition, registry, validateParams } from '../src/main/services/commands/registry'
import { groupCommands } from '../src/shared/command-groups'
import type { SettingsStore } from '../src/main/infrastructure/database/store'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import type { ManagedRunner } from '../src/main/services/execution/runner'
import type { TerminalManager } from '../src/main/services/terminal/manager'
import type { SshService } from '../src/main/services/ssh/service'

vi.mock('../src/main/services/cli/probe', async (original) => ({ ...await original<object>(), findExecutable: (name: string) => `/usr/bin/${name}` }))
function fixture() {
  const previewToken = randomUUID()
  const session = { id: randomUUID(), cwd: '/fixture/.ssh', shell: 'ssh-keygen', status: 'running' as const }
  const status = vi.fn(async () => { throw new Error('SSH must not depend on a selected repository') })
  const workspace = { status } as unknown as WorkspaceService
  const execute = vi.fn()
  const runner = { execute } as unknown as ManagedRunner
  const startProgram = vi.fn(() => session)
  const terminals = { startProgram } as unknown as TerminalManager
  const sshExecute = vi.fn(async () => ({ kind: 'terminal', session }))
  const sshPreview = vi.fn(async () => ({ token: previewToken, expiresAt: new Date(Date.now() + 60000).toISOString(), display: 'ssh fixture command', consequences: ['fixture SSH action'] }))
  const publicKey = vi.fn(async () => 'ssh-ed25519 AAAA fixture')
  const ssh = { directory: '/fixture/.ssh', preview: sshPreview, execute: sshExecute, publicKey, snapshot: async () => ({ keys: [{ name: 'id_work.pub', fingerprint: 'SHA256:fixture', privateAvailable: true }] }) } as unknown as SshService
  const service = new CommandService({} as SettingsStore, workspace, runner, undefined, undefined, undefined, ssh)
  return { service, terminals, startProgram, sshExecute, sshPreview, publicKey, status, previewToken }
}
describe('SSH command library', () => {
  it('groups fourteen actions into SSH, SSH Keys and SSH Agent', () => {
    const entries = registry.filter((entry) => entry.category === 'SSH').map((entry) => ({ ...entry, favorite: false }))
    expect(entries).toHaveLength(14)
    expect(groupCommands(entries).map((group) => [group.title, group.commands.length])).toEqual([['SSH', 5], ['SSH Keys', 3], ['SSH Agent', 6]])
  })
  it('keeps key listing, agent startup and GitHub authentication independent', async () => {
    const f = fixture()
    const listing = await f.service.prepare({ commandId: 'ssh.key.list', params: {} })
    expect(listing.process.executable).toBe('/usr/bin/ls')
    expect(listing.process.argv).toEqual(['-la', '/fixture/.ssh'])
    expect(listing.definition.mutation).toBe(false)
    const github = await f.service.prepare({ commandId: 'ssh.github.test', params: {} })
    expect(github.process.argv).toEqual(['-T', 'git@github.com'])
    expect(github.definition.interactive).toBe(true)
    const request = { commandId: 'ssh.agent.start', params: { keyName: 'id_work' } }
    const preview = await f.service.preview(request)
    expect(preview.display).toBe('eval "$(ssh-agent -s)" && ssh-add /fixture/.ssh/id_work')
    expect(preview.consequences.join(' ')).toContain('then adds the selected key')
    await expect(f.service.launch(request, randomUUID(), f.terminals)).rejects.toThrow('Confirmation')
    await f.service.launch(request, preview.confirmationToken!, f.terminals)
    expect(f.startProgram).toHaveBeenCalledWith(expect.objectContaining({
      executable: '/usr/bin/zsh', argv: ['-f', '-i'], initialCommand: 'devcommand_agent_env="$(ssh-agent -s)" && eval "$devcommand_agent_env" && ssh-add /fixture/.ssh/id_work', keepShell: false
    }))
    expect(f.sshExecute).not.toHaveBeenCalled()
    expect(f.status).not.toHaveBeenCalled()
  })
  it('refuses unavailable keys and never loads the inherited agent when startup fails', async () => {
    const f = fixture()
    await expect(f.service.prepare({ commandId: 'ssh.agent.start', params: { keyName: 'missing' } })).rejects.toThrow('existing SSH key')
    const prepared = await f.service.prepare({ commandId: 'ssh.agent.start', params: { keyName: 'id_work' } })
    const { spawnSync } = await import('node:child_process')
    // Shell functions replace both SSH executables: no agent or real key is touched.
    const failed = spawnSync('/bin/bash', ['-c', 'ssh-agent() { return 42; }; ssh-add() { printf "UNEXPECTED_ADD"; }; ' + prepared.initialCommand], { encoding: 'utf8' })
    expect(failed.status).toBe(42)
    expect(failed.stdout).not.toContain('UNEXPECTED_ADD')
    const success = spawnSync('/bin/bash', ['-c', 'ssh-agent() { printf "export SSH_AUTH_SOCK=/fixture/new-agent;"; }; ssh-add() { printf "%s %s" "$SSH_AUTH_SOCK" "$1"; }; ' + prepared.initialCommand], { encoding: 'utf8' })
    expect(success.status).toBe(0)
    expect(success.stdout).toBe('/fixture/new-agent /fixture/.ssh/id_work')
  })
  it('validates hosts, users, key names and ports without accepting options or shell commands', () => {
    for (const host of ['-oProxyCommand=evil', 'user@host', 'host;id', 'host name', 'host\n']) expect(() => validateParams(getDefinition('ssh.connect'), { host, user: 'git', port: '22' })).toThrow()
    for (const host of ['github.com', 'github-work', '127.0.0.1', '::1']) expect(expand(getDefinition('ssh.connect'), validateParams(getDefinition('ssh.connect'), { host, user: 'git', port: '2222' }))).toEqual(['-p', '2222', '-l', 'git', host])
    for (const keyName of ['../id', '/etc/passwd', '-f', 'id.pub']) expect(() => validateParams(getDefinition('ssh.key.generate'), { keyName })).toThrow()
    for (const port of ['-1', '0', '65536', '22;id']) expect(() => validateParams(getDefinition('ssh.connect'), { host: 'github.com', user: 'git', port })).toThrow()
  })
  it('opens a confirmed SSH PTY independently of repository state', async () => {
    const f = fixture()
    const request = { commandId: 'ssh.connect', workspaceId: randomUUID(), params: { host: 'github-work', user: 'git', port: '22' } }
    const preview = await f.service.preview(request)
    expect(preview.display).toBe('ssh -p 22 -l git github-work')
    expect(preview.consequences.join(' ')).not.toContain('AI')
    await expect(f.service.launch(request, randomUUID(), f.terminals)).rejects.toThrow('Confirmation')
    await f.service.launch(request, preview.confirmationToken!, f.terminals)
    expect(f.startProgram).toHaveBeenCalledWith({ executable: '/usr/bin/ssh', argv: ['-p', '22', '-l', 'git', 'github-work'], cwd: homedir(), label: 'Connect with SSH', keepShell: true })
    expect(f.status).not.toHaveBeenCalled()
  })
  it('diagnoses direct hosts with strict host keys, no config commands and no password prompt', async () => {
    const f = fixture()
    const prepared = await f.service.prepare({ commandId: 'ssh.test', params: { host: 'github.com', user: 'git', port: '22' } })
    expect(prepared.process.argv).toContain('StrictHostKeyChecking=yes')
    expect(prepared.process.argv).toContain('BatchMode=yes')
    expect(prepared.process.argv).toContain('ProxyCommand=none')
    expect(prepared.process.argv.slice(0, 2)).toEqual(['-F', '/dev/null'])
    expect(prepared.process.argv.slice(-1)).toEqual(['github.com'])
  })
  it('delegates key generation and agent loading to the existing SSH service', async () => {
    const f = fixture()
    const generate = { commandId: 'ssh.key.generate', params: { keyName: 'id_work', comment: 'work' } }
    const preview = await f.service.preview(generate)
    expect(preview.confirmationToken).toBe(f.previewToken)
    expect(preview.cwd).toBe('/fixture/.ssh')
    await f.service.launch(generate, f.previewToken, f.terminals)
    expect(f.sshExecute).toHaveBeenCalledWith({ kind: 'key.generate', name: 'id_work', comment: 'work' }, f.previewToken, f.terminals, expect.anything())
    const load = { commandId: 'ssh.agent.add', params: { keyName: 'id_work' } }
    await f.service.preview(load)
    await f.service.launch(load, f.previewToken, f.terminals)
    expect(f.sshExecute).toHaveBeenCalledWith({ kind: 'agent.add', publicKeyName: 'id_work.pub', fingerprint: 'SHA256:fixture', lifetimeSeconds: '3600' }, f.previewToken, f.terminals, expect.anything())
    expect(f.startProgram).not.toHaveBeenCalled()
  })
  it('passes the selected RSA type through library preview and terminal launch', async () => {
    const f = fixture()
    const request = { commandId: 'ssh.key.generate', params: { keyType: 'rsa', keyName: 'id_rsa_new', comment: 'fixture' } }
    const prepared = await f.service.prepare(request)
    expect(prepared.process.argv).toEqual(['-t', 'rsa', '-b', '4096', '-a', '64', '-C', 'fixture', '-f', '/fixture/.ssh/id_rsa_new'])
    await f.service.launch(request, f.previewToken, f.terminals)
    expect(f.sshExecute).toHaveBeenCalledWith({ kind: 'key.generate', keyType: 'rsa', name: 'id_rsa_new', comment: 'fixture' }, f.previewToken, f.terminals, expect.anything())
  })
  it('offers an editable private key name and independent lifetime for loading', () => {
    const definition = getDefinition('ssh.agent.add')
    expect(definition.parameters.find((field) => field.key === 'keyName')).toMatchObject({
      label: 'Private key name (inside ~/.ssh)', type: 'string', defaultValue: 'id_ed25519'
    })
    expect(validateParams(definition, { keyName: 'id_work', lifetimeSeconds: 'unlimited' })).toEqual({
      keyName: 'id_work', lifetimeSeconds: 'unlimited'
    })
    expect(getDefinition('ssh.agent.start').parameters[0]).toMatchObject({ key: 'keyName', defaultValue: 'id_ed25519' })
  })
  it('omits the lifetime flag for unlimited agent loading in copy and insert argv', async () => {
    const f = fixture()
    const prepared = await f.service.prepare({ commandId: 'ssh.agent.add', params: { keyName: 'id_work', lifetimeSeconds: 'unlimited' } })
    expect(prepared.process.argv).toEqual([join('/fixture/.ssh', 'id_work')])
  })
  it('validates public key content before reading its fingerprint', async () => {
    const f = fixture()
    const prepared = await f.service.prepare({ commandId: 'ssh.key.fingerprint', params: { keyName: 'id_work' } })
    expect(f.publicKey).toHaveBeenCalledWith('id_work.pub')
    expect(prepared.process.argv).toEqual(['-E', 'sha256', '-lf', join('/fixture/.ssh', 'id_work.pub')])
  })
})
