import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const checks = [
  ['git.version', 'git --version'], ['node.version', 'node --version'], ['npm.version', 'npm --version'],
  ['python.version', 'python3 --version'], ['docker.version', 'docker --version'], ['ssh.version', 'ssh -V'],
  ['system.whoami', 'whoami'], ['system.hostname', 'hostname'], ['system.pwd', 'pwd'],
  ['system.uname', 'uname -a'], ['system.uptime', 'uptime'], ['system.date', 'date']
]
const root = await mkdtemp(join(tmpdir(), 'devcommand-shell-tools-')), bin = join(root, 'bin')
await mkdir(bin)
for (const [, command] of checks) {
  const executable = command.split(' ')[0]
  const redirect = executable === 'ssh' ? ' >&2' : ''
  await writeFile(join(bin, executable), `#!/bin/sh\nprintf 'FIXTURE_${executable}'${redirect}\nfor arg in "$@"; do printf ' <%s>' "$arg"${redirect}; done\nprintf '\\n'${redirect}\n`, { mode: 0o755 })
}
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ZDOTDIR: root, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Shell Tools', exact: true }).click()
  await page.getByRole('heading', { name: 'Process Core', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Clear', exact: true }).isDisabled(), true)
  await page.getByRole('combobox', { name: 'Managed command', exact: true }).click()
  await page.getByRole('option', { name: 'date', exact: true }).waitFor()
  assert.equal(await page.getByRole('option').count(), 12)
  await page.keyboard.press('Escape')
  for (const [commandId, command] of checks) {
    await chooseSelect(page, 'Managed command', command)
    const previous = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.map((entry) => entry.id)
    await page.getByRole('button', { name: 'Run check', exact: true }).click()
    await waitForIpc(page, async ({ commandId, previous }) => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === commandId && !previous.includes(entry.id) && !!entry.finishedAt), { commandId, previous })
    const execution = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.find((entry) => entry.commandId === commandId && !previous.includes(entry.id))
    assert.equal(execution.status, 'succeeded', command)
    assert.equal(execution.preview, command)
    await page.getByRole('article', { name: `Execution ${command}`, exact: true }).getByText('succeeded', { exact: true }).waitFor()
    const [executable, ...args] = command.split(' ')
    assert.equal(execution.output.map((chunk) => chunk.data).join(''), `FIXTURE_${executable}${args.map((arg) => ' <' + arg + '>').join('')}\n`)
    if (executable === 'ssh') assert.equal(execution.output[0].stream, 'stderr')
  }
  const clear = page.getByRole('button', { name: 'Clear', exact: true })
  await clear.click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.length === 0)
  await page.getByText('No recent runs to display.', { exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.devcommand.library.history())).data.length, 12, 'Session clear preserves saved history')
  await chooseSelect(page, 'Managed command', 'git --version')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === 'git.version' && !!entry.finishedAt))
  await page.getByRole('article', { name: 'Execution git --version', exact: true }).getByText('succeeded', { exact: true }).waitFor()
  await writeFile(join(bin, 'uptime'), '#!/bin/sh\nprintf "RUNNING_FIXTURE\\n"\nwhile :; do /bin/sleep 1; done\n', { mode: 0o755 })
  await chooseSelect(page, 'Managed command', 'uptime')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === 'system.uptime' && entry.output.some((chunk) => chunk.data.includes('RUNNING_FIXTURE'))))
  const active = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data.find((entry) => entry.commandId === 'system.uptime')
  await clear.click()
  const remaining = (await page.evaluate(() => window.devcommand.commands.listExecutions())).data
  assert.deepEqual(remaining.map((entry) => entry.id), [active.id])
  assert.equal(remaining[0].status, 'running', 'Clear never interrupts a running process')
  await page.evaluate((id) => window.devcommand.commands.cancel(id), active.id)
  await clear.click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.length === 0)
  for (const request of [{ commandId: 'shell.exec' }, { commandId: 'ssh.agent.clear' }, { commandId: 'system.date', argv: ['010100002026'] }]) {
    const result = await page.evaluate((request) => window.devcommand.commands.execute(request), request)
    assert.equal(result.ok, false, 'Arbitrary commands and arguments remain forbidden')
  }
  // A typed missing-tool response must be visible rather than replaced by a generic message.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('commands:execute')
    ipcMain.handle('commands:execute', () => ({ ok: false, error: 'docker is not installed or absent from the application PATH.' }))
  })
  await chooseSelect(page, 'Managed command', 'docker --version')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'docker is not installed or absent from the application PATH.' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Docker', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: all 12 Shell Tools commands execute with fixed arguments, stderr version output, missing-tool feedback, clear finished runs while preserving active processes/saved history and strict IPC rejection. Only fake CLIs ran; no real SSH, Docker or shell configuration was used.')
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
