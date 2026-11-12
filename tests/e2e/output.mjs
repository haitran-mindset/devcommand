import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { waitForIpc } from './wait.mjs'
const root = await mkdtemp(join(tmpdir(), 'devcommand-output-style-')), bin = join(root, 'bin')
await mkdir(bin)
const git = join(bin, 'git')
const program = async (code) => writeFile(git, `#!${process.execPath}\nprocess.stdout.write('fixture stdout\\n');process.stderr.write('fixture stderr progress\\n');process.exitCode=${code};`, { mode: 0o755 })
await program(0)
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Shell Tools', exact: true }).click()
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.status === 'succeeded'))
  const success = page.locator('.execution-output[data-status=succeeded]')
  await success.waitFor()
  assert.equal(await success.locator('.output-stderr').evaluate((el) => window.getComputedStyle(el).color === window.getComputedStyle(el.parentElement).color), true, 'Successful stderr uses normal output color')
  assert.match(await success.innerText(), /fixture stderr progress/)
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await page.getByText('View output', { exact: true }).click()
  assert.equal(await page.locator('.execution-output[data-status=succeeded] .output-stderr').evaluate((el) => window.getComputedStyle(el).color === window.getComputedStyle(el.parentElement).color), true, 'History also treats successful stderr as informational')
  await program(1)
  await page.getByRole('link', { name: 'Shell Tools', exact: true }).click()
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.status === 'failed'))
  const failure = page.locator('.execution-output[data-status=failed]')
  await failure.waitFor()
  assert.equal(await failure.locator('.output-stderr').evaluate((el) => window.getComputedStyle(el).color !== window.getComputedStyle(el.parentElement).color), true, 'Failed stderr retains error styling')
  await program(0)
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('git version')
  await page.getByRole('button', { name: 'Git Version', exact: true }).click()
  await page.getByRole('heading', { name: 'Git Version', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const inline = page.locator('.inline-execution .execution-output[data-status=succeeded]')
  await inline.waitFor()
  assert.equal(await inline.locator('.output-stderr').evaluate((el) => window.getComputedStyle(el).color === window.getComputedStyle(el.parentElement).color), true, 'Command Explorer does not show successful progress as errors')
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} successful stderr remains neutral in Command Explorer, History and Process Core; failed stderr stays red; text/status preserved. Only a fake Git CLI was executed.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
