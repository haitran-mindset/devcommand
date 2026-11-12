import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { PublicError } from '../../security/errors'

const execute = promisify(execFile)
/** Read an app-owned PTY process, never infer directories by parsing user shell input. */
export async function readProcessDirectory(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 1) throw new PublicError('This terminal is no longer available.')
  try {
    if (process.platform === 'linux') return await realpath(`/proc/${pid}/cwd`)
    if (process.platform === 'darwin') {
      const { stdout } = await execute('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn0'], { encoding: 'utf8', timeout: 3000, maxBuffer: 65536 })
      const path = stdout.split('\0').find(field => field.startsWith('n'))?.slice(1)
      if (path?.startsWith('/')) return await realpath(path)
    }
  } catch { /* A closed process, missing directory or denied OS query must never fall back to a stale startup path. */ }
  throw new PublicError('Unable to read the current terminal directory. Keep the terminal open or choose another Run target.')
}
