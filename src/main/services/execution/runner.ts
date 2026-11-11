import { textChunks } from '../../../shared/text'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { ExecutionEvent, ExecutionSnapshot, ExecutionStatus } from '../../../shared/runtime'
import { childEnvironment } from '../terminal/environment'
import { terminateTree } from '../../infrastructure/process/terminate'
import { LineRedactor } from './redact'

export interface ProcessDefinition { commandId: string; executable: string; argv: string[]; cwd: string; preview: string; timeoutMs?: number; secrets?: string[]; successExitCodes?: number[] }
interface Job {
  snapshot: ExecutionSnapshot; successExitCodes: number[]; child: ChildProcess; sequence: number; received: number; stored: number;
  redactors: { stdout: LineRedactor; stderr: LineRedactor }; timer: ReturnType<typeof setTimeout>;
  termination?: Promise<void>; done: Promise<void>; finish: () => void; ended: boolean
}
function managedEnvironment() {
  const env = childEnvironment()
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return env
}
const MAX_OUTPUT = 128 * 1024
const MAX_RECEIVED = 1024 * 1024
export class ManagedRunner {
  private jobs = new Map<string, Job>()
  private stopping = false
  constructor(private emit: (event: ExecutionEvent) => void) {}
  list(): ExecutionSnapshot[] { return [...this.jobs.values()].map((job) => ({ ...job.snapshot, output: [...job.snapshot.output] })) }
  execute(definition: ProcessDefinition): string {
    if (this.stopping || [...this.jobs.values()].filter((job) => !job.ended).length >= 4) throw new Error('Maximum 4 managed processes can run at once.')
    if (!statSync(definition.cwd).isDirectory()) throw new Error('Working directory is unavailable.')
    // The definition is backend-owned. Renderer requests are mapped to fixed entries by IPC.
    const child = spawn(definition.executable, definition.argv, {
      cwd: definition.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...managedEnvironment(), GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, stdio: ['ignore', 'pipe', 'pipe']
    })
    const id = randomUUID()
    let finish!: () => void
    const done = new Promise<void>((resolve) => { finish = resolve })
    const job: Job = {
      successExitCodes: definition.successExitCodes ?? [0],
      snapshot: { id, commandId: definition.commandId, preview: definition.preview, status: 'running', startedAt: new Date().toISOString(), exitCode: null, signal: null, output: [], truncated: false },
      child, sequence: 0, received: 0, stored: 0, redactors: { stdout: new LineRedactor(definition.secrets), stderr: new LineRedactor(definition.secrets) },
      timer: setTimeout(() => { void this.stop(job, 'timed-out') }, definition.timeoutMs ?? 10000), done, finish, ended: false
    }
    this.jobs.set(id, job)
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]!.setEncoding('utf8').on('data', (chunk: string) => {
        if (job.ended || job.termination) return
        job.received += Buffer.byteLength(chunk)
        if (job.received > MAX_RECEIVED) {
          job.snapshot.error = 'Output limit exceeded (1 MiB).'
          job.snapshot.truncated = true
          void this.stop(job, 'failed')
          return
        }
        this.output(job, stream, job.redactors[stream].push(chunk))
      })
    }
    child.on('error', () => {
      job.snapshot.error = 'Executable unavailable or process could not start. Check the local CLI installation.'
      this.end(job, null, null)
    })
    child.on('close', (code, signal) => this.end(job, code, signal))
    this.emit({ type: 'status', executionId: id, sequence: ++job.sequence, status: 'running' })
    this.prune()
    return id
  }
  private output(job: Job, stream: 'stdout' | 'stderr', data: string) {
    if (!data) return
    for (const chunk of textChunks(data, 8192)) {
      const sequence = ++job.sequence
      job.snapshot.output.push({ sequence, stream, data: chunk })
      job.stored += chunk.length
      while (job.stored > MAX_OUTPUT || job.snapshot.output.length > 512) {
        const old = job.snapshot.output.shift()!
        job.stored -= old.data.length
        job.snapshot.truncated = true
      }
      this.emit({ type: 'output', executionId: job.snapshot.id, sequence, stream, data: chunk })
    }
  }
  private end(job: Job, code: number | null, signal: NodeJS.Signals | null) {
    if (job.ended) return
    job.ended = true
    clearTimeout(job.timer)
    for (const stream of ['stdout', 'stderr'] as const) this.output(job, stream, job.redactors[stream].flush())
    job.snapshot.exitCode = code
    job.snapshot.signal = signal
    job.snapshot.finishedAt = new Date().toISOString()
    if (job.snapshot.status === 'running') job.snapshot.status = code !== null && job.successExitCodes.includes(code) && !job.snapshot.error ? 'succeeded' : 'failed'
    this.emit({ type: 'status', executionId: job.snapshot.id, sequence: ++job.sequence, status: job.snapshot.status })
    job.finish()
    this.prune()
  }
  private stop(job: Job, status: ExecutionStatus): Promise<void> {
    if (job.ended) return job.termination ?? Promise.resolve()
    if (job.termination) return job.termination
    job.snapshot.status = status
    clearTimeout(job.timer)
    const termination = (async () => {
      if (job.child.pid) await terminateTree(job.child.pid, process.platform !== 'win32')
      // Guarantee bounded completion even if an OS child refuses to close inherited pipes.
      if (!job.ended) {
        job.child.stdout?.destroy(); job.child.stderr?.destroy()
        this.end(job, null, null)
      }
      await job.done
    })()
    job.termination = termination
    return termination
  }
  cancel(id: string) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('Execution is no longer available.')
    return this.stop(job, 'cancelled')
  }
  private prune() {
    if (this.jobs.size <= 12) return
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= 12) break
      if (job.ended) this.jobs.delete(id)
    }
  }
  async closeAll() {
    this.stopping = true
    try { await Promise.all([...this.jobs.values()].map((job) => job.ended ? job.termination : this.stop(job, 'cancelled'))); this.jobs.clear() }
    finally { this.stopping = false }
  }
}
