import test from 'node:test'
import assert from 'node:assert/strict'
import { URL } from 'node:url'
import { validateRelease } from '../scripts/check-release.mjs'

const metadata = version => [{ version }, { version, packages: { '': { version } } }]
test('accepts matching stable and prerelease tags', () => {
  assert.deepEqual(validateRelease('v1.2.3', ...metadata('1.2.3')), { version: '1.2.3', prerelease: false })
  assert.equal(validateRelease('v1.2.3-beta.1', ...metadata('1.2.3-beta.1')).prerelease, true)
})
test('rejects invalid versions and output injection', () => {
  for (const version of ['01.2.3', '1.2.3-beta.01', '1.2.3\nmalicious=true', '1.2', '1.2.3+build']) {
    assert.throws(() => validateRelease(`v${version}`, ...metadata(version)))
  }
})
test('rejects tag and lockfile mismatches', () => {
  assert.throws(() => validateRelease('v1.2.4', ...metadata('1.2.3')))
  assert.throws(() => validateRelease('v1.2.3', { version: '1.2.3' }, { version: '1.2.4' }))
  assert.throws(() => validateRelease('v1.2.3', { version: '1.2.3' }, { version: '1.2.3', packages: {} }))
})

test('CLI writes outputs only for valid release metadata', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { spawnSync } = await import('node:child_process')
  const { default: process } = await import('node:process')
  const directory = mkdtempSync(join(tmpdir(), 'devcommand-release-'))
  try {
    const [pkg, lock] = metadata('1.2.3')
    writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock))
    const output = join(directory, 'outputs')
    const script = fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))
    const options = { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' }
    const invalid = spawnSync(process.execPath, [script, 'v9.9.9'], options)
    assert.equal(invalid.status, 1)
    assert.equal(existsSync(output), false)
    const valid = spawnSync(process.execPath, [script, 'v1.2.3'], options)
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(readFileSync(output, 'utf8'), 'version=1.2.3\nprerelease=false\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
