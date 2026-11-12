import { chooseSelect } from './select.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'
import { waitForIpc } from './wait.mjs'

const root = await mkdtemp(join(tmpdir(), 'devcommand-extended-e2e-'))
const agentStateFile = join(root, 'agent-state.json')
await writeFile(agentStateFile, '[]')
const bin = join(root, 'bin'), sshdir = join(root, '.ssh'), stateFile = join(root, 'docker.json')
await mkdir(bin); await mkdir(sshdir, { mode: 0o700 })
await writeFile(stateFile, JSON.stringify({ state: 'exited', offline: false }))
const container = 'a'.repeat(64)
const program = async (name, body) => writeFile(join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 })
await program('docker', `const fs=require('node:fs'); const file=${JSON.stringify(stateFile)}; const s=JSON.parse(fs.readFileSync(file)); const all=process.argv.slice(2); const a=all[0]==='--context'?all.slice(2):all; const out=x=>console.log(typeof x==='string'?x:JSON.stringify(x));
if(a[0]==='context') { out(a[1]==='show'?'fixture':[{Endpoints:{docker:{Host:'unix:///fixture/docker.sock'}}}]); }
else if(s.offline){process.stderr.write('fixture daemon offline');process.exitCode=1;}
else if(a[0]==='info')out({ID:'fixture-daemon',ServerVersion:'fixture-1'});
else if(a[0]==='ps')out({ID:'${container}',Names:'fixture-container',Image:'fixture:latest',State:s.state,Status:s.state,Ports:''});
else if(a[0]==='image'&&a[1]==='ls')out({ID:'sha256:${'b'.repeat(64)}',Repository:'fixture',Tag:'latest',Size:'1 MB'});
else if(a[0]==='volume'&&a[1]==='ls')out({Name:'fixture_data',Driver:'local'});
else if(a[0]==='network'&&a[1]==='ls')out({ID:'${'c'.repeat(64)}',Name:'bridge',Driver:'bridge'});
else if(['start','stop','restart'].includes(a[0])){s.state=a[0]==='stop'?'exited':'running';fs.writeFileSync(file,JSON.stringify(s));out(a[1]);}
else if(a[0]==='logs'){out('fixture stdout');process.stderr.write('fixture stderr\\n');}
else {process.stderr.write('unexpected fixture command');process.exitCode=2;}`)
await program('ssh-add', `const fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2),file=${JSON.stringify(agentStateFile)};let keys=JSON.parse(fs.readFileSync(file));if(args[0]==='-l'||args[0]==='-L'){if(!keys.length){console.log('The agent has no identities.');process.exitCode=1;}else console.log(keys.map(k=>args[0]==='-L'?fs.readFileSync(k.pub,'utf8').trim():k.line).join('\\n'));}else{fs.writeFileSync(${JSON.stringify(join(root, 'agent-args.json'))},JSON.stringify(args));if(args[0]==='-D'){keys=[];console.log('Fixture all identities removed.');}else{const selected=args[args.length-1],pub=selected.endsWith('.pub')?selected:selected+'.pub';if(!pub.startsWith(${JSON.stringify(sshdir + '/')}))throw Error('Fixture SSH directory required');const line=cp.execFileSync('/usr/bin/ssh-keygen',['-l','-E','sha256','-f',pub],{encoding:'utf8'}).trim(),fingerprint=line.split(/\\s+/)[1];keys=keys.filter(k=>k.fingerprint!==fingerprint);if(args[0]==='-d')console.log('Fixture identity removed.');else{keys.push({pub,line,fingerprint});console.log('Fixture identity added; no OS agent changes.');}}fs.writeFileSync(file,JSON.stringify(keys));}`)
await program('ssh', `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'ssh-args.json'))},JSON.stringify(process.argv.slice(2))); console.log('Fixture authentication diagnostic; no network connection.');`)
const executablePath = process.env.DEVCOMMAND_EXECUTABLE
const env = { ...process.env, DEVCOMMAND_TEST_ROOT: root, SSH_AUTH_SOCK: join(root, 'fixture-agent.sock'), PATH: `${bin}:/usr/bin:/bin`, DOCKER_CONTEXT: '', DOCKER_HOST: '' }; delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ env, ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : ['-r', resolve('tests/e2e/ssh-harness.cjs'), resolve('.')]), `--user-data-dir=${join(root, 'profile')}`], timeout: 30000 })
  let page = await app.firstWindow()
  if (executablePath) {
    // Packaged Electron ignores application -r arguments. Patch only the test process
    // through Playwright's privileged main-process channel, then recreate its window/services
    // before opening SSH. No test hook or alternate home setting ships with the app.
    if (process.platform !== 'darwin') throw new Error('Packaged isolated SSH fixture currently targets macOS only')
    // Wait until normal startup and its activate listener finish before recreating the window.
    await page.getByRole('heading', { name: 'Change Git Remote URL', exact: true }).waitFor()
    const recreated = app.waitForEvent('window', { timeout: 15000 })
    await app.evaluate(({ app, BrowserWindow }, root) => {
      process.getBuiltinModule('os').homedir = () => root
      app.once('window-all-closed', () => app.emit('activate'))
      for (const window of BrowserWindow.getAllWindows()) window.close()
    }, root)
    page = await recreated
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Assert the isolated main-process home before any SSH metadata request/UI navigation.
  assert.equal(await app.evaluate(() => process.getBuiltinModule('os').homedir()), root)
  assert.equal(await app.evaluate(() => process.env.SSH_AUTH_SOCK), join(root, 'fixture-agent.sock'), 'Tests never connect to the real OS agent')
  await page.getByRole('link', { name: 'SSH Manager', exact: true }).click()
  await page.getByRole('heading', { name: 'Public keys', exact: true }).waitFor()
  const initial = await page.evaluate(async () => window.devcommand.ssh.snapshot())
  assert.equal(initial.ok, true); assert.equal(initial.data.directory, sshdir); assert.equal(initial.data.keys.length, 0)
  const scrollState = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      absoluteOutside: [...document.querySelectorAll('*')].filter((node) => window.getComputedStyle(node).position === 'absolute' && node.getBoundingClientRect().bottom > window.innerHeight).map((node) => ({ tag: node.tagName, slot: node.getAttribute('data-slot'), top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height }))
    }
  })
  assert.equal(scrollState.scrollY, 0, `SSH content must not make the document scroll: ${JSON.stringify(scrollState)}`)
  await page.locator('.page-content').hover()
  await page.mouse.wheel(0, 6000)
  await page.waitForFunction(() => document.querySelector('.page-content').scrollTop > 0)
  if (await page.getByRole('combobox', { name: 'Terminal shell', exact: true }).isVisible()) {
    const shells = (await page.evaluate(async () => window.devcommand.terminal.environment())).data
    await chooseSelect(page, 'Terminal shell', (shells.shells.find((shell) => shell.label === 'csh') ?? shells.shells.find((shell) => shell.id === shells.defaultShellId)).label)
  }
  await page.mouse.wheel(0, 6000)
  const shellBounds = await page.evaluate(() => ({
    scrollY: window.scrollY,
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    headerTop: document.querySelector('.titlebar').getBoundingClientRect().top,
    applicationTop: document.querySelector('.application').getBoundingClientRect().top,
    footerBottom: document.querySelector('.statusbar').getBoundingClientRect().bottom
  }))
  assert.equal(shellBounds.scrollY, 0, JSON.stringify(shellBounds))
  assert.equal(shellBounds.applicationTop, 0, JSON.stringify(shellBounds))
  assert.equal(shellBounds.headerTop, 0, JSON.stringify(shellBounds))
  assert.ok(shellBounds.documentHeight <= shellBounds.viewportHeight + 1, JSON.stringify(shellBounds))
  assert.ok(shellBounds.footerBottom <= shellBounds.viewportHeight, JSON.stringify(shellBounds))
  await mkdir('resources/screenshots', { recursive: true })
  await page.screenshot({ path: `resources/screenshots/ssh-scroll-${executablePath ? 'packaged' : 'built'}.png` })
  // Real ssh-keygen receives passphrase input through its PTY, never through argv or managed history.
  await page.getByLabel('Key basename', { exact: true }).fill('id_fixture')
  await page.getByLabel('Public comment', { exact: true }).fill('isolated fixture')
  await page.getByRole('button', { name: 'Review key generation', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  const terminalText = () => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent ?? ''
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('passphrase'))
  const input = page.locator('.terminal-view:not([hidden]) .xterm-helper-textarea')
  await input.focus(); await page.keyboard.type('fixture-passphrase-only'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('again'))
  await page.keyboard.type('fixture-passphrase-only'); await page.keyboard.press('Enter')
  await waitForIpc(page, async () => { const r = await window.devcommand.ssh.snapshot(); return r.ok && r.data.keys.some((key) => key.name === 'id_fixture.pub') })
  assert.equal((await stat(join(sshdir, 'id_fixture'))).mode & 0o777, 0o600)
  assert.equal((await page.evaluate(terminalText)).includes('fixture-passphrase-only'), false)
  await page.getByRole('button', { name: 'Copy public key', exact: true }).click()
  await page.getByText('Public key copied.', { exact: true }).waitFor()
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), (await readFile(join(sshdir, 'id_fixture.pub'), 'utf8')).trim(), 'Public key Copy writes the actual public key')
  await page.getByRole('button', { name: 'Refresh SSH', exact: true }).click()
  await chooseSelect(page, 'Agent key', 'id_fixture')
  await chooseSelect(page, 'Key lifetime', '10 minutes')
  await page.getByRole('button', { name: 'Add key to agent', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review agent.add', exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('Fixture identity added'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'agent-args.json'), 'utf8')), ['-t', '600', join(sshdir, 'id_fixture')], 'Add Key to Agent uses the selected ten-minute lifetime')
  await chooseSelect(page, 'Identity', 'id_fixture')
  assert.equal(await page.getByRole('combobox', { name: 'Identity', exact: true }).innerText(), 'id_fixture')
  await chooseSelect(page, 'Identity', 'Use OS default / agent')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Choosing an identity must not submit the host form')
  await page.getByLabel('Host alias', { exact: true }).fill('fixture')
  await page.getByLabel('Hostname', { exact: true }).fill('git.example.invalid')
  await page.getByLabel('SSH user', { exact: true }).fill('git')
  await page.getByRole('button', { name: 'Review host config', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Config saved.' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  assert.match(await readFile(join(sshdir, 'config'), 'utf8'), /Host fixture/)
  assert.equal((await readFile(join(sshdir, 'config'), 'utf8')).includes('IdentityFile'), false, 'OS default selection preserves the empty identity domain value')
  // Revision-bound edit creates a private backup and preserves comments/directives.
  const updated = await page.evaluate(async () => { const s = (await window.devcommand.ssh.snapshot()).data; const a = { kind: 'host.update', alias: 'fixture', hostName: 'git.example.invalid', user: 'git', port: 2222, identityName: 'id_fixture', revision: s.revision }; const p = await window.devcommand.ssh.preview(a); return window.devcommand.ssh.execute(a, p.data.token) })
  assert.equal(updated.ok, true); assert.equal((await stat(updated.data.backupPath)).mode & 0o777, 0o600)
  await page.getByText('git@git.example.invalid:2222', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit host', exact: true }).click()
  await page.getByRole('heading', { name: 'Edit fixture', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Host alias', { exact: true }).isDisabled(), true)
  assert.equal(await page.getByLabel('Hostname', { exact: true }).evaluate((input) => input === document.activeElement), true, 'Edit host focuses its configuration form')
  await page.getByRole('button', { name: 'New host', exact: true }).click()
  assert.equal(await page.getByLabel('Host alias', { exact: true }).inputValue(), '')
  for (const [width, height] of [[1280, 820], [900, 700], [1672, 941]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height])
    await page.waitForFunction((width) => innerWidth === width, width)
    await page.locator('.page-content').evaluate((panel) => { panel.scrollTop = 0 })
    assert.equal(await page.locator('.ssh-manager').evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1), true, 'SSH content fits without horizontal overflow')
    assert.equal(await page.locator('.ssh-layout').evaluate((layout) => {
      const list = layout.querySelector('.ssh-main-column').getBoundingClientRect()
      const forms = layout.querySelector('.ssh-tools').getBoundingClientRect()
      const [generate, host] = layout.querySelectorAll('.ssh-tools > section')
      return forms.top >= list.bottom && Math.abs(forms.left - list.left) < 1 && host.getBoundingClientRect().top >= generate.getBoundingClientRect().bottom
    }), true, 'Both SSH forms stack below the lists in a single column')

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `resources/screenshots/ssh-redesign-${executablePath ? 'packaged' : 'built'}-${width}.png` })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.screenshot({ path: `resources/screenshots/ssh-redesign-${executablePath ? 'packaged' : 'built'}-light.png` })
  await page.evaluate(() => document.documentElement.classList.add('dark'))

  await page.getByRole('button', { name: 'Test connection', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByRole('region', { name: 'Operation result', exact: true }).getByRole('status').filter({ hasText: 'succeeded' }).waitFor()
  const sshArgs = JSON.parse(await readFile(join(root, 'ssh-args.json'), 'utf8'))
  assert.ok(sshArgs.includes('StrictHostKeyChecking=yes')); assert.ok(sshArgs.includes('BatchMode=yes')); assert.ok(sshArgs.includes('ProxyCommand=none'))
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Remove host', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review host.remove', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Config saved.' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByText('No Host aliases configured.', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await chooseSelect(page, 'Command category', 'SSH')
  await page.waitForFunction(() => document.querySelectorAll('.command-row').length === 3)
  await page.getByRole('button', { name: 'SSH Keys', exact: true }).click()
  await chooseSelect(page, 'Action', 'Generate key')
  await page.getByLabel('Key Basename', { exact: true }).fill('id_cli_fixture')
  await page.getByLabel('Public Comment', { exact: true }).fill('CLI fixture')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Generate SSH Key', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('passphrase'))
  await input.focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('again'))
  await page.keyboard.press('Enter')
  await waitForIpc(page, async () => { const r = await window.devcommand.ssh.snapshot(); return r.ok && r.data.keys.some((key) => key.name === 'id_cli_fixture.pub') })
  assert.equal((await stat(join(sshdir, 'id_cli_fixture'))).mode & 0o777, 0o600)
  await chooseSelect(page, 'Action', 'Show fingerprint')
  assert.equal(await page.getByLabel('Key Basename', { exact: true }).inputValue(), 'id_cli_fixture', 'SSH actions preserve the selected key basename')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'ssh.key.fingerprint' && run.status === 'succeeded'))
  await page.getByRole('button', { name: 'SSH Agent', exact: true }).click()
  await chooseSelect(page, 'Action', 'List identities')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'ssh.agent.list' && run.status === 'succeeded' && run.exitCode === 0))
  await chooseSelect(page, 'Action', 'List public keys')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'ssh.agent.public' && run.status === 'succeeded' && run.exitCode === 0))
  await chooseSelect(page, 'Action', 'Load key into agent')
  await chooseSelect(page, 'Key lifetime', 'No time limit')
  await page.getByLabel('Key Basename', { exact: true }).fill('id_cli_fixture')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Load SSH Key into Agent', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('Fixture identity added'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'agent-args.json'), 'utf8')), [join(sshdir, 'id_cli_fixture')])
  await page.getByRole('button', { name: 'SSH', exact: true }).click()
  await chooseSelect(page, 'Action', 'Connect')
  await page.getByLabel('Hostname or Alias', { exact: true }).fill('git.example.invalid')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Connect with SSH', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden]) .xterm-accessibility-tree')?.textContent?.includes('Fixture authentication diagnostic'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'ssh-args.json'), 'utf8')), ['-p', '22', '-l', 'git', 'git.example.invalid'])
  await chooseSelect(page, 'Action', 'Test authentication')
  await page.getByRole('button', { name: 'Run Command', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm Test SSH Authentication', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await waitForIpc(page, async () => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === 'ssh.test' && run.status === 'succeeded'))
  const directArgs = JSON.parse(await readFile(join(root, 'ssh-args.json'), 'utf8'))
  assert.ok(directArgs.includes('StrictHostKeyChecking=yes')); assert.ok(directArgs.includes('BatchMode=yes')); assert.ok(directArgs.includes('ProxyCommand=none'))
  for (const [action, commandId, flag] of [['Version', 'ssh.version', '-V'], ['Help', 'ssh.help', '-h']]) {
    await chooseSelect(page, 'Action', action)
    await page.getByRole('button', { name: 'Run Command', exact: true }).click()
    await waitForIpc(page, async (commandId) => (await window.devcommand.commands.listExecutions()).data.some((run) => run.commandId === commandId && run.status === 'succeeded'), commandId)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'ssh-args.json'), 'utf8')), [flag])
  }
  await page.screenshot({ path: `resources/screenshots/ssh-command-library-${executablePath ? 'packaged' : 'built'}.png` })
  const configBeforeAgentRemoval = await readFile(join(sshdir, 'config'), 'utf8')
  await page.getByRole('link', { name: 'SSH Manager', exact: true }).click()
  const cliFingerprint = (await page.evaluate(async () => window.devcommand.ssh.snapshot())).data.keys.find((key) => key.name === 'id_cli_fixture.pub').fingerprint
  await page.getByRole('button', { name: 'Remove id_cli_fixture.pub from agent', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review agent.remove', exact: true }).getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await waitForIpc(page, async (fingerprint) => { const r = await window.devcommand.ssh.snapshot(); return r.ok && !r.data.agent.identities.some((line) => line.includes(fingerprint)) && r.data.agent.identities.length === 1 }, cliFingerprint)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'agent-args.json'), 'utf8')), ['-d', join(sshdir, 'id_cli_fixture.pub')])
  await page.getByRole('button', { name: 'Remove all keys', exact: true }).click()
  const clearAgent = page.getByRole('dialog', { name: 'Review agent.clear', exact: true })
  await clearAgent.getByText(/every repository or application/).waitFor()
  await clearAgent.getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await waitForIpc(page, async () => { const r = await window.devcommand.ssh.snapshot(); return r.ok && r.data.agent.identities.length === 0 })
  assert.deepEqual(JSON.parse(await readFile(join(root, 'agent-args.json'), 'utf8')), ['-D'])
  assert.equal(await readFile(join(sshdir, 'config'), 'utf8'), configBeforeAgentRemoval, 'Agent operations preserve SSH config')
  assert.equal((await stat(join(sshdir, 'id_cli_fixture'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(sshdir, 'id_cli_fixture.pub'))).isFile(), true)
  const history = await page.evaluate(async () => window.devcommand.library.history()); assert.equal(JSON.stringify(history).includes('fixture-passphrase-only'), false); assert.equal(history.data.some((entry) => ['ssh.key.generate', 'ssh.agent.add', 'ssh.agent.remove', 'ssh.agent.clear', 'ssh.connect'].includes(entry.request.commandId)), false)
  await page.getByRole('link', { name: 'Docker', exact: true }).click()
  await page.getByText('fixture-container', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByRole('region', { name: 'Operation result', exact: true }).getByRole('status').filter({ hasText: 'succeeded' }).waitFor()
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).state, 'running')
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Logs', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Run', exact: true }).click()
  await page.getByText('fixture stdout', { exact: false }).waitFor()
  await page.getByRole('region', { name: 'Operation result' }).getByRole('status').filter({ hasText: 'succeeded' }).waitFor()
  assert.equal(JSON.stringify((await page.evaluate(async () => window.devcommand.library.history())).data).includes('fixture stdout'), false)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await mkdir('resources/screenshots', { recursive: true }); await page.screenshot({ path: `resources/screenshots/phase5-docker-${executablePath ? 'packaged' : 'built'}.png` })
  await writeFile(stateFile, JSON.stringify({ state: 'running', offline: true }))
  await page.getByRole('button', { name: 'Refresh Docker', exact: true }).click()
  await page.getByRole('heading', { name: 'Docker daemon unavailable', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Command Explorer', exact: true }).click()
  await chooseSelect(page, 'Command category', 'Flutter')
  await page.getByRole('heading', { name: 'Flutter Version', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Run Command', exact: true }).isDisabled(), true)
  assert.equal((await page.evaluate(async () => window.devcommand.ssh.preview({ kind: 'key.generate', name: '../escape', comment: '' }))).ok, false)
  assert.deepEqual(errors, [])
  assert.ok((await readdir(sshdir)).includes('id_fixture.pub'))
  console.log(`PASS: ${executablePath ? 'packaged' : 'built'} fixed SSH pane wheel scrolling/document bounds, isolated real ssh-keygen PTY, passphrase privacy, public metadata, backed-up host config, fake SSH strict flags, fake Docker start/logs/offline and unavailable Flutter UI. No user SSH/agent/daemon changes or network connections.`)
} finally { await app?.close().catch(() => {}); await rm(root, { recursive: true, force: true }) }
