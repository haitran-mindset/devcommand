import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, mkdirSync, writeFileSync, renameSync, linkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hash } from '../../security/confirmations'
import { PublicError } from '../../security/errors'

export function checkDirectory(directory: string, create = false) {
  try {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid())))) throw new PublicError('The SSH directory must be a user-owned, non-symlink directory without group/world write permissions.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (create) mkdirSync(directory, { mode: 0o700, recursive: false })
  }
}
/** The only text files the application may open in this directory are config and public .pub files. */
export function readSshText(directory: string, name: string, maxBytes: number): string | undefined {
  if (name !== 'config' && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.pub$/.test(name)) throw new PublicError('Only SSH config and public key files can be read.')
  checkDirectory(directory)
  const path = join(directory, name)
  let fd: number | undefined
  try {
    if (lstatSync(path).isSymbolicLink()) throw new PublicError('Symlink SSH metadata files are not read or edited.')
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) throw new PublicError('SSH metadata file is not a bounded regular file.')
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) { const count = readSync(fd, buffer, offset, buffer.length - offset, offset); if (!count) break; offset += count }
    return buffer.subarray(0, offset).toString('utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  finally { if (fd !== undefined) closeSync(fd) }
}
export function metadata(path: string): string {
  try { const stat = lstatSync(path, { bigint: true }); return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error }
}
export function configState(directory: string) {
  const text = readSshText(directory, 'config', 256 * 1024) ?? ''
  return { text, revision: hash(JSON.stringify([text, metadata(join(directory, 'config'))])) }
}
export function writeConfig(directory: string, text: string, expectedRevision: string): string | undefined {
  checkDirectory(directory, true)
  const lock = join(directory, '.devcommand-config.lock')
  let lockFd: number | undefined
  let temp: string | undefined
  try {
    lockFd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    const previous = configState(directory)
    if (previous.revision !== expectedRevision) throw new PublicError('SSH config changed. Refresh and review the edit again.')
    const config = join(directory, 'config'), exists = metadata(config) !== 'missing'
    const backup = exists ? join(directory, `config.devcommand-backup-${Date.now()}-${randomUUID()}`) : undefined
    if (backup) writeFileSync(backup, previous.text, { flag: 'wx', mode: 0o600 })
    temp = join(directory, `.config-${randomUUID()}.tmp`)
    writeFileSync(temp, text, { flag: 'wx', mode: 0o600 })
    if (configState(directory).revision !== expectedRevision) throw new PublicError('SSH config changed during backup. No edit was applied.')
    if (exists) renameSync(temp, config)
    else { linkSync(temp, config); unlinkSync(temp) }
    temp = undefined
    return backup
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PublicError('Another SSH config operation is active or the file was created externally. Refresh before retrying.')
    throw error
  } finally {
    if (temp) try { unlinkSync(temp) } catch { /* Own temporary file already removed. */ }
    if (lockFd !== undefined) { closeSync(lockFd); try { unlinkSync(lock) } catch { /* Keep unrelated files intact. */ } }
  }
}
