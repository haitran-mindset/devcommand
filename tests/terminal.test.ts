import { describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../src/main/services/terminal/manager'
import { getShellEnvironment } from '../src/main/services/terminal/environment'
import type { IPty } from 'node-pty'
import type { TerminalDataEvent, TerminalExitEvent } from '../src/shared/runtime'

describe('terminal lifecycle', () => {
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
