import type { ProbeRun } from '../cli/probe'
import { PublicError } from '../../security/errors'

export interface PortTarget { pid: string; identity: string }

export async function inspectPortTarget(run: ProbeRun | undefined, port: string, requestedPid = ''): Promise<PortTarget> {
  if (!run) throw new PublicError('Port inspection is unavailable. Restart DevCommand.')
  const listeners = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
  if (listeners.code !== 0 && listeners.code !== 1) throw new PublicError('Unable to inspect this TCP port. Check lsof and local permissions.')
  const pids = [...new Set(listeners.stdout.split(/\r?\n/).filter((line) => /^p[1-9]\d*$/.test(line)).map((line) => line.slice(1)))]
  if (!pids.length) throw new PublicError(`No visible TCP listener on port ${port}.`)
  if (!requestedPid && pids.length !== 1) throw new PublicError(`Multiple processes listen on port ${port}. Inspect the port and enter the intended PID.`)
  const pid = requestedPid || pids[0]
  if (!pids.includes(pid)) throw new PublicError(`PID ${pid} is not listening on TCP port ${port}. Refresh the target.`)
  if (Number(pid) <= 1 || Number(pid) === process.pid || Number(pid) === process.ppid) throw new PublicError('DevCommand and its parent process cannot be stopped from this command.')
  const details = await run('ps', ['-p', pid, '-o', 'uid=', '-o', 'lstart=', '-o', 'comm='])
  const identity = details.stdout.trim()
  if (details.code !== 0 || !identity) throw new PublicError('The process exited. Inspect the port again.')
  const uid = identity.match(/^\d+/)?.[0]
  if (!uid || !process.getuid || Number(uid) !== process.getuid()) throw new PublicError('Only a listener owned by your current OS user can be stopped.')
  return { pid, identity }
}
