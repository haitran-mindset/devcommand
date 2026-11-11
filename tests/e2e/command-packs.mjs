import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-command-packs-'))
const repo = join(root, 'repo with spaces'), bin = join(root, 'bin'), calls = join(root, 'cli-calls.jsonl')
await mkdir(bin)
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
await writeFile(join(repo, 'sample.txt'), 'Permission fixture\n', { mode: 0o644 })
for (const tool of ['codex', 'claude', 'gemini', 'agy', 'cloudflared', 'ngrok']) {
  const script = `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({tool:${JSON.stringify(tool)},args,cwd:process.cwd()})+'\\n');if(args.includes('--help')||args.includes('--version')){console.log('fixture ${tool} help/version');}else{console.log('FIXTURE ${tool} READY');process.stdin.resume();process.stdin.on('data',data=>{if(data.toString().includes('exit'))process.exit(0);});}\n`
  await writeFile(join(bin, tool), script, { mode: 0o755 })
}
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await app.evaluate(({ dialog }, repo) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] }) }, repo)
  await page.getByRole('link', { name: 'Repositories', exact: true }).click()
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('heading', { name: 'repo with spaces', exact: true }).waitFor()
  const workspaceId = (await page.evaluate(async () => window.devcommand.workspace.list())).data.selectedId
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await chooseSelect(page, 'Command category', 'Permissions')
  await page.getByRole('heading', { name: 'Inspect File Permissions', exact: true }).waitFor()
  await page.getByRole('button', { name: 'File Permissions', exact: true }).click()
  await chooseSelect(page, 'Action', 'Change permissions (chmod)')
  await page.getByLabel('Repository-relative Path', { exact: true }).fill('sample.txt')
  await page.getByLabel('Permission Mode', { exact: true }).fill('600')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm Change File Permissions', exact: true })
  await dialog.waitFor()
  assert.equal((await stat(join(repo, 'sample.txt'))).mode & 0o777, 0o644)
  await dialog.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'permissions.chmod' && !!run.finishedAt))
  assert.equal((await stat(join(repo, 'sample.txt'))).mode & 0o777, 0o600)

  const runCommand = async (commandId, params) => {
    const request = { commandId, params, workspaceId }
    const preview = await page.evaluate(async (request) => window.devcommand.library.preview(request), request)
    assert.equal(preview.ok, true, `${commandId} preview: ${preview.error ?? ''}`)
    const result = await page.evaluate(async ({ request, token }) => window.devcommand.library.execute(request, token), { request, token: preview.data.confirmationToken })
    assert.equal(result.ok, true, `${commandId} execute: ${result.error ?? ''}`)
    await waitForIpc(page, async (id) => (await window.devcommand.commands.listExecutions()).data.some((run) => run.id === id && !!run.finishedAt), result.data.executionId)
    const run = (await page.evaluate(async () => window.devcommand.commands.listExecutions())).data.find((run) => run.id === result.data.executionId)
    assert.equal(run.status, 'succeeded', `${commandId}: ${JSON.stringify(run.output)}`)
    return run
  }
  await runCommand('permissions.inspect', { target: 'sample.txt' })
  await runCommand('permissions.chown', { target: 'sample.txt', owner: String(process.getuid()) })
  const identity = userInfo().username
  const acl = { target: 'sample.txt', principal: 'user', identity, access: 'r' }
  await runCommand('permissions.acl.add', acl)
  const view = await runCommand('permissions.acl.view', { target: 'sample.txt' })
  assert.ok(view.output.map((chunk) => chunk.data).join('').includes(identity))
  await runCommand('permissions.acl.remove', process.platform === 'darwin' ? { target: 'sample.txt', index: '0' } : { target: 'sample.txt', principal: 'user', identity })
  await runCommand('permissions.acl.add', acl)
  await runCommand('permissions.acl.clear', { target: 'sample.txt' })
  const blocked = await page.evaluate(async (workspaceId) => window.devcommand.library.preview({ commandId: 'permissions.chmod', params: { target: '../escape', mode: '777' }, workspaceId }), workspaceId)
  assert.equal(blocked.ok, false)

  await chooseSelect(page, 'Command category', 'AI Developer CLI')
  await page.waitForFunction(() => document.querySelectorAll('.command-row').length === 4)
  assert.equal(await page.getByRole('button', { name: 'Codex', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Codex', exact: true }).click()
  await chooseSelect(page, 'Action', 'Start session')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const aiReview = page.getByRole('dialog', { name: 'Confirm Start Codex', exact: true })
  await aiReview.waitFor()
  assert.equal(await readFile(calls, 'utf8').then(() => true, () => false), false, 'Selecting and reviewing an AI command never starts the provider CLI')
  await aiReview.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('FIXTURE codex READY'))
  const input = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await input.focus(); await page.keyboard.type('exit'); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Close terminal 1', exact: true }).click()
  for (const id of ['codex', 'claude', 'gemini', 'antigravity']) {
    await runCommand(`ai.${id}.help`, {})
    if (id !== 'antigravity') await runCommand(`ai.${id}.version`, {})
    for (const action of ['start', 'resume']) {
      const request = { commandId: `ai.${id}.${action}`, workspaceId, params: {} }
      const preview = await page.evaluate(async (request) => window.devcommand.library.preview(request), request)
      assert.equal(preview.ok, true)
      const session = await page.evaluate(async ({ request, token }) => window.devcommand.library.launch(request, token), { request, token: preview.data.confirmationToken })
      assert.equal(session.ok, true, `Launch ${id} ${action}`)
      assert.ok(session.data.cwd.endsWith('/repo with spaces'))
      await page.evaluate(async (session) => window.devcommand.terminal.close(session.id), session.data)
    }
  }
  await chooseSelect(page, 'Command category', 'General')
  await page.getByRole('button', { name: 'Cloudflare Tunnel', exact: true }).click()
  await page.getByRole('heading', { name: 'Start Quick Tunnel', exact: true }).waitFor()
  await page.getByLabel('Local service URL', { exact: true }).fill('http://localhost:4321')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  const tunnelDialog = page.getByRole('dialog', { name: 'Confirm Start Quick Tunnel', exact: true })
  await tunnelDialog.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByText('FIXTURE cloudflared READY', { exact: false }).first().waitFor()
  const tunnelCalls = (await readFile(calls, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.tool === 'cloudflared')
  assert.deepEqual(tunnelCalls.at(-1).args, ['tunnel', '--url', 'http://localhost:4321'])
  await page.evaluate(() => { window.tunnelOutput = []; window.devcommand.terminal.onData((event) => window.tunnelOutput.push(event.data)) })
  const terminalInput = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await terminalInput.focus()
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(500)
  await terminalInput.focus()
  await page.keyboard.type("printf 'TUNNEL_%s\\n' 'SHELL_READY'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.tunnelOutput.join('').includes('TUNNEL_SHELL_READY'))
  assert.equal(await page.locator('.terminal-tab').count(), 1, 'Ctrl+C keeps the tunnel tab alive')
  assert.equal(await page.locator('.terminal-tab [aria-selected=true]').getAttribute('aria-label').then((label) => label.includes('exited')), false)
  await page.getByRole('button', { name: 'Close all terminal sessions', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  await page.getByRole('button', { name: 'ngrok', exact: true }).click()
  await page.getByRole('heading', { name: 'Start ngrok HTTP Tunnel', exact: true }).waitFor()
  await page.getByLabel('Local port', { exact: true }).fill('4321')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Start ngrok HTTP Tunnel', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByText('FIXTURE ngrok READY', { exact: false }).first().waitFor()
  const ngrokCalls = (await readFile(calls, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => entry.tool === 'ngrok')
  assert.deepEqual(ngrokCalls.at(-1).args, ['http', '4321'])
  await terminalInput.focus()
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(500)
  await terminalInput.focus()
  await page.keyboard.type("printf 'NGROK_%s\\n' 'SHELL_READY'")
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.tunnelOutput.join('').includes('NGROK_SHELL_READY'))
  assert.equal(await page.locator('.terminal-tab').count(), 1)
  await page.getByRole('button', { name: 'Close all terminal sessions', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  const history = await page.evaluate(async () => window.devcommand.library.history())
  assert.equal(history.data.some((entry) => entry.request.commandId.startsWith('ngrok.')), false)
  assert.equal(history.data.some((entry) => /^ai\..*\.(start|resume)$/.test(entry.request.commandId)), false)
  const log = (await readFile(calls, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  for (const tool of ['codex', 'claude', 'gemini', 'agy']) assert.ok(log.some((entry) => entry.tool === tool))
  assert.equal(log.some((entry) => entry.args.some((arg) => /skip-permissions|yolo|bypass/.test(arg))), false)
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} Permissions filter, real chmod/chown/ACL on disposable file, path rejection, AI CLI filter, four fake provider tools, interactive terminal launch/exit, confirmation and history privacy. No real AI service calls.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
