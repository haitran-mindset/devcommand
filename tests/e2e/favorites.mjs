import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
const root = await mkdtemp(join(tmpdir(), 'devcommand-favorite-order-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const launch = () => electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${root}`] })
let app
try {
  app = await launch()
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.evaluate(async () => { for (const id of ['git.remote.list', 'git.status', 'ngrok.http']) { const result = await window.devcommand.library.favorite(id, true); if (!result.ok) throw new Error(result.error) } })
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.favorite-grip').length === 3)
  const order = () => page.locator('.command-items .command-item').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
  assert.deepEqual(await order(), ['Git Remotes', 'Git Changes', 'ngrok'])
  await page.getByRole('button', { name: 'Git Remotes', exact: true }).click()
  await page.getByRole('heading', { name: 'List Git Remotes', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reorder ngrok', exact: true }).dragTo(page.locator('.command-row').filter({ has: page.getByRole('button', { name: 'Git Remotes', exact: true }) }), { targetPosition: { x: 60, y: 5 } })
  await page.waitForFunction(() => document.querySelector('.command-items .command-item')?.getAttribute('aria-label') === 'ngrok')
  assert.deepEqual(await order(), ['ngrok', 'Git Remotes', 'Git Changes'])
  assert.equal(await page.getByRole('heading', { name: 'List Git Remotes', exact: true }).count(), 1, 'Dragging preserves the selected command')
  await page.getByRole('button', { name: 'Reorder ngrok', exact: true }).focus()
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction(() => document.querySelector('.command-items .command-item')?.getAttribute('aria-label') === 'Git Remotes')
  assert.deepEqual(await order(), ['Git Remotes', 'ngrok', 'Git Changes'])
  await chooseSelect(page, 'Command category', 'Git')
  await page.waitForFunction(() => document.querySelectorAll('.favorite-grip').length === 2)
  await page.getByRole('button', { name: 'Reorder Git Changes', exact: true }).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForFunction(() => document.querySelector('.command-items .command-item')?.getAttribute('aria-label') === 'Git Changes')
  await chooseSelect(page, 'Command category', 'All commands')
  await page.waitForFunction(() => document.querySelectorAll('.favorite-grip').length === 3)
  assert.deepEqual(await order(), ['Git Changes', 'Git Remotes', 'ngrok'], 'Hidden favorite survives filtered reorder')
  const malformed = await page.evaluate(async () => window.devcommand.library.moveFavorite({ sourceId: 'not-favorited', targetId: 'ngrok', placement: 'before' }))
  assert.equal(malformed.ok, false)
  await page.getByRole('button', { name: 'Commands', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.favorite-grip'))
  assert.equal(await page.locator('.command-items .command-item').first().getAttribute('aria-label'), 'Git Remotes', 'Commands retains its default order')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.dashboard-command').length === 3)
  assert.deepEqual(await page.locator('.dashboard-command strong').allTextContents(), ['Git Changes', 'Git Remotes', 'ngrok'])
  await app.close(); app = undefined
  app = await launch(); page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.favorite-grip').length === 3)
  assert.deepEqual(await order(), ['Git Changes', 'Git Remotes', 'ngrok'], 'Order survives app restart')
  await mkdir('resources/screenshots', { recursive: true })
  await page.screenshot({ path: 'resources/screenshots/favorites-reorder.png' })
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} native drag reorder, keyboard reorder, selection preservation, filtered order, invalid request rejection, Dashboard sync and restart persistence. No CLI, SSH or external service invoked.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
