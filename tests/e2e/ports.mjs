import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout, clearTimeout } from 'node:timers'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-ports-e2e-'))
const server = spawn(process.execPath, ['-e', "const net=require('node:net');const server=net.createServer();server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));"], { stdio: ['ignore', 'pipe', 'pipe'] })
const serverExited = once(server, 'exit')
const port = String(await new Promise((resolve, reject) => { server.once('error', reject); server.stdout.once('data', (data) => resolve(data.toString().trim())) }))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app, exitTimer
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  for (const commandId of ['system.ports', 'system.port', 'system.port.process']) {
    const result = await page.evaluate(async ({ commandId, port }) => window.devcommand.library.execute({ commandId, params: commandId === 'system.ports' ? {} : { port } }), { commandId, port })
    assert.equal(result.ok, true)
    await waitForIpc(page, async (id) => (await window.devcommand.commands.listExecutions()).data.some((run) => run.id === id && !!run.finishedAt), result.data.executionId)
    const runs = await page.evaluate(async () => window.devcommand.commands.listExecutions())
    const run = runs.data.find((run) => run.id === result.data.executionId)
    assert.equal(run.status, 'succeeded')
    assert.ok(run.output.map((chunk) => chunk.data).join('').includes(String(server.pid)), `${commandId} includes the fixture listener PID`)
  }
  const unconfirmed = await page.evaluate(async (port) => window.devcommand.library.execute({ commandId: 'system.port.stop', params: { port } }), port)
  assert.equal(unconfirmed.ok, false, 'Stop always requires confirmation')
  assert.equal(server.exitCode, null)
  await chooseSelect(page, 'Command category', 'System')
  await page.getByRole('button', { name: 'Ports & Processes', exact: true }).click()
  await chooseSelect(page, 'Action', 'Inspect listening port')
  await page.getByLabel('TCP Port', { exact: true }).fill(port)
  await chooseSelect(page, 'Action', 'Stop process')
  assert.equal(await page.getByLabel('TCP Port', { exact: true }).inputValue(), port, 'Switching actions preserves the selected port')
  await page.waitForFunction((pid) => document.querySelector('.preview > pre')?.textContent?.includes(`kill -TERM ${pid}`), server.pid)
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await page.getByText('Command copied.', { exact: true }).waitFor()
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), `kill -TERM ${server.pid}`)
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm Stop Process on Port', exact: true })
  await dialog.waitFor()
  assert.ok((await dialog.innerText()).includes(`PID ${server.pid}`))
  assert.ok((await dialog.innerText()).includes(`TCP port ${port}`))
  assert.equal(server.exitCode, null, 'Preview and review never send a signal')
  await dialog.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  const result = await Promise.race([serverExited, new Promise((_, reject) => exitTimer = setTimeout(() => reject(new Error('Fixture listener did not exit')), 10000))])
  assert.equal(result[0], 0, 'Fixture shuts down normally after SIGTERM')
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'system.port.stop' && run.status === 'succeeded'))
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} all TCP listeners, inspect port, process lookup, concise Copy, explicit confirmation and SIGTERM of only the disposable listener.`)
} finally {
  clearTimeout(exitTimer)
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
  await app?.close().catch(() => {})
  await rm(root, { recursive: true, force: true })
}
