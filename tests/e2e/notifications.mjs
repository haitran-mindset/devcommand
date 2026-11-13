import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-notifications-')), bin = join(root, 'bin')
await mkdir(bin)
await writeFile(join(bin, 'git'), '#!/bin/sh\necho fixture-success >&2\nexit 0\n', { mode: 0o755 })
await writeFile(join(bin, 'python3'), '#!/bin/sh\necho fixture-failure >&2\nexit 7\n', { mode: 0o755 })
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, args: [resolve('.'), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Notification center', exact: true })
  await panel.getByText('No notifications yet', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Shell Tools', exact: true }).click()
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).waitFor()
  await page.getByRole('button', { name: /^Notifications/ }).click()
  await panel.getByRole('heading', { name: 'success: Command completed', exact: true }).waitFor()
  assert.equal(await panel.locator('.is-error').count(), 0, 'stderr on success is not an error')
  await panel.getByRole('button', { name: 'Mark all notifications read', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await chooseSelect(page, 'Managed command', 'python3 --version')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('history:error', 'Fixture history warning'))
  await page.getByRole('button', { name: 'Notifications, 2 unread', exact: true }).click()
  await panel.getByText('python.version · Exit 7', { exact: true }).waitFor()
  await panel.getByRole('heading', { name: 'warning: History could not be saved', exact: true }).waitFor()
  assert.equal(await panel.locator('.notification-item').count(), 3)
  await page.screenshot({ path: '/tmp/devcommand-notifications-dark.png' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.screenshot({ path: '/tmp/devcommand-notifications-light.png' })
  await panel.getByRole('button', { name: 'Dismiss Command failed', exact: true }).click()
  assert.equal(await panel.locator('.notification-item').count(), 2)
  await panel.getByRole('button', { name: 'Clear notifications', exact: true }).click()
  await panel.getByText('No notifications yet', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.getByRole('heading', { name: 'Process Core', exact: true }).click()
  assert.equal(await panel.count(), 0, 'Outside click closes the center')
  assert.deepEqual(errors, [])
  console.log('PASS: notification results/errors/warnings, stderr success, unread/read/clear/dismiss, Escape/outside click, light/dark.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
