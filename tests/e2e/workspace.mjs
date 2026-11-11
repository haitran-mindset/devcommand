import assert from 'node:assert/strict'
import { waitForIpc } from './wait.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'

const root = await mkdtemp(join(tmpdir(), 'devcommand-workspace-e2e-'))
const repo = join(root, 'repo with 日本語')
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
await writeFile(join(repo, 'tracked.txt'), 'initial\n'); git(['add', '.']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture'])
git(['remote', 'add', 'origin', 'git@github.com:example/old.git'])
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const options = { env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`], timeout: 30000 }
let app
try {
  app = await electron.launch(options)
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Stub only the OS picker result in privileged test code; the renderer still uses its real narrow API.
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, repo)
  await page.getByRole('link', { name: 'Repositories', exact: true }).click()
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('heading', { name: 'repo with 日本語', exact: true }).waitFor()
  const workspaceId = await page.evaluate(async () => (await window.devcommand.workspace.list()).data.selectedId)
  assert.equal((await page.evaluate(async (id) => (await window.devcommand.workspace.status(id)).data, workspaceId)).branch, 'main')
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.getByLabel('New Remote URL', { exact: true }).fill('git@github.com:example/new.git')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Confirm Change Git Remote URL' })
  await confirmation.waitFor()
  assert.equal(git(['remote', 'get-url', 'origin']), 'git@github.com:example/old.git')
  await confirmation.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.library.history()).data.some((entry) => entry.request.commandId === 'git.remote.set-url' && entry.execution.status === 'succeeded'))
  const completed = await page.evaluate(async () => (await window.devcommand.library.history()).data.map((entry) => ({ params: entry.request.params, preview: entry.execution.preview, status: entry.execution.status, output: entry.execution.output })))
  assert.equal(git(['remote', 'get-url', 'origin']), 'git@github.com:example/new.git', JSON.stringify(completed))
  await page.getByRole('button', { name: 'Favorite command', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.library.search({ query: 'change remote', favoritesOnly: true, category: 'all', risk: 'all', platform: 'all' })).data.length === 1)
  // Insertion creates a repository shell and a safe draft; no Enter is sent.
  await page.getByLabel('New Remote URL', { exact: true }).fill('git@github.com:example/draft.git')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('draft.git'))
  const draftText = await page.locator('.terminal-view:not([hidden]) .xterm-accessibility-tree').innerText()
  assert.match(draftText, /git remote set-url -- origin/ )
  assert.equal(draftText.includes('--literal-pathspecs'), false, 'Inserted draft uses the concise command')
  assert.equal(draftText.includes('core.hooksPath='), false)
  assert.equal(git(['remote', 'get-url', 'origin']), 'git@github.com:example/new.git')
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus()
  await page.keyboard.press('Enter')
  await waitForIpc(page, async (id) => (await window.devcommand.workspace.status(id)).data.remotes.some((remote) => remote.fetchUrl.endsWith('/draft.git')), workspaceId)
  assert.equal(git(['remote', 'get-url', 'origin']), 'git@github.com:example/draft.git')
  // Rerun goes through a fresh preview and confirmation, rather than executing saved argv.
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Review & rerun', exact: true }).first().click()
  await page.getByLabel('New Remote URL', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('New Remote URL', { exact: true }).inputValue(), 'git@github.com:example/new.git')
  const unsafe = await page.evaluate(async (workspaceId) => window.devcommand.library.execute({ commandId: 'git.reset.hard', params: { ref: 'HEAD' }, workspaceId }), workspaceId)
  assert.equal(unsafe.ok, false)
  await mkdir('resources/screenshots', { recursive: true })
  await page.screenshot({ path: `resources/screenshots/phase3-${executablePath ? 'packaged' : 'built'}.png` })
  await app.close()
  app = await electron.launch(options)
  page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  const persisted = await page.evaluate(async () => ({ workspaces: (await window.devcommand.workspace.list()).data, favorites: (await window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: true })).data, history: (await window.devcommand.library.history()).data }))
  assert.equal(persisted.workspaces.selectedId, workspaceId)
  assert.ok(persisted.favorites.some((entry) => entry.id === 'git.remote.set-url'))
  assert.ok(persisted.history.some((entry) => entry.execution.status === 'succeeded'))
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} native-picker IPC, repository context, remote URL confirmation/run, favorites/history persistence, safe terminal insert without Enter and rerun revalidation.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
