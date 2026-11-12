import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
const root = await mkdtemp(join(tmpdir(), 'devcommand-zsh-'))
const zdir = join(root, 'zsh config with spaces'), marker = join(zdir, 'startup-marker')
await mkdir(zdir)
const config = `print -r -- FIXTURE_ZSH_RC\nprint -r -- loaded > '${marker}'\nPROMPT='fixture%# '\n`
await writeFile(join(zdir, '.zshrc'), config)
const env = { ...process.env, ZDOTDIR: zdir, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await chooseSelect(page, 'Command category', 'System')
  await page.getByRole('button', { name: 'Zsh', exact: true }).click()
  await page.getByRole('heading', { name: 'Open Zsh', exact: true }).waitFor()
  const input = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await page.evaluate(() => { window.zshOutput = []; window.devcommand.terminal.onData((event) => window.zshOutput.push(event.data)) })
  // Source only the fixture file, and verify state survives in the same shell.
  await writeFile(join(zdir, '.zshrc'), config + "export DEVCOMMAND_SOURCE_VALUE=fixture_loaded\nalias dc_source_alias='print -r -- ALIAS_RELOADED'\n")
  await page.evaluate(() => { window.zshOutput = [] })
  await chooseSelect(page, 'Action', 'Reload .zshrc')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const sourceDialog = page.getByRole('dialog', { name: 'Confirm Reload .zshrc', exact: true })
  await sourceDialog.waitFor()
  assert.equal(await page.locator('.terminal-tab').count(), 0, 'Preview does not start a shell')
  await sourceDialog.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => window.zshOutput.join('').includes('FIXTURE_ZSH_RC') && /fixture[%#] /.test(window.zshOutput.join('')))
  await input.focus()
  await page.keyboard.type("printf 'SOURCE_VALUE=%s\\n' \"$DEVCOMMAND_SOURCE_VALUE\"; dc_source_alias")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.zshOutput.join('').includes('SOURCE_VALUE=fixture_loaded') && window.zshOutput.join('').includes('ALIAS_RELOADED'))
  assert.equal(await page.locator('.terminal-tab').count(), 1)
  assert.equal((await page.evaluate(() => window.zshOutput.join(''))).split('FIXTURE_ZSH_RC').length - 1, 1, '.zshrc is sourced once')
  await page.getByRole('button', { name: 'Close all terminal sessions', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  assert.deepEqual(errors, [])
  console.log('PASS: Reload .zshrc confirmation, source once and alias/environment persistence in an interactive tab. Temporary ZDOTDIR only; no real shell or SSH configuration used.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
