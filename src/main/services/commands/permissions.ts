import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hasControlCharacters } from '../../../shared/text'
import { PublicError } from '../../security/errors'
import type { Definition } from './registry'

export function permissionTarget(root: string, input: string, mutation = false) {
  if (!input || isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.includes('\\') || hasControlCharacters(input) || input.split('/').some((part) => part === '..' || part.toLowerCase() === '.git' || part === '')) throw new PublicError('Choose a path inside the selected repository, without traversal or .git metadata.')
  try {
    const base = realpathSync(root)
    const target = resolve(base, input)
    if (relative(base, target).startsWith('..' + sep) || isAbsolute(relative(base, target))) throw new PublicError('The target must remain inside the selected repository.')
    let current = base
    for (const part of relative(base, target).split(sep).filter(Boolean)) {
      current = join(current, part)
      if (lstatSync(current).isSymbolicLink()) throw new PublicError('Choose a direct path. Symbolic links are not supported for permissions.')
    }
    const stat = lstatSync(target, { bigint: true })
    if (!stat.isFile() && !stat.isDirectory()) throw new PublicError('Choose a regular file or directory.')
    if (mutation && stat.isFile() && stat.nlink > 1n) throw new PublicError('Permission changes to hard-linked files are not supported.')
    return { target, mode: (Number(stat.mode) & 0o7777).toString(8), owner: `${stat.uid}:${stat.gid}`, state: [target, stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':') }
  } catch (failure) {
    if (failure instanceof PublicError) throw failure
    throw new PublicError('The target does not exist or cannot be accessed. Choose an existing file or directory.')
  }
}

export function permissionArguments(definition: Definition, params: Record<string, string>, target: string): string[] {
  const mac = process.platform === 'darwin'
  switch (definition.id) {
    case 'permissions.inspect': return ['-ld', target]
    case 'permissions.chmod': return [params.mode, target]
    case 'permissions.chown': return [params.owner, target]
    case 'permissions.acl.view': return mac ? ['-lde', target] : ['--', target]
    case 'permissions.acl.add': return mac ? ['+a', `${params.principal}:${params.identity} allow ${[...params.access].map((right) => right === 'r' ? 'read' : right === 'w' ? 'write' : 'execute').join(',')}`, target] : ['-m', `${params.principal === 'user' ? 'u' : 'g'}:${params.identity}:${params.access.padEnd(3, '-').replace('rx-', 'r-x')}`, '--', target]
    case 'permissions.acl.remove': return mac ? ['-a#', params.index, target] : ['-x', `${params.principal === 'user' ? 'u' : 'g'}:${params.identity}`, '--', target]
    case 'permissions.acl.clear': return mac ? ['-N', target] : ['-b', '--', target]
    default: throw new PublicError('Unsupported permissions command.')
  }
}
