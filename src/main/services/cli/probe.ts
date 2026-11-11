import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import { childEnvironment } from '../terminal/environment'
import { PublicError } from '../../security/errors'
import { terminateTree } from '../../infrastructure/process/terminate'

export function findExecutable(name: string): string | undefined {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return undefined
  for (const directory of (childEnvironment().PATH ?? '').split(delimiter).filter(isAbsolute)) {
    for (const suffix of process.platform === 'win32' ? ['.exe', '.com', ''] : ['']) {
      try { const path = join(directory, name + suffix); accessSync(path, constants.X_OK); if (statSync(path).isFile()) return realpathSync(path) } catch { /* Continue through trusted absolute PATH entries. */ }
    }
  }
  return undefined
}
export interface CliResult { code: number | null; stdout: string; stderr: string }
export type ProbeRun = (executable: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<CliResult>
export class CliProbe {
  private active = new Set<ChildProcess>()
  private stopping = false
  readonly run: ProbeRun = async (executable, args, options = {}) => {
    if (this.stopping) throw new PublicError('The application is closing. Try again after reopening it.')
    const path = findExecutable(executable)
    if (!path) throw new PublicError(`${executable} is not available on the application PATH.`)
    return new Promise((resolve, reject) => {
      const env = childEnvironment()
      for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
      const child = spawn(path, args, { cwd: options.cwd ?? homedir(), env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      this.active.add(child)
      let stdout = '', stderr = '', size = 0, limited = false
      const stop = () => { limited = true; if (child.pid) void terminateTree(child.pid, process.platform !== 'win32').catch(() => child.kill('SIGKILL')) }
      const timer = setTimeout(stop, options.timeoutMs ?? 5000)
      for (const stream of ['stdout', 'stderr'] as const) child[stream]!.setEncoding('utf8').on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk)
        if (size > 1024 * 1024) { if (!limited) stop(); return }
        if (stream === 'stdout') stdout += chunk; else stderr += chunk
      })
      child.once('error', () => { clearTimeout(timer); this.active.delete(child); reject(new PublicError(`Unable to start ${executable}. Check its local installation.`)) })
      child.once('close', (code) => { clearTimeout(timer); this.active.delete(child); if (limited) reject(new PublicError(`${executable} exceeded the read timeout or output limit.`)); else resolve({ code, stdout, stderr }) })
    })
  }
  async closeAll() {
    this.stopping = true
    try { await Promise.all([...this.active].map((child) => child.pid ? terminateTree(child.pid, process.platform !== 'win32') : Promise.resolve())) }
    finally { this.active.clear(); this.stopping = false }
  }
}
