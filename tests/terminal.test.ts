import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readProcessDirectory } from '../src/main/services/terminal/directory'
import { describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../src/main/services/terminal/manager'
import { getShellEnvironment } from '../src/main/services/terminal/environment'
import type { IPty } from 'node-pty'
import type { TerminalDataEvent, TerminalExitEvent } from '../src/shared/runtime'

describe('terminal lifecycle', () => {
  it('submits an initial command once, only after the shell prompt is ready', () => {
    let onData!: (data: string) => void
    const write = vi.fn(), dispose = vi.fn()
    const fake = { pause: vi.fn(), write, onData: (listener: typeof onData) => { onData = listener; return { dispose } }, onExit: () => ({ dispose }) } as unknown as IPty
    const manager = new TerminalManager(() => {}, () => {}, getShellEnvironment(), () => fake)
    manager.startProgram({ executable: '/bin/zsh', argv: ['-f', '-i'], cwd: '/tmp', label: 'fixture', initialCommand: "source '/tmp/config with spaces/.zshrc'" })
    onData('starting')
    expect(write).not.toHaveBeenCalled()
    onData('\x1b[?20'); onData('04h')
    expect(write).toHaveBeenCalledExactlyOnceWith("\x15\x1b[200~source '/tmp/config with spaces/.zshrc'\x1b[201~\r")
    onData('\x1b[?2004h')
    expect(write).toHaveBeenCalledOnce()
    expect(() => manager.startProgram({ executable: '/bin/zsh', argv: ['-i'], cwd: '/tmp', label: 'fixture', initialCommand: 'source bad\ncommand' })).toThrow('Unsafe initial')
  })
  it('reads current cwd only for owned live sessions and rejects a session closed during lookup', async () => {
    const fake = { pid: 777701, pause: vi.fn(), kill: vi.fn(), onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) } as unknown as IPty
    const terminate = vi.fn(async () => {})
    let path = '/fixture/Downloads with spaces'
    const readDirectory = vi.fn(async () => path)
    const manager = new TerminalManager(() => {}, () => {}, getShellEnvironment(), () => fake, terminate, readDirectory)
    const session = manager.create({ shellId: manager.getEnvironment().defaultShellId, cols: 80, rows: 24 })
    expect(await manager.currentDirectory(session.id)).toBe(path)
    expect(readDirectory).toHaveBeenCalledWith(fake.pid)
    path = '/fixture/another directory'
    expect(await manager.currentDirectory(session.id)).toBe(path)
    await expect(manager.currentDirectory(randomUUID())).rejects.toThrow()
    expect(readDirectory).toHaveBeenCalledTimes(2)
    let release!: (value: string) => void
    readDirectory.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = manager.currentDirectory(session.id)
    await manager.close(session.id); release(path)
    await expect(pending).rejects.toThrow('closed')
  })
  it('reads this test process cwd through the OS without running shell commands', async () => {
    if (process.platform === 'win32') return
    expect(await readProcessDirectory(process.pid)).toBe(realpathSync(process.cwd()))
  })
  it('validates shell IDs, bounds sessions, applies acknowledgement backpressure and disposes listeners', async () => {
    let onData!: (data: string) => void
    const dispose = vi.fn()
    const pause = vi.fn(), resume = vi.fn(), kill = vi.fn(), resize = vi.fn(), write = vi.fn()
    const fake = { pid: 777700, pause, resume, kill, resize, write, onData: (listener: typeof onData) => { onData = listener; return { dispose } }, onExit: () => ({ dispose }) } as unknown as IPty
    const events: TerminalDataEvent[] = []
    const terminate = vi.fn(async () => {})
    const manager = new TerminalManager((event) => events.push(event), () => {}, getShellEnvironment(), () => fake, terminate)
    const shellId = manager.getEnvironment().defaultShellId
    expect(() => manager.create({ shellId: '/bin/malicious', cols: 80, rows: 24 })).toThrow()
    const session = manager.create({ shellId, cols: 80, rows: 24 })
    expect(pause).toHaveBeenCalledOnce()
    manager.resize(session.id, 80, 24)
    expect(resume).toHaveBeenCalled()
    for (let i = 0; i < 8; i++) onData('x'.repeat(8192))
    expect(events).toHaveLength(8)
    expect(pause).toHaveBeenCalledTimes(2)
    manager.acknowledge(session.id, events.at(-1)!.sequence)
    expect(resume).toHaveBeenCalledTimes(2)
    manager.write(session.id, '\x03')
    expect(write).toHaveBeenCalledWith('\x03')
    await manager.close(session.id)
    expect(terminate).toHaveBeenCalledWith(fake.pid)
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(() => manager.write(session.id, 'pwd')).toThrow()
    for (let i = 0; i < 8; i++) manager.create({ shellId, cols: 80, rows: 24 })
    expect(() => manager.create({ shellId, cols: 80, rows: 24 })).toThrow('maximum 8')
    await manager.closeAll()
  })
  it.each(['interrupt', 'normal exit'])('returns a launched program to a usable shell after %s', async (mode) => {
    const data: TerminalDataEvent[] = [], exits: TerminalExitEvent[] = []
    const manager = new TerminalManager((event) => { data.push(event); manager.acknowledge(event.sessionId, event.sequence) }, (event) => exits.push(event))
    const session = manager.startProgram({ executable: '/bin/sh', argv: ['-c', 'printf "PROGRAM_READY\\n"; ' + (mode === 'interrupt' ? 'sleep 30' : 'exit 0')], cwd: manager.getEnvironment().cwd, label: 'fixture', keepShell: true })
    const wait = async (marker: string) => {
      const deadline = Date.now() + 5000
      while (!data.map((event) => event.data).join('').includes(marker)) {
        if (Date.now() > deadline) throw new Error('Missing terminal output: ' + marker)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    try {
      manager.resize(session.id, 100, 30)
      await wait('PROGRAM_READY')
      if (mode === 'interrupt') manager.write(session.id, '\x03')
      await new Promise((resolve) => setTimeout(resolve, 300))
      manager.write(session.id, "printf 'SHELL_%s\\n' 'CONTINUES'\r")
      await wait('SHELL_CONTINUES')
      expect(exits).toHaveLength(0)
    } finally { await manager.closeAll() }
  })
  it('runs a real installed shell, streams data, resizes and closes its process', async () => {
    const data: TerminalDataEvent[] = [], exits: TerminalExitEvent[] = []
    const manager = new TerminalManager((event) => { data.push(event); manager.acknowledge(event.sessionId, event.sequence) }, (event) => exits.push(event))
    const session = manager.create({ shellId: manager.getEnvironment().defaultShellId, cols: 80, rows: 24 })
    try {
      manager.resize(session.id, 100, 30)
      manager.write(session.id, "printf 'DEVCOMMAND_PTY_OK\\n'\r")
      const deadline = Date.now() + 5000
      while (!data.some((event) => event.data.includes('DEVCOMMAND_PTY_OK'))) {
        if (Date.now() > deadline) throw new Error('PTY produced no output')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } finally { await manager.closeAll() }
    expect(exits.some((event) => event.sessionId === session.id)).toBe(true)
    expect(() => manager.resize(session.id, 80, 24)).toThrow()
  })
})
