import { readdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, userInfo } from 'node:os'
import { sshActionSchema, type SshAction, type SshHost, type SshKey, type SshPreview, type SshResult, type SshSnapshot } from '../../../shared/extended'
import { Confirmations, hash } from '../../security/confirmations'
import { PublicError } from '../../security/errors'
import { findExecutable, type ProbeRun } from '../cli/probe'
import { checkDirectory, readSshText, configState, writeConfig, metadata } from './files'
import { parseConfig, updateConfig } from './config'
import { redact } from '../execution/redact'
import { displayCommand } from '../commands/registry'
import type { TerminalManager } from '../terminal/manager'
import type { ManagedRunner } from '../execution/runner'

const publicName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.pub$/
const reserved = new Set(['config', 'authorized_keys', 'known_hosts', 'known_hosts2'])
interface Prepared { action: SshAction; state: string; display: string; consequences: string[]; argv?: string[]; executable?: string; nextText?: string; revision: string }
export class SshService {
  private confirmations = new Confirmations()
  private generating = new Set<string>()
  constructor(private probe: ProbeRun, readonly directory = join(homedir(), '.ssh'), private changed = () => {}) {}
  private identityName(value: string): string | undefined {
    const normalized = value.replaceAll('\\', '/')
    const prefix = this.directory.replaceAll('\\', '/') + '/'
    const name = normalized.startsWith('~/.ssh/') ? normalized.slice(7) : normalized.startsWith(prefix) ? normalized.slice(prefix.length) : undefined
    return name && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name) && !name.endsWith('.pub') && !reserved.has(name) ? name : undefined
  }
  private config() {
    const state = configState(this.directory)
    return { ...state, parsed: parseConfig(state.text, (value) => this.identityName(value)) }
  }
  private publicText(name: string): string {
    if (!publicName.test(name)) throw new PublicError('Select a public .pub key from this SSH directory.')
    const text = readSshText(this.directory, name, 16384)?.trim()
    if (!text || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+(?:[ \t]+[^\r\n]*)?$/.test(text)) throw new PublicError('This file is not a supported OpenSSH public key.')
    return text
  }
  async publicKey(name: string): Promise<string> {
    const text = this.publicText(name)
    const [type, body, ...comment] = text.split(/\s+/)
    return [type, body, redact(comment.join(' '))].filter(Boolean).join(' ')
  }
  private privateAvailable(name: string): boolean {
    try { const stat = lstatSync(join(this.directory, name)); return stat.isFile() && !stat.isSymbolicLink() && (process.platform === 'win32' || ((stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid()))) } catch { return false }
  }
  private async key(name: string): Promise<SshKey> {
    const text = this.publicText(name)
    const result = await this.probe('ssh-keygen', ['-l', '-E', 'sha256', '-f', join(this.directory, name)])
    const fingerprint = result.stdout.match(/^\d+\s+(SHA256:[A-Za-z0-9+/]+)/)?.[1]
    if (result.code !== 0 || !fingerprint) throw new PublicError('OpenSSH could not validate the selected public key.')
    const [type, , ...comment] = text.split(/\s+/)
    return { name, type, fingerprint, comment: redact(comment.join(' ')).slice(0, 300), privateAvailable: this.privateAvailable(name.slice(0, -4)) }
  }
  async snapshot(): Promise<SshSnapshot> {
    checkDirectory(this.directory)
    const tools = { ssh: !!findExecutable('ssh'), 'ssh-keygen': !!findExecutable('ssh-keygen'), 'ssh-add': !!findExecutable('ssh-add') }
    const config = this.config(), keys: SshKey[] = [], notices: string[] = []
    let names: string[] = []
    try { names = readdirSync(this.directory).filter((name) => publicName.test(name)).slice(0, 100) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new PublicError('Unable to list SSH metadata. Check directory permissions.') }
    if (tools['ssh-keygen']) for (const name of names) { try { keys.push(await this.key(name)) } catch { notices.push(`Skipped unsupported, symlinked or invalid public key: ${name}`) } }
    const agent: SshSnapshot['agent'] = { available: false, message: 'ssh-add is unavailable.', identities: [] }
    if (tools['ssh-add']) {
      try {
        const result = await this.probe('ssh-add', ['-l', '-E', 'sha256'])
        agent.available = result.code === 0 || result.code === 1
        agent.message = result.code === 0 ? 'Agent identities loaded.' : result.code === 1 ? 'The agent has no identities.' : 'No reachable SSH agent. Start an OS agent and refresh.'
        agent.identities = result.code === 0 ? result.stdout.trim().split('\n').slice(0, 100).map((line) => redact(line)) : []
      } catch { agent.message = 'Unable to query the OS SSH agent.' }
    }
    if (config.parsed.complex) notices.push('Include/Match directives are preserved. Config writes are disabled; declared host fields are shown without evaluating custom commands or includes.')
    notices.push('Connection diagnostics bypass custom proxy/local commands and use strict host-key checking. Unknown or changed hosts are refused; verify them outside DevCommand before retrying.')
    return { directory: this.directory, revision: config.revision, keys, hosts: config.parsed.blocks.map((block) => ({ ...block.host, user: block.host.user || userInfo().username })), tools, agent, writable: process.platform !== 'win32', notices }
  }
  private host(action: Extract<SshAction, { kind: 'connection.test' }>, config: ReturnType<SshService['config']>): SshHost {
    const host = config.parsed.blocks.find((block) => block.host.alias.toLowerCase() === action.alias.toLowerCase())?.host
    if (!host) throw new PublicError('This Host alias no longer exists. Refresh the host list.')
    const validated = sshActionSchema.safeParse({ kind: 'host.update', alias: host.alias, hostName: host.hostName, user: host.user || userInfo().username, port: host.port, identityName: host.identityName, revision: config.revision })
    if (!validated.success || validated.data.kind !== 'host.update' || host.reason?.includes('IdentityFile') || host.reason?.includes('Duplicate')) throw new PublicError('Connection diagnostics require literal host/user/port and at most one identity from this SSH directory.')
    return { ...host, ...validated.data }
  }
  private async prepare(input: SshAction): Promise<Prepared> {
    const action = sshActionSchema.parse(input)
    checkDirectory(this.directory)
    const config = this.config(), consequences: string[] = []
    let display: string, argv: string[] | undefined, executable: string | undefined, nextText: string | undefined, targetState = ''
    if ('revision' in action && action.revision !== config.revision) throw new PublicError('SSH config changed since it was displayed. Refresh before reviewing this action.')
    if (action.kind === 'key.generate') {
      if (process.platform === 'win32') throw new PublicError('SSH key generation awaits Windows permission/ACL validation.')
      if (reserved.has(action.name) || action.name.endsWith('.pub') || this.generating.has(action.name)) throw new PublicError('Choose a new key basename, not a reserved SSH metadata name.')
      if (redact(action.comment) !== action.comment) throw new PublicError('Do not put credentials or tokens in the public key comment.')
      const path = join(this.directory, action.name)
      if (metadata(path) !== 'missing' || metadata(path + '.pub') !== 'missing') throw new PublicError('A file with this key name already exists. Existing keys are never overwritten automatically.')
      executable = findExecutable('ssh-keygen'); if (!executable) throw new PublicError('Install OpenSSH ssh-keygen and refresh.')
      argv = ['-t', 'ed25519', '-a', '64', '-C', action.comment, '-f', path]
      display = displayCommand('ssh-keygen', argv)
      targetState = [metadata(path), metadata(path + '.pub')].join('|')
      consequences.push('Creates a new ed25519 key pair in your OS SSH directory. Existing keys will not be replaced automatically.', 'The terminal will ask for a passphrase interactively. DevCommand never places it in argv, logs or its database.')
    } else if (action.kind === 'agent.add') {
      const key = await this.key(action.publicKeyName)
      if (key.fingerprint !== action.fingerprint || !key.privateAvailable) throw new PublicError('The key changed, its private pair is missing/symlinked, or its permissions are unsafe. Refresh and check it before loading.')
      executable = findExecutable('ssh-add'); if (!executable) throw new PublicError('ssh-add is unavailable.')
      const path = join(this.directory, action.publicKeyName.slice(0, -4))
      argv = ['-t', '3600', path]; display = displayCommand('ssh-add', argv)
      targetState = JSON.stringify([key.fingerprint, metadata(path)])
      consequences.push('Loads this key into the OS agent for one hour. An existing agent must be available.', 'Enter any passphrase in the terminal. The application never reads the private key file content or saves the passphrase.')
    } else if (action.kind === 'connection.test') {
      const host = this.host(action, config)
      executable = findExecutable('ssh'); if (!executable) throw new PublicError('OpenSSH ssh is unavailable.')
      const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const knownHosts = join(this.directory, 'known_hosts').replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      argv = ['-F', nullConfig, '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'CheckHostIP=no', '-o', 'UpdateHostKeys=no', '-o', 'VerifyHostKeyDNS=no', '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=10', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', `UserKnownHostsFile="${knownHosts}"`, '-p', String(host.port), '-l', host.user]
      if (host.identityName) { if (!this.privateAvailable(host.identityName)) throw new PublicError('The configured identity is unavailable or unsafe. Check its permissions.'); argv.push('-o', 'IdentitiesOnly=yes', '-i', join(this.directory, host.identityName)) }
      argv.push('--', host.hostName)
      display = displayCommand('ssh', argv)
      targetState = host.identityName ? metadata(join(this.directory, host.identityName)) : ''
      consequences.push(`Connects directly to ${host.user}@${host.hostName}:${host.port}. No custom ProxyCommand/ProxyJump/LocalCommand is executed.`, 'Unknown or changed host keys are refused. Password/passphrase prompts are disabled; use an unlocked OS agent.', 'SSH servers, including Git providers, can return a nonzero code after successful authentication. Read the diagnostic output; exit code alone does not establish authentication success.')
    } else {
      if (process.platform === 'win32') throw new PublicError('SSH config writes await Windows permission/ACL validation.')
      nextText = updateConfig(config.text, config.parsed, action, this.directory)
      if ('identityName' in action && action.identityName && !this.privateAvailable(action.identityName)) throw new PublicError('Select a private identity present in this SSH directory with safe permissions.')
      display = `${action.kind === 'host.remove' ? 'Remove' : 'Write'} Host ${action.alias} in ${join(this.directory, 'config')}`
      consequences.push('Creates a private local backup before changing an existing config. Comments and directives outside the edited fields are preserved.', action.kind === 'host.remove' ? 'Removes this Host block and its directives. Existing keys and server files are not deleted.' : 'Edits only declared HostName/User/Port/IdentityFile/IdentitiesOnly fields. Earlier wildcard rules may still affect normal SSH; Includes/Match require manual editing.')
    }
    return { action, state: hash(JSON.stringify([config.revision, metadata(this.directory), targetState])), display, consequences, executable, argv, nextText, revision: config.revision }
  }
  async preview(input: SshAction): Promise<SshPreview> { const prepared = await this.prepare(input); return { ...this.confirmations.issue(prepared.action, prepared.state), display: prepared.display, consequences: prepared.consequences } }
  async execute(input: SshAction, token: string, terminals: TerminalManager, runner: ManagedRunner): Promise<SshResult> {
    const action = sshActionSchema.parse(input), expected = this.confirmations.take(token, action), prepared = await this.prepare(action)
    if (prepared.state !== expected) throw new PublicError('SSH metadata changed after preview. Review the action again.')
    if (prepared.nextText !== undefined) { const backupPath = writeConfig(this.directory, prepared.nextText, prepared.revision); this.changed(); return { kind: 'config', backupPath } }
    if (action.kind === 'connection.test') {
      const executionId = runner.execute({ commandId: 'ssh.connection.test', executable: prepared.executable!, argv: prepared.argv!, cwd: homedir(), preview: prepared.display, timeoutMs: 15000 })
      return { kind: 'execution', executionId }
    }
    checkDirectory(this.directory, true)
    if (action.kind === 'key.generate') {
      // A second request may have finished its async preparation in the same turn.
      if (this.generating.has(action.name) || metadata(join(this.directory, action.name)) !== 'missing' || metadata(join(this.directory, action.name + '.pub')) !== 'missing') throw new PublicError('This key name is already in use. Choose a new basename.')
      this.generating.add(action.name)
    }
    try {
      const session = terminals.startProgram({ executable: prepared.executable!, argv: prepared.argv!, cwd: this.directory, label: action.kind === 'key.generate' ? 'ssh-keygen' : 'ssh-add', onClosed: () => { if (action.kind === 'key.generate') this.generating.delete(action.name); this.changed() } })
      return { kind: 'terminal', session }
    } catch { if (action.kind === 'key.generate') this.generating.delete(action.name); throw new PublicError('Unable to start the SSH terminal program. Check native terminal support and available tabs.') }
  }
  clear() { this.confirmations.clear() }
}
