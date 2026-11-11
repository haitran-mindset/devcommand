import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// node-pty 1.1.0 prebuilt spawn-helper may arrive without its executable bit.
// Fix only dependency-owned helpers, both local builds and packaged resources.
export function preparePty(root) {
  if (process.platform === 'win32' || !existsSync(root)) return
  for (const directory of ['build/Release', 'build/Debug', ...(
    existsSync(join(root, 'prebuilds')) ? readdirSync(join(root, 'prebuilds')).map((name) => `prebuilds/${name}`) : []
  )]) {
    const helper = join(root, directory, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
const require = createRequire(import.meta.url)
preparePty(dirname(require.resolve('node-pty/package.json')))
