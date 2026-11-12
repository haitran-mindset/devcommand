import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-extended-e2e-'))
const bin = join(root, 'bin'), sshdir = join(root, '.ssh')
await mkdir(bin)
await mkdir(sshdir, { mode: 0o700 })
await writeFile(join(sshdir, 'id_fixture'), 'NOT A REAL PRIVATE KEY', { mode: 0o600 })
await writeFile(join(sshdir, 'id_fixture.pub'), 'ssh-ed25519 AAAA fixture\n')
await writeFile(join(sshdir, 'config'), 'Host fixture\n  HostName github.com\n  User git\n  Port 2222\n  IdentityFile ~/.ssh/id_fixture\n  IdentitiesOnly yes\n', { mode: 0o600 })
await writeFile(join(bin, 'ssh-keygen'), '#!/bin/sh\nprintf "256 SHA256:FixtureFingerprint fixture (ED25519)\\n"\n', { mode: 0o755 })
await writeFile(join(bin, 'ssh-add'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
const env = { ...process.env, DEVCOMMAND_TEST_ROOT: root, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock'), PATH: `${bin}:/usr/bin:/bin` }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, args: ['-r', resolve('tests/e2e/ssh-harness.cjs'), resolve('.'), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow()
  assert.equal(await app.evaluate(() => process.getBuiltinModule('os').homedir()), root)
  // Mock clipboard transport; neither the real clipboard nor any real SSH service is changed.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('clipboard:write-text')
    ipcMain.handle('clipboard:write-text', (_event, text) => ({ ok: text === 'ssh-ed25519 AAAA fixture', data: null }))
  })
  await page.getByRole('link', { name: 'SSH Manager', exact: true }).click()
  await page.getByRole('heading', { name: 'Generate SSH key', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Test connection', exact: true }).click()
  const connection = page.getByRole('dialog', { name: 'Review connection.test', exact: true })
  await connection.locator('pre').first().waitFor()
  const shortCommand = await connection.locator('pre').first().innerText()
  assert.match(shortCommand, /ssh -T -p 2222 -l git -i /)
  assert.match(shortCommand, /github.com$/)
  assert.equal(shortCommand.includes('StrictHostKeyChecking'), false)
  const fullCommand = connection.locator('details pre')
  assert.equal(await fullCommand.isVisible(), false)
  await connection.getByText('Managed execution options', { exact: true }).click()
  assert.match(await fullCommand.innerText(), /StrictHostKeyChecking=yes/)
  await connection.screenshot({ path: '/tmp/devcommand-ssh-connection-preview.png' })
  await connection.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Copy public key', exact: true }).click()
  await page.locator('.toast').getByText('Public key copied.', { exact: true }).waitFor()
  assert.equal(await page.locator('.ssh-feedback').filter({ hasText: 'Public key copied.' }).count(), 0)
  await chooseSelect(page, 'Key type', 'RSA · 4096-bit')
  assert.equal(await page.getByLabel('Key basename', { exact: true }).inputValue(), 'id_rsa_devcommand')
  await page.getByLabel('Key basename', { exact: true }).fill('id_custom')
  await chooseSelect(page, 'Key type', 'Ed25519')
  assert.equal(await page.getByLabel('Key basename', { exact: true }).inputValue(), 'id_custom')
  await chooseSelect(page, 'Key type', 'RSA · 4096-bit')
  await page.getByRole('button', { name: 'Review key generation', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review key.generate', exact: true })
  await review.getByText('Creates a new RSA 4096-bit key pair', { exact: false }).waitFor()
  assert.match(await review.locator('pre').innerText(), /ssh-keygen -t rsa -b 4096/)
  await review.getByRole('button', { name: 'Close', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 950))
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('.ssh-tools')).gridTemplateColumns.split(' ').length === 2)
  await page.locator('.ssh-tools').screenshot({ path: '/tmp/devcommand-ssh-forms-wide.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760))
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('.ssh-tools')).gridTemplateColumns.split(' ').length === 1)
  assert.deepEqual((await readdir(sshdir)).sort(), ['config', 'id_fixture', 'id_fixture.pub'])
  console.log('PASS: concise SSH confirmation with expandable full options, copy toast, RSA preview, editable key name, two-column/wrapped forms. No keys generated, host edits, real agent or clipboard changes.')
} finally {
  await app?.close()
  await rm(root, { recursive: true, force: true })
}
