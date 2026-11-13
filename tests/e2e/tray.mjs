import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright'
const root = await mkdtemp(join(tmpdir(), 'devcommand-tray-'))
const env = { ...process.env, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, args: ['-r', resolve('tests/e2e/tray-harness.cjs'), resolve('.'), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  assert.deepEqual(await app.evaluate(() => globalThis.devcommandTrayMenu.items.filter(item => item.id).map(item => item.label)), ['Open DevCommand', 'Quick Terminal', 'Quit'])
  await page.getByRole('button', { name: 'Close window', exact: true }).click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  await app.evaluate(() => globalThis.devcommandTrayMenu.getMenuItemById('open-devcommand').click())
  await page.waitForFunction(() => !document.hidden)
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true)
  await page.evaluate(() => { window.trayOutput = ''; window.devcommand.terminal.onData(event => { window.trayOutput += event.data }) })
  await app.evaluate(() => globalThis.devcommandTrayMenu.getMenuItemById('quick-terminal').click())
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 1)
  const input = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await input.focus(); await page.keyboard.type("printf 'TRAY_FIRST_OK\\n'"); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.trayOutput.includes('TRAY_FIRST_OK'))
  await page.getByRole('button', { name: 'Hide terminal dock', exact: true }).click()
  await page.getByRole('button', { name: 'Close window', exact: true }).click()
  await app.evaluate(() => globalThis.devcommandTrayMenu.getMenuItemById('quick-terminal').click())
  await page.waitForFunction(() => !document.hidden && document.querySelectorAll('.terminal-tab').length === 2)
  await input.waitFor({ state: 'attached' })
  await input.focus(); await page.keyboard.type("printf 'TRAY_SECOND_OK\\n'"); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.trayOutput.includes('TRAY_SECOND_OK'))
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  assert.equal(await page.evaluate(async () => (await window.devcommand.commands.listExecutions()).data.length), 0, 'Quick Terminal does not execute a managed command')
  assert.equal(await page.evaluate(async () => (await window.devcommand.tray.takeQuickTerminal()).data), false, 'Intent is consumed once')
  await page.screenshot({ path: '/tmp/devcommand-tray-quick-terminal.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: Tray labels, close/open lifecycle, Quick Terminal restores hidden dock/window and adds usable interactive tabs without replacing existing sessions or auto-running commands.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
