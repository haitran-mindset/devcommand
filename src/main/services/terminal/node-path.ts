import { accessSync, constants, opendirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Read nvm metadata only: never source shell startup files or execute version-manager code. */
export function nvmNodePath(home: string, env: NodeJS.ProcessEnv): string | undefined {
  const root = env.NVM_DIR && isAbsolute(env.NVM_DIR) ? env.NVM_DIR : join(home, '.nvm')
  const versions: string[] = []
  let directory
  try {
    directory = opendirSync(join(root, 'versions', 'node'))
    for (let index = 0; index < 200; index++) {
      const entry = directory.readSync()
      if (!entry) break
      if (/^v\d+\.\d+\.\d+$/.test(entry.name) && entry.isDirectory()) versions.push(entry.name)
    }
  } catch { return undefined }
  finally { directory?.closeSync() }
  versions.sort((a, b) => {
    const left = a.slice(1).split('.').map(Number), right = b.slice(1).split('.').map(Number)
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
  })
  let alias = 'default'
  for (let depth = 0; depth < 8; depth++) {
    if (!/^(?:[A-Za-z0-9_.-]+|lts\/(?:[A-Za-z0-9_-]+|\*))$/.test(alias) || alias === '..') break
    try {
      const file = join(root, 'alias', alias)
      const info = statSync(file)
      if (!info.isFile() || info.size > 256) break
      alias = readFileSync(file, 'utf8').trim()
    } catch { break }
  }
  const requested = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(alias)
  const preferred = requested ? versions.filter(version => {
    const parts = version.slice(1).split('.')
    return requested.slice(1).every((value, index) => value === undefined || value === parts[index])
  }) : versions
  for (const version of preferred) {
    const bin = join(root, 'versions', 'node', version, 'bin')
    try { const node = join(bin, 'node'); accessSync(node, constants.X_OK); if (statSync(node).isFile()) return bin } catch { /* Try another installed version. */ }
  }
  return undefined
}
