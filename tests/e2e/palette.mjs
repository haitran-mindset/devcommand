import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { setTimeout as delay } from 'node:timers/promises'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-palette-'))
const env = { ...process.env, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`, ...(process.env.DEVCOMMAND_PALETTE_REVIEW ? ['--remote-debugging-port=19222'] : [])] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  const input = palette.getByRole('combobox', { name: 'Search command palette', exact: true })
  const open = async () => { await page.keyboard.press(shortcut); await palette.waitFor(); await palette.getByRole('option').first().waitFor() }
  await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
  await palette.getByRole('option').first().waitFor()
  assert.equal(await input.evaluate((node) => node === document.activeElement), true)
  const initial = await input.getAttribute('aria-activedescendant')
  await input.press('ArrowDown')
  assert.notEqual(await input.getAttribute('aria-activedescendant'), initial)
  assert.equal(await input.evaluate((node) => node === document.activeElement), true, 'Arrow navigation keeps search focus')
  await input.press('Home')
  assert.equal(await input.getAttribute('aria-activedescendant'), initial)
  await input.press('End')
  assert.equal(await palette.locator('[aria-selected="true"]').evaluate((node) => {
    const item = node.getBoundingClientRect(), list = node.closest('[role=listbox]').getBoundingClientRect()
    return item.top >= list.top - 1 && item.bottom <= list.bottom + 1
  }), true, 'Selected result scrolls into view')
  await input.press('Home')
  await palette.screenshot({ path: '/tmp/devcommand-command-palette-dark.png' })
  await input.press('Escape')
  await palette.waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: 'Open command palette', exact: true }).evaluate((node) => node === document.activeElement), true, 'Escape restores opener focus')
  await open()
  await input.fill('list git remotes')
  await palette.getByRole('option', { name: 'List Git Remotes', exact: true }).waitFor()
  await input.press('Enter')
  await page.getByRole('heading', { name: 'List Git Remotes', exact: true }).waitFor()
  await palette.waitFor({ state: 'detached' })
  assert.equal((await page.evaluate(() => window.devcommand.commands.listExecutions())).data.length, 0, 'Selecting only opens configuration')
  await open()
  await input.fill('palette-no-match-86213')
  await palette.getByRole('heading', { name: 'No matching commands', exact: true }).waitFor()
  await input.press('Enter')
  assert.equal(await palette.isVisible(), true)
  await palette.screenshot({ path: '/tmp/devcommand-command-palette-empty.png' })
  await palette.locator('.palette-state').getByRole('button', { name: 'Clear search', exact: true }).click()
  await palette.getByRole('option').first().waitFor()
  assert.equal(await input.inputValue(), '')
  await input.fill('git remote')
  await palette.getByRole('option', { name: 'List Git Remotes', exact: true }).waitFor()
  await palette.getByRole('option', { name: 'List Git Remotes', exact: true }).click()
  await palette.waitFor({ state: 'detached' })
  await open()
  await page.mouse.click(5, 200)
  await palette.waitFor({ state: 'detached' })
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await waitForIpc(page, () => !document.documentElement.classList.contains('dark'))
  await open()
  await palette.screenshot({ path: '/tmp/devcommand-command-palette-light.png' })
  await input.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650))
  await open()
  assert.equal(await palette.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && node.scrollWidth <= node.clientWidth
  }), true, 'Palette fits minimum window size without horizontal overflow')
  await palette.screenshot({ path: '/tmp/devcommand-command-palette-small.png' })
  await input.press('Escape')
  const catalog = (await page.evaluate(() => window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: false }))).data
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('library:search')
    ipcMain.handle('library:search', () => ({ ok: false, error: 'Fixture library unavailable' }))
  })
  await page.keyboard.press(shortcut)
  await input.fill('palette-backend-error-fixture')
  await palette.getByRole('heading', { name: 'Unable to load commands', exact: true }).waitFor()
  await app.evaluate(({ ipcMain }, catalog) => {
    ipcMain.removeHandler('library:search')
    ipcMain.handle('library:search', () => ({ ok: true, data: catalog }))
  }, catalog)
  await palette.getByRole('button', { name: 'Try again', exact: true }).click()
  await palette.getByRole('option').first().waitFor()
  assert.deepEqual(errors, [])
  if (process.env.DEVCOMMAND_PALETTE_REVIEW) {
    console.log('Palette visual review ready on CDP 19222 for 60 seconds.')
    await delay(60000)
  }
  console.log('PASS: compact palette, keyboard/pointer selection, focus restoration, empty/error recovery, dark/light themes and minimum window sizing. No commands or real SSH configuration were executed.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
