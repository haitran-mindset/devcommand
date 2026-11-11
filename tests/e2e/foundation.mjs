import assert from 'node:assert/strict'
import { waitForIpc } from './wait.mjs'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'

const profile = await mkdtemp(join(tmpdir(), 'devcommand-e2e-'))
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const entryArgs = executablePath ? [] : [resolve('.')]
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const launchOptions = { env: launchEnv, ...(executablePath ? { executablePath } : {}), args: [...entryArgs, `--user-data-dir=${profile}`], timeout: 30000 }
let app
try {
  app = await electron.launch(launchOptions)
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined')
  assert.deepEqual(await page.evaluate(() => Object.keys(window.devcommand).sort()), ['commands', 'docker', 'git', 'library', 'settings', 'ssh', 'terminal', 'window', 'workspace'])
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.settings.update({ theme: 'invalid' })).ok), false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.settings.update({ arbitrary: 'shell' })).ok), false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.window.control('invalid')).ok), false)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
  await page.getByRole('dialog', { name: 'Command palette' }).getByRole('button', { name: /Change Git Remote URL/ }).click()
  await page.getByRole('textbox', { name: 'Search commands' }).fill('no-result-xyz')
  await page.getByText('No matching commands.').waitFor()
  await page.getByRole('textbox', { name: 'Search commands' }).fill('')
  await page.getByRole('tab', { name: 'Details', exact: true }).click()
  await page.getByRole('heading', { name: 'About this command' }).waitFor()
  await page.getByRole('tab', { name: 'Details', exact: true }).press('ArrowRight')
  await page.getByRole('heading', { name: 'Example', exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Configure', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.application')?.classList.contains('sidebar-collapsed'))
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show terminal dock' }).click()
  await page.getByRole('button', { name: /Show terminal dock/ }).waitFor()
  await waitForIpc(page, async () => (await window.devcommand.settings.get()).data.route === 'settings')
  await app.close()
  app = await electron.launch(launchOptions)
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  const persisted = await page.evaluate(async () => (await window.devcommand.settings.get()).data)
  assert.equal(persisted.theme, 'light')
  assert.equal(persisted.route, 'settings')
  assert.equal(persisted.sidebarCollapsed, true)
  assert.equal(persisted.terminalVisible, false)
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.application')?.classList.contains('sidebar-collapsed'))
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await page.getByRole('button', { name: /Show terminal dock/ }).click()
  await page.getByRole('region', { name: 'Integrated terminal' }).waitFor()
  await page.getByRole('separator', { name: 'Resize terminal dock' }).press('ArrowUp')
  await waitForIpc(page, async () => (await window.devcommand.settings.get()).data.terminalHeight === 220)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await page.waitForFunction(() => innerWidth === 1280)
  await mkdir('resources/screenshots', { recursive: true })
  await page.screenshot({ path: `resources/screenshots/${executablePath ? 'packaged' : 'foundation'}-dark.png` })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await page.waitForFunction(() => innerWidth === 900)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} Electron isolation, IPC validation, navigation, keyboard search, tabs, themes, sidebar, dock and restart persistence.`)
} finally {
  await app?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true })
}
