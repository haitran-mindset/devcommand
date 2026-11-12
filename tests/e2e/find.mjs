import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const root = await realpath(await mkdtemp(join(tmpdir(), 'devcommand-find-defaults-')))
const bin = join(root, 'bin'), repo = join(root, 'fixture repo')
await mkdir(bin); await mkdir(repo)
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
await writeFile(join(bin, 'find'), '#!/bin/sh\nprintf "ARG:<%s>\\n" "$@"\n', { mode: 0o755 })
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  const openFind = async () => {
    await chooseSelect(page, 'Command category', 'System')
    await page.getByRole('button', { name: 'Find', exact: true }).click()
    await page.getByRole('heading', { name: 'Find by Name', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Search directory', { exact: true }).inputValue(), '/')
    assert.ok((await page.getByRole('combobox', { name: 'Maximum depth', exact: true }).innerText()).includes('No limit'))
  }
  await openFind()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, repo)
  await page.getByRole('link', { name: 'Repositories', exact: true }).click()
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('heading', { name: 'fixture repo', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await openFind()
  await page.waitForFunction(() => {
    const preview = document.querySelector('.preview pre')?.textContent ?? ''
    return preview.startsWith('find -P / ') && !preview.includes('-maxdepth')
  })
  const run = async () => {
    const previous = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.map((entry) => entry.id)
    await page.getByRole('button', { name: 'Run Command', exact: true }).click()
    await waitForIpc(page, async (previous) => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === 'find.name' && !previous.includes(entry.id) && !!entry.finishedAt), previous)
    const entry = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.find((entry) => entry.commandId === 'find.name' && !previous.includes(entry.id))
    assert.equal(entry.status, 'succeeded')
    return entry.output.map((chunk) => chunk.data).join('')
  }
  const global = await run()
  assert.ok(global.includes('ARG:</>'))
  assert.ok(!global.includes('ARG:<-maxdepth>'))
  await chooseSelect(page, 'Maximum depth', '3')
  await page.waitForFunction(() => document.querySelector('.preview pre')?.textContent.includes('-maxdepth 3'))
  assert.ok((await run()).includes('ARG:<-maxdepth>\nARG:<3>'))
  await chooseSelect(page, 'Maximum depth', 'No limit')
  await page.getByLabel('Search directory', { exact: true }).fill('.')
  await page.waitForFunction((path) => document.querySelector('.preview pre')?.textContent.includes(path), repo)
  assert.ok((await run()).includes(`ARG:<${repo}>`))
  assert.deepEqual(errors, [])
  console.log('PASS: Find defaults to / and no depth limit with or without a selected repository; numeric depth and relative directory still work. Only a fake find executable ran; no whole-machine search or real SSH configuration used.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
