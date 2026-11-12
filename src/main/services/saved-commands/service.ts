import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { Confirmations, hash } from '../../security/confirmations'
import { PublicError } from '../../security/errors'
import { savedCommandRunSchema, savedCommandTitle, type SavedCommandRun, type SavedCommandPreview } from '../../../shared/saved-commands'
import type { SettingsStore } from '../../infrastructure/database/store'
import type { WorkspaceService } from '../workspace/service'
import type { TerminalManager } from '../terminal/manager'
import { findExecutable } from '../cli/probe'

export class SavedCommandService {
  private generation = 0
  private confirmations: Confirmations
  constructor(private store: SettingsStore, private workspace: WorkspaceService, private terminals: TerminalManager, now?: () => number) {
    this.confirmations = new Confirmations(now)
  }
  private async prepare(input: SavedCommandRun) {
    const request = savedCommandRunSchema.parse(input)
    if (process.platform === 'win32') throw new PublicError('Saved command execution currently requires a POSIX shell on macOS or Linux.')
    const shell = findExecutable('zsh') ?? findExecutable('bash')
    if (!shell) throw new PublicError('Install zsh or bash to run a saved command.')
    if (request.terminalId && request.workspaceId) throw new PublicError('Choose one Run target.')
    const directory = request.terminalId ? await this.terminals.currentDirectory(request.terminalId) : request.workspaceId ? (await this.workspace.resolve(request.workspaceId)).rootPath : homedir()
    let cwd: string, identity: string
    try {
      cwd = realpathSync(directory)
      const stat = statSync(cwd, { bigint: true })
      if (!stat.isDirectory()) throw new Error()
      identity = `${stat.dev}:${stat.ino}`
    } catch { throw new PublicError('The target directory is no longer available. Choose another directory and review again.') }
    const record = this.store.requireSavedCommand(request.id, request.revision)
    return { request, record, shell, cwd, state: hash(JSON.stringify([record.id, record.revision, record.command, shell, cwd, identity])) }
  }
  async preview(input: SavedCommandRun): Promise<SavedCommandPreview> {
    const generation = this.generation
    const prepared = await this.prepare(input)
    if (generation !== this.generation) throw new PublicError('The application session changed. Review a fresh preview.')
    return { ...this.confirmations.issue(prepared.request, prepared.state), title: savedCommandTitle(prepared.record), command: prepared.record.command, cwd: prepared.cwd, shell: prepared.shell }
  }
  async run(input: SavedCommandRun, token: string) {
    const request = savedCommandRunSchema.parse(input)
    const generation = this.generation
    const expected = this.confirmations.take(token, request)
    const prepared = await this.prepare(request)
    if (generation !== this.generation) throw new PublicError('The application session changed. Review a fresh preview.')
    if (prepared.state !== expected) throw new PublicError('The command or target directory changed. Review a fresh preview.')
    // Script text is intentional user code, kept in one argv element; execution requires an exact, single-use confirmation.
    return this.terminals.startProgram({ executable: prepared.shell, argv: ['-c', prepared.record.command], cwd: prepared.cwd, label: savedCommandTitle(prepared.record), keepShell: true })
  }
  clear() { this.generation++; this.confirmations.clear() }
}
