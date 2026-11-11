import { textChunks, hasControlCharacters } from '../../../shared/text'
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'
import type { IDisposable, IPty } from 'node-pty'
import type { CreateTerminalRequest, TerminalDataEvent, TerminalExitEvent, TerminalSession } from '../../../shared/runtime'
import { terminalCreateSchema, terminalWriteSchema, terminalResizeSchema, terminalAckSchema, idSchema } from '../../../shared/runtime'
import { childEnvironment, getShellEnvironment, type ShellEnvironment } from './environment'
import { terminateTree } from '../../infrastructure/process/terminate'

interface Session {
  summary: TerminalSession; pty: IPty; sequence: number; acknowledged: number; pending: Map<number, number>;
  buffered: number; onClosed?: () => void; draft?: string; readiness: string; listeners: IDisposable[]; closing?: Promise<void>
}
export class TerminalManager {
  private sessions = new Map<string, Session>()
  private stopping = false
  private pendingCloses = new Set<Promise<void>>()
  constructor(
    private readonly emitData: (event: TerminalDataEvent) => void,
    private readonly emitExit: (event: TerminalExitEvent) => void,
    private readonly environment: ShellEnvironment = getShellEnvironment(),
    private readonly spawnPty = nodePty.spawn,
    private readonly terminate = terminateTree
  ) {}
  getEnvironment() {
    const { cwd, shells, defaultShellId } = this.environment
    return { cwd, shells, defaultShellId }
  }
  create(input: CreateTerminalRequest, cwd = this.environment.cwd): TerminalSession {
    const options = terminalCreateSchema.parse(input)
    if (this.stopping || this.sessions.size >= 8) throw new Error('Close a terminal tab before opening another (maximum 8).')
    const shell = this.environment.paths.get(options.shellId)
    if (!shell) throw new Error('Select an installed shell.')
    return this.spawnProgram(shell, process.platform === 'win32' ? [] : ['-i'], cwd, this.environment.shells.find((item) => item.id === options.shellId)!.label, options.cols, options.rows)
  }
  startProgram(program: { executable: string; argv: string[]; cwd: string; label: string; onClosed?: () => void }): TerminalSession {
    return this.spawnProgram(program.executable, program.argv, program.cwd, program.label, 100, 24, program.onClosed)
  }
  private spawnProgram(executable: string, argv: string[], cwd: string, label: string, cols: number, rows: number, onClosed?: () => void): TerminalSession {
    if (this.stopping || this.sessions.size >= 8) throw new Error('Close a terminal tab before opening another (maximum 8).')
    const pty = this.spawnPty(executable, argv, { name: 'xterm-256color', cols, rows, cwd, env: childEnvironment() })
    const summary: TerminalSession = { id: randomUUID(), shell: label, cwd, status: 'running' }
    const entry: Session = { summary, pty, sequence: 0, acknowledged: 0, pending: new Map(), buffered: 0, readiness: '', listeners: [], onClosed }
    this.sessions.set(summary.id, entry)
    // Start paused until the mounted renderer sends its first resize.
    pty.pause()
    entry.listeners.push(pty.onData((data) => {
      if (entry.closing) return
      if (entry.draft) {
        entry.readiness = (entry.readiness + data).slice(-512)
        if (entry.readiness.includes('\x1b[?2004h')) {
          const text = entry.draft
          entry.draft = undefined
          pty.write('\x15\x1b[200~' + text + '\x1b[201~')
        }
      }
      for (const chunk of textChunks(data, 8192)) {
        const sequence = ++entry.sequence
        entry.pending.set(sequence, chunk.length)
        entry.buffered += chunk.length
        this.emitData({ sessionId: summary.id, sequence, data: chunk })
      }
      if (entry.buffered >= 65536) pty.pause()
    }), pty.onExit(({ exitCode, signal }) => {
      if (!this.sessions.has(summary.id)) return
      this.sessions.delete(summary.id)
      const closed = entry.onClosed; entry.onClosed = undefined; closed?.()
      entry.listeners.forEach((listener) => listener.dispose())
      this.emitExit({ sessionId: summary.id, exitCode, signal })
    }))
    return summary
  }
  setDraft(id: string, display: string) {
    if (hasControlCharacters(display) || display.length > 8192) throw new Error('Unsafe terminal draft')
    this.get(id).draft = display
  }
  private get(id: string): Session {
    const entry = this.sessions.get(idSchema.parse(id))
    if (!entry || entry.closing) throw new Error('Terminal session is no longer running.')
    return entry
  }
  write(sessionId: string, data: string) {
    const input = terminalWriteSchema.parse({ sessionId, data })
    this.get(input.sessionId).pty.write(input.data)
  }
  resize(sessionId: string, cols: number, rows: number) {
    const input = terminalResizeSchema.parse({ sessionId, cols, rows })
    const entry = this.get(input.sessionId)
    entry.pty.resize(input.cols, input.rows)
    if (entry.sequence === 0 || entry.buffered < 32768) entry.pty.resume()
  }
  acknowledge(sessionId: string, sequence: number) {
    terminalAckSchema.parse({ sessionId, sequence })
    const entry = this.sessions.get(sessionId)
    if (!entry || entry.closing) return
    if (sequence > entry.sequence || sequence <= entry.acknowledged) return
    for (const [pendingSequence, size] of entry.pending) {
      if (pendingSequence <= sequence) { entry.buffered -= size; entry.pending.delete(pendingSequence) }
    }
    entry.acknowledged = sequence
    if (entry.buffered < 32768) entry.pty.resume()
  }
  close(id: string): Promise<void> {
    idSchema.parse(id)
    const entry = this.sessions.get(id)
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.pty.pause()
    const closing = this.terminate(entry.pty.pid).finally(() => {
      try { entry.pty.kill() } catch { /* Already exited. */ }
      entry.listeners.forEach((listener) => listener.dispose())
      this.sessions.delete(id)
      const closed = entry.onClosed; entry.onClosed = undefined; closed?.()
      this.emitExit({ sessionId: id, exitCode: -1 })
      this.pendingCloses.delete(closing)
    })
    entry.closing = closing
    this.pendingCloses.add(closing)
    return closing
  }
  async closeAll() {
    this.stopping = true
    try { await Promise.all([...this.sessions.keys()].map((id) => this.close(id))); await Promise.all(this.pendingCloses) }
    finally { this.stopping = false }
  }
}
