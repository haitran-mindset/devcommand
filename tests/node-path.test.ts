import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { nvmNodePath } from '../src/main/services/terminal/node-path'
import { childEnvironment } from '../src/main/services/terminal/environment'
import { findExecutable } from '../src/main/services/cli/probe'
const roots: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'devcommand-node-path-')); roots.push(home)
  const root = join(home, '.nvm')
  for (const version of ['v22.1.0', 'v24.2.0']) {
    mkdirSync(join(root, 'versions', 'node', version, 'bin'), { recursive: true })
    writeFileSync(join(root, 'versions', 'node', version, 'bin', 'node'), '#!/bin/sh\necho NODE_FIXTURE\n', { mode: 0o755 })
    writeFileSync(join(root, 'versions', 'node', version, 'bin', 'npm'), '#!/usr/bin/env node\n', { mode: 0o755 })
  }
  mkdirSync(join(root, 'alias', 'lts'), { recursive: true })
  return { home, root }
}
it('resolves nvm default aliases without executing any shell configuration', () => {
  const { home, root } = fixture()
  writeFileSync(join(root, 'alias', 'default'), 'lts/example\n')
  writeFileSync(join(root, 'alias', 'lts', 'example'), '22\n')
  expect(nvmNodePath(home, {})).toBe(join(root, 'versions', 'node', 'v22.1.0', 'bin'))
  writeFileSync(join(root, 'alias', 'default'), '24.2.0\n')
  expect(nvmNodePath(home, {})).toBe(join(root, 'versions', 'node', 'v24.2.0', 'bin'))
})
it('supports custom NVM_DIR and newest installed fallback; rejects alias traversal', () => {
  const { home, root } = fixture()
  expect(nvmNodePath('/unused', { NVM_DIR: root })).toBe(join(root, 'versions', 'node', 'v24.2.0', 'bin'))
  writeFileSync(join(root, 'alias', 'default'), '../../outside\n')
  expect(nvmNodePath(home, {})).toBe(join(root, 'versions', 'node', 'v24.2.0', 'bin'))
  expect(nvmNodePath(join(home, 'missing'), {})).toBeUndefined()
})
it('adds both npm lookup and its env-node interpreter to Finder-style child PATH without changing SSH env', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'alias', 'default'), '22\n')
  vi.stubEnv('NVM_DIR', root); vi.stubEnv('PATH', '/usr/bin:/bin'); vi.stubEnv('SSH_AUTH_SOCK', '/fixture/agent.sock')
  const env = childEnvironment(), bin = join(root, 'versions', 'node', 'v22.1.0', 'bin')
  expect(env.PATH!.split(':')).toContain(bin)
  expect(findExecutable('npm')).toBeDefined()
  expect(env.SSH_AUTH_SOCK).toBe('/fixture/agent.sock')
  expect(process.env.PATH).toBe('/usr/bin:/bin')
})
