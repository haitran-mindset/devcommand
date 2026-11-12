import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hasControlCharacters } from '../../../shared/text'
import { PublicError } from '../../security/errors'

export function fileOperation(root: string, commandId: string, params: Record<string, string>) {
  const base = realpathSync(root)
  const fingerprints: string[] = []
  function inspect(input: string, mustExist: boolean, directory = false): string {
    if (!input || isAbsolute(input) || input.includes('\\') || /^[A-Za-z]:/.test(input) || hasControlCharacters(input) || input.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new PublicError('Use a relative path inside the repository, without traversal, symbolic links or .git metadata.')
    const target = resolve(base, input)
    const parts = relative(base, target).split(sep)
    let current = base
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index])
      const last = index === parts.length - 1
      let stat: ReturnType<typeof lstatSync>
      try { stat = lstatSync(current) }
      catch (error) {
        if (last && !mustExist && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          fingerprints.push(current + ':missing')
          const parent = lstatSync(resolve(current, '..'), { bigint: true })
          fingerprints.push([parent.dev, parent.ino, parent.mode, parent.mtimeNs, parent.ctimeNs].map(String).join(':'))
          return target
        }
        throw new PublicError('The path or its parent directory is unavailable. Create parent directories first.')
      }
      if (stat.isSymbolicLink()) throw new PublicError('Symbolic links are not supported for file operations.')
      if (!last && !stat.isDirectory()) throw new PublicError('Every parent must be an existing directory.')
      if (last) {
        if (!mustExist) throw new PublicError('The destination already exists. Choose a new path; overwriting is unavailable.')
        if (directory ? !stat.isDirectory() : !stat.isFile()) throw new PublicError(directory ? 'Choose a directory.' : 'Choose a regular file.')
        if (stat.isFile() && stat.nlink > 1) throw new PublicError('Hard-linked files are not supported for file operations.')
      }
      const precise = lstatSync(current, { bigint: true })
      fingerprints.push([current, precise.dev, precise.ino, precise.mode, precise.size, precise.mtimeNs, precise.ctimeNs].map(String).join(':'))
    }
    return target
  }
  let argv: string[], consequences: string[]
  switch (commandId) {
    case 'files.create':
    case 'files.mkdir': {
      const target = inspect(params.targetPath, false)
      argv = [target]
      consequences = [`Creates ${target}. Parent directories must already exist. Existing paths are refused during validation.`]
      break
    }
    case 'files.copy':
    case 'files.move':
    case 'files.rename': {
      const source = inspect(params.sourcePath, true)
      const destination = inspect(params.destinationPath, false)
      argv = ['-n', source, destination]
      consequences = [`Source: ${source}`, `Destination: ${destination}`, commandId === 'files.copy' ? 'Copies one regular file; the source stays unchanged. Existing destinations are refused during validation.' : 'Moves or renames one regular file. Existing destinations are refused during validation. Use the full destination filename.']
      break
    }
    case 'files.delete':
    case 'files.rmdir': {
      const target = inspect(params.targetPath, true, commandId === 'files.rmdir')
      argv = [target]
      consequences = [`Removes ${target}.`, commandId === 'files.delete' ? 'Permanently deletes this file without moving it to Trash. There is no automatic backup or undo.' : 'Removes this directory only if it is empty. Recursive deletion is unavailable.']
      break
    }
    default: throw new PublicError('Unsupported file operation.')
  }
  return { argv, consequences, state: JSON.stringify(fingerprints) }
}
