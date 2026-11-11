import { chooseSelect } from './select.mjs'
import assert from 'node:assert/strict'
import { waitForIpc } from './wait.mjs'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'

const profile = await mkdtemp(join(tmpdir(), 'devcommand-runtime-'))
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${profile}`], timeout: 30000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  const environment = await page.evaluate(async () => (await window.devcommand.terminal.environment()).data)
  assert.ok(environment.shells.length > 0)
  await chooseSelect(page, 'Terminal shell', environment.shells.find((shell) => shell.id === environment.defaultShellId).label)
  assert.equal(await page.evaluate(async () => (await window.devcommand.terminal.create({ shellId: '/bin/sh', cols: 80, rows: 24 })).ok), false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.terminal.create({ shellId: 'shell-0', cols: 80, rows: 24, cwd: '/' })).ok), false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.commands.execute({ commandId: 'git.version', argv: ['reset', '--hard'] })).ok), false)
  assert.equal(await page.evaluate(async () => (await window.devcommand.commands.execute({ commandId: 'shell.exec' })).ok), false)
  await page.evaluate(() => {
    window.runtimeChunks = []
    window.runtimeEvents = []
    window.devcommand.terminal.onData((event) => { window.runtimeChunks.push(event) })
    window.devcommand.commands.onExecutionEvent((event) => { window.runtimeEvents.push(event) })
  })
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').waitFor({ state: 'attached' })
  const typeCommand = async (value) => {
    await page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea').focus()
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
  }
  await typeCommand('pwd')
  await page.waitForFunction((cwd) => window.runtimeChunks.some((event) => event.data.includes(cwd)), environment.cwd)
  await typeCommand('git --version')
  await page.waitForFunction(() => /git version \d/.test(window.runtimeChunks.map((event) => event.data).join('')))
  const firstId = await page.evaluate(() => window.runtimeChunks[0].sessionId)
  await page.getByRole('button', { name: 'Hide terminal dock', exact: true }).click()
  await page.getByRole('button', { name: /Show terminal dock/ }).click()
  await typeCommand("printf 'DEVCOMMAND_%s\\n' 'HIDE_OK'")
  await page.waitForFunction(() => window.runtimeChunks.some((event) => event.data.includes('DEVCOMMAND_HIDE_OK')))
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 2)
  await typeCommand("printf 'DEVCOMMAND_%s\\n' 'SECOND_OK'")
  await page.waitForFunction(() => window.runtimeChunks.some((event) => event.data.includes('DEVCOMMAND_SECOND_OK')))
  const secondId = await page.evaluate(() => window.runtimeChunks.find((event) => event.data.includes('DEVCOMMAND_SECOND_OK')).sessionId)
  assert.notEqual(firstId, secondId)
  await typeCommand('sleep 30')
  await page.getByRole('button', { name: 'Interrupt active terminal', exact: true }).click()
  await typeCommand("printf 'DEVCOMMAND_%s\\n' 'INTERRUPT_OK'")
  await page.waitForFunction(() => window.runtimeChunks.some((event) => event.data.includes('DEVCOMMAND_INTERRUPT_OK')))
  // A background child must be gone after close; no command history is persisted by the app.
  await typeCommand("sleep 30 & printf 'CHILD_%s\\n' $!")
  await page.waitForFunction(() => /CHILD_\d+/.test(window.runtimeChunks.map((event) => event.data).join('')))
  const childPid = await page.evaluate(() => Number(window.runtimeChunks.map((event) => event.data).join('').match(/CHILD_(\d+)/)[1]))
  await page.getByRole('button', { name: 'Close terminal 2', exact: true }).click()
  await page.waitForFunction((id) => !window.runtimeChunks.slice(-1).some((event) => event.sessionId === id) || document.querySelectorAll('.terminal-tab').length === 1, secondId)
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 1)
  assert.equal(await app.evaluate((_electron, pid) => { try { process.kill(pid, 0); return true } catch { return false } }, childPid), false)
  await page.getByRole('link', { name: 'Shell Tools', exact: true }).click()
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((execution) => execution.commandId === 'git.version' && execution.status === 'succeeded'))
  await chooseSelect(page, 'Managed command', 'node --version')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((execution) => execution.commandId === 'node.version' && execution.status !== 'running'))
  const events = await page.evaluate(() => window.runtimeEvents)
  assert.ok(events.some((event) => event.type === 'output' && /git version/.test(event.data)))
  for (const id of [...new Set(events.map((event) => event.executionId))]) {
    const sequence = events.filter((event) => event.executionId === id).map((event) => event.sequence)
    assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b))
  }
  await page.getByRole('button', { name: 'Close terminal 1', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  assert.equal(await page.evaluate(async (id) => (await window.devcommand.terminal.write(id, 'pwd\r')).ok, firstId), false)
  // Verify shutdown also kills a live shell and child, rather than relying only on tab close.
  await page.getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.evaluate(() => { window.runtimeChunks = [] })
  await typeCommand("sh -c 'trap \"\" TERM; exec sleep 30' & printf 'SHUTDOWN_%s\\n' $!")
  await page.waitForFunction(() => /SHUTDOWN_\d+/.test(window.runtimeChunks.map((event) => event.data).join('')))
  const shutdownChild = await page.evaluate(() => Number(window.runtimeChunks.map((event) => event.data).join('').match(/SHUTDOWN_(\d+)/)[1]))
  await mkdir('resources/screenshots', { recursive: true })
  await page.screenshot({ path: `resources/screenshots/phase2-${executablePath ? 'packaged' : 'built'}.png` })
  assert.deepEqual(errors, [])
  await app.evaluate(({ app, BrowserWindow }) => { globalThis.setTimeout(() => { BrowserWindow.getAllWindows()[0].close(); app.quit() }, 50) })
  await app.waitForEvent('close', { timeout: 15000 })
  app = undefined
  assert.throws(() => process.kill(shutdownChild, 0))
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} PTY pwd/git, tabs, hide/show continuity, Ctrl+C, child cleanup, shutdown, managed streaming and IPC allowlist.`)
} finally {
  await app?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true })
}
