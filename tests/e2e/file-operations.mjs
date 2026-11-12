import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-files-')), repo = join(root, 'fixture repo')
await mkdir(repo)
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
await writeFile(join(repo, 'source.txt'), 'fixture contents')
const env = { ...process.env, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, repo)
  await page.getByRole('link', { name: 'Repositories', exact: true }).click()
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('heading', { name: 'fixture repo', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await chooseSelect(page, 'Command category', 'System')
  await page.getByRole('button', { name: 'File Operations', exact: true }).click()
  const run = async (action, title, commandId, fields, before) => {
    await chooseSelect(page, 'Action', action)
    for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByRole('button', { name: 'Run Command', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm ' + title, exact: true })
    await dialog.waitFor()
    await before?.()
    await dialog.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
    await waitForIpc(page, async (commandId) => (await window.devcommand.library.history()).data.some((entry) => entry.request.commandId === commandId && entry.execution.status === 'succeeded'), commandId)
  }
  await run('Create file', 'Create File', 'files.create', { 'Path inside repository': 'new file.txt' }, () => assert.rejects(access(join(repo, 'new file.txt'))))
  assert.equal(await readFile(join(repo, 'new file.txt'), 'utf8'), '')
  await run('Create directory', 'Create Directory', 'files.mkdir', { 'Directory path inside repository': 'new folder' })
  await run('Copy file', 'Copy File', 'files.copy', { 'Source file': 'source.txt', 'Destination file (full path)': 'new folder/copied.txt' })
  assert.equal(await readFile(join(repo, 'new folder/copied.txt'), 'utf8'), 'fixture contents')
  await run('Move file', 'Move File', 'files.move', { 'Source file': 'new folder/copied.txt', 'Destination file (full path)': 'moved.txt' })
  await assert.rejects(access(join(repo, 'new folder/copied.txt')))
  await run('Rename file', 'Rename File', 'files.rename', { 'Source file': 'moved.txt', 'Destination file (full path)': 'renamed.txt' })
  await chooseSelect(page, 'Action', 'Delete file')
  await page.getByLabel('Path inside repository', { exact: true }).fill('renamed.txt')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Delete File', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await readFile(join(repo, 'renamed.txt'), 'utf8'), 'fixture contents', 'Cancel never deletes a file')
  await run('Delete file', 'Delete File', 'files.delete', { 'Path inside repository': 'renamed.txt' }, () => access(join(repo, 'renamed.txt')))
  await assert.rejects(access(join(repo, 'renamed.txt')))
  await run('Remove empty directory', 'Remove Empty Directory', 'files.rmdir', { 'Directory path inside repository': 'new folder' })
  await assert.rejects(access(join(repo, 'new folder')))
  assert.equal(await readFile(join(repo, 'source.txt'), 'utf8'), 'fixture contents')
  assert.deepEqual(errors, [])
  console.log('PASS: File Operations grouped UI, seven confirmed actions, cancellation and actual file results. Only an isolated temporary repository was changed; no real files or SSH configuration used.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
