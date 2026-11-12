import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-shortcuts-'))
const env = { ...process.env, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await palette.getByRole('combobox', { name: 'Search command palette', exact: true }).fill('git version')
  await palette.getByRole('option', { name: 'Git Version', exact: true }).click()
  await page.getByRole('heading', { name: 'Git Version', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.preview pre')?.textContent === 'git --version')
  const trigger = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })
  await trigger.click()
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('listitem').count(), 4)
  const modifier = await page.evaluate(() => window.navigator.platform.includes('Mac') ? 'Command' : 'Control')
  for (const key of ['K', 'P', 'J', 'Enter']) await dialog.getByRole('group', { name: `${modifier} + ${key}`, exact: true }).waitFor()
  assert.equal((await dialog.innerText()).includes('⌘ / Ctrl'), false)
  assert.equal(await dialog.evaluate((node) => window.getComputedStyle(node).outlineStyle), 'none')
  await dialog.screenshot({ path: '/tmp/devcommand-keyboard-shortcuts-dark.png' })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  assert.equal(await dialog.isVisible(), true)
  assert.equal((await page.evaluate(() => window.devcommand.commands.listExecutions())).data.length, 0, 'Modal shortcuts never execute the configured command behind the dialog')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await trigger.evaluate((node) => node === document.activeElement), true)
  await trigger.click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await trigger.click()
  await page.mouse.click(5, 200)
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await waitForIpc(page, () => !document.documentElement.classList.contains('dark'))
  await trigger.click()
  await dialog.screenshot({ path: '/tmp/devcommand-keyboard-shortcuts-light.png' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650))
  await trigger.click()
  assert.equal(await dialog.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight && node.scrollWidth <= node.clientWidth
  }), true, 'Shortcuts fit the minimum app window without overflow')
  await dialog.screenshot({ path: '/tmp/devcommand-keyboard-shortcuts-small.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: redesigned shortcuts, platform keycaps, Escape/close/backdrop, restored focus, modal command isolation, dark/light themes and minimum-window layout. No commands or real SSH configuration were executed.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
