import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const root = await realpath(await mkdtemp(join(tmpdir(), 'devcommand-compare-')))
const left = join(root, 'first file.txt'), right = join(root, '-second file.txt')
await writeFile(left, 'hello world\n'); await writeFile(right, 'HELLO WORLD\n')
const env = { ...process.env, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await chooseSelect(page, 'Command category', 'System')
  await page.getByRole('button', { name: 'File Comparison', exact: true }).click()
  await page.getByRole('heading', { name: 'Compare Files', exact: true }).waitFor()
  for (const name of ['Choose first file', 'Choose second file']) {
    const button = page.getByRole('button', { name, exact: true })
    assert.equal((await button.textContent()).trim(), '', 'Picker is icon-only')
    assert.equal(await button.getAttribute('title'), name, 'Icon retains a tooltip')
  }
  const setPickerResult = async (path) => app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async (_window, options) => {
      if (options.title !== 'Choose comparison file' || options.properties.join(',') !== 'openFile') throw new Error('Unexpected picker options')
      return { canceled: path === null, filePaths: path === null ? [] : [path] }
    }
  }, path)
  const rejectedPicker = await page.evaluate(() => window.devcommand.library.chooseComparisonFile({ defaultPath: '/unexpected' }))
  assert.equal(rejectedPicker.ok, false, 'Unexpected picker options are rejected by IPC')
  const initialLeft = await page.getByLabel('First file', { exact: true }).inputValue()
  await setPickerResult(null)
  await page.getByRole('button', { name: 'Choose first file', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Choose first file"]').disabled)
  assert.equal(await page.getByLabel('First file', { exact: true }).inputValue(), initialLeft, 'Cancel preserves the existing input')
  await setPickerResult(left)
  await page.getByRole('button', { name: 'Choose first file', exact: true }).click()
  await page.waitForFunction((path) => document.querySelector('[aria-label="First file"]').value === path, left)
  await setPickerResult(root)
  await page.getByRole('button', { name: 'Choose second file', exact: true }).click()
  await page.getByRole('tabpanel', { name: 'Configure', exact: true }).getByText('Choose an existing regular file with a supported path.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Second file', { exact: true }).inputValue(), 'after.txt', 'Directory selection is refused without replacing the value')
  await setPickerResult(right)
  await page.getByRole('button', { name: 'Choose second file', exact: true }).click()
  await page.waitForFunction((path) => document.querySelector('[aria-label="Second file"]').value === path, right)
  await page.getByLabel('Second file', { exact: true }).fill(right)

  const run = async (action, commandId, exitCode) => {
    await chooseSelect(page, 'Action', action)
    assert.equal(await page.getByLabel('First file', { exact: true }).inputValue(), left)
    assert.equal(await page.getByLabel('Second file', { exact: true }).inputValue(), right)
    const previous = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.map((entry) => entry.id)
    await page.getByRole('button', { name: 'Run Command', exact: true }).click()
    await waitForIpc(page, async ({ previous, commandId }) => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === commandId && !previous.includes(entry.id) && !!entry.finishedAt), { previous, commandId })
    const execution = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.find((entry) => entry.commandId === commandId && !previous.includes(entry.id))
    assert.equal(execution.status, 'succeeded')
    assert.equal(execution.exitCode, exitCode)
    assert.equal(await page.getByRole('dialog').count(), 0, 'Read-only comparisons need no mutation confirmation')
    return execution
  }
  const diff = await run('Unified diff', 'compare.unified', 1)
  assert.ok(diff.output.map((entry) => entry.data).join('').includes('+HELLO WORLD'))
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await page.getByText('Command copied.', { exact: true }).waitFor()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.ok(copied.startsWith('diff -u ')); assert.ok(copied.includes("'" + await realpath(left) + "'"))
  await run('Quick check', 'compare.brief', 1)
  await run('Ignore case', 'compare.case', 0)
  await writeFile(right, 'hello   world\n')
  await run('Ignore whitespace', 'compare.whitespace', 0)
  await writeFile(left, Buffer.from([0, 1, 2])); await writeFile(right, Buffer.from([0, 1, 3]))
  await run('Byte comparison', 'compare.bytes', 1)
  await writeFile(right, Buffer.from([0, 1, 2]))
  await run('Byte comparison', 'compare.bytes', 0)
  assert.deepEqual(await readFile(left), Buffer.from([0, 1, 2]))
  const catalog = await page.evaluate(() => window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: false }))
  assert.equal(catalog.data.some((entry) => entry.id === 'dart.version'), false)
  // Inject only a history response fixture to check removed-command UI behavior.
  const historyFixture = [
    { request: { commandId: 'dart.version', params: {} }, execution: { ...diff, id: 'removed-fixture', commandId: 'dart.version', preview: 'dart --version' }, rerunnable: false, commandAvailable: false },
    { request: { commandId: 'compare.unified', params: { leftFile: left, rightFile: right } }, execution: { ...diff, id: 'retained-fixture' }, rerunnable: false, commandAvailable: true }
  ]
  await app.evaluate(({ ipcMain }, entries) => {
    ipcMain.removeHandler('library:history')
    ipcMain.handle('library:history', () => ({ ok: true, data: entries }))
  }, historyFixture)
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByRole('heading', { name: 'Execution History', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Command removed', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Re-enter parameters', exact: true }).isEnabled(), true)
  assert.deepEqual(errors, [])
  console.log('PASS: five grouped File Comparison actions, equal/different status, native file picker/cancel/validation, Copy, retained inputs and removed Dart Version. Temporary fixture files only; no real files or SSH configuration changed.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
