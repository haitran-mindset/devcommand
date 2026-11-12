import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { chooseSelect } from './select.mjs'
import { waitForIpc } from './wait.mjs'
const root = await mkdtemp(join(tmpdir(), 'devcommand-zsh-'))
const zdir = join(root, 'zsh config with spaces'), marker = join(zdir, 'startup-marker')
await mkdir(zdir)
const config = `print -r -- FIXTURE_ZSH_RC\nprint -r -- loaded > '${marker}'\nPROMPT='fixture%# '\n`
await writeFile(join(zdir, '.zshrc'), config)
const env = { ...process.env, ZDOTDIR: zdir, SSH_AUTH_SOCK: join(root, 'unused-agent.sock') }; delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${join(root, 'profile')}`] })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
  await chooseSelect(page, 'Command category', 'System')
  await page.getByRole('button', { name: 'Zsh', exact: true }).click()
  await page.getByRole('heading', { name: 'Open Zsh', exact: true }).waitFor()
  const runCheck = async (action, commandId, expected = 'succeeded') => {
    await chooseSelect(page, 'Action', action)
    const previous = (await page.evaluate(async () => window.devcommand.commands.listExecutions())).data.map((entry) => entry.id)
    await page.getByRole('button', { name: 'Run Command', exact: true }).click()
    await waitForIpc(page, async ({ commandId, previous, expected }) => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === commandId && !previous.includes(entry.id) && entry.status === expected), { commandId, previous, expected })
    return (await page.evaluate(async () => window.devcommand.commands.listExecutions())).data.find((entry) => entry.commandId === commandId && !previous.includes(entry.id))
  }
  const version = await runCheck('Version', 'zsh.version')
  assert.match(version.output.map((chunk) => chunk.data).join(''), /zsh [0-9]/)
  await runCheck('Help', 'zsh.help')
  await runCheck('PATH entries', 'zsh.path')
  await runCheck('Default options', 'zsh.options')
  await runCheck('Default keybindings', 'zsh.keybindings')
  const lookup = await runCheck('Find command', 'zsh.which')
  assert.match(lookup.output.map((chunk) => chunk.data).join(''), /git/)
  await runCheck('Check config syntax', 'zsh.syntax')
  await assert.rejects(access(marker), 'Syntax checking never executes .zshrc')
  await writeFile(join(zdir, '.zshrc'), 'if then\n')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((entry) => entry.commandId === 'zsh.syntax' && entry.status === 'failed'))
  const history = (await page.evaluate(async () => window.devcommand.library.history())).data
  assert.equal(history.filter((entry) => entry.request.commandId === 'zsh.syntax').every((entry) => entry.execution.output.length === 0), true)
  await writeFile(join(zdir, '.zshrc'), config)
  await page.evaluate(() => { window.zshOutput = []; window.devcommand.terminal.onData((event) => window.zshOutput.push(event.data)) })
  await chooseSelect(page, 'Action', 'Open without user startup files')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Open Zsh Without User Startup Files', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  const input = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await input.waitFor({ state: 'attached' })
  await input.focus(); await page.keyboard.type("PROMPT='READY_%# '; printf 'CLEAN_%s\\n' 'READY'"); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.zshOutput.join('').includes('CLEAN_READY'))
  await assert.rejects(access(marker), 'Clean shell skips personal startup files')
  await input.focus(); await page.keyboard.type("printf 'JOB_%s\\n' 'STARTED'; sleep 30"); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.zshOutput.join('').includes('JOB_STARTED'))
  const interruptOffset = await page.evaluate(() => window.zshOutput.length)
  await page.keyboard.press('Control+c')
  await page.waitForFunction((offset) => /READY_[%#] /.test(window.zshOutput.slice(offset).join('')), interruptOffset)
  await input.focus()
  await page.keyboard.type("printf 'ZSH_%s\\n' 'AFTER_CTRL_C'"); await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.zshOutput.join('').includes('ZSH_AFTER_CTRL_C'))
  assert.equal(await page.locator('.terminal-tab').count(), 1)
  await page.getByRole('button', { name: 'Close all terminal sessions', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  await chooseSelect(page, 'Action', 'Open Zsh')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Open Zsh', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => window.zshOutput.join('').includes('FIXTURE_ZSH_RC'))
  await access(marker)
  await page.getByRole('button', { name: 'Close all terminal sessions', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 0)
  assert.deepEqual(errors, [])
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} grouped Zsh actions, version/help/default inspections, positional command lookup, syntax-only config checks, omitted syntax output in history, clean/normal shell startup and Ctrl+C continuity. Only temporary ZDOTDIR used; no real shell/SSH configuration changed.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
