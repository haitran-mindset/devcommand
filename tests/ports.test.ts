import { describe, expect, it, vi } from 'vitest'
import { inspectPortTarget } from '../src/main/services/commands/ports'
import { expand, getDefinition, validateParams } from '../src/main/services/commands/registry'
import type { ProbeRun } from '../src/main/services/cli/probe'
import { CommandService } from '../src/main/services/commands/service'
import type { SettingsStore } from '../src/main/infrastructure/database/store'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import type { ManagedRunner, ProcessDefinition } from '../src/main/services/execution/runner'

const pid = '2147483000'
function probe(pids = [pid], identity = `${process.getuid?.() ?? 0} Wed Nov 11 09:00:00 2026 /fixture/node`) {
  return vi.fn<ProbeRun>(async (executable) => ({ code: executable === 'lsof' && !pids.length ? 1 : 0, stdout: executable === 'lsof' ? pids.map((pid) => `p${pid}`).join('\n') : identity, stderr: '' }))
}

describe('port commands', () => {
  it('expands only fixed lsof arguments and rejects port/PID injection', () => {
    expect(expand(getDefinition('system.ports'), {})).toEqual(['-nP', '-iTCP', '-sTCP:LISTEN'])
    expect(expand(getDefinition('system.port.process'), { port: '3000' })).toEqual(['-nP', '-i:3000'])
    for (const port of ['0', '65536', '-3000', '3000;kill', '3000\n']) expect(() => validateParams(getDefinition('system.port.stop'), { port })).toThrow()
    for (const pid of ['0', '1', '-1', '-3000', '123;evil', '2147483648']) expect(() => validateParams(getDefinition('system.port.stop'), { port: '3000', pid })).toThrow()
    expect(validateParams(getDefinition('system.port.stop'), { port: '3000' })).toEqual({ port: '3000', pid: '' })
  })
  it('selects a single listener, deduplicates sockets and binds process identity', async () => {
    const run = probe([pid, pid])
    expect((await inspectPortTarget(run, '3000')).pid).toBe(pid)
    expect(run).toHaveBeenCalledWith('lsof', ['-nP', '-iTCP:3000', '-sTCP:LISTEN', '-Fp'])
    expect(run).toHaveBeenCalledWith('ps', ['-p', pid, '-o', 'uid=', '-o', 'lstart=', '-o', 'comm='])
  })
  it('requires an explicit PID for multiple listeners and rejects unrelated targets', async () => {
    await expect(inspectPortTarget(probe([pid, '2147483001']), '3000')).rejects.toThrow('Multiple processes')
    expect((await inspectPortTarget(probe([pid, '2147483001']), '3000', pid)).pid).toBe(pid)
    await expect(inspectPortTarget(probe(), '3000', '2147483001')).rejects.toThrow('not listening')
    await expect(inspectPortTarget(probe([]), '3000')).rejects.toThrow('No visible TCP listener')
  })
  it('refuses self, parent, foreign-user and exited processes', async () => {
    await expect(inspectPortTarget(probe([String(process.pid)]), '3000')).rejects.toThrow('cannot be stopped')
    await expect(inspectPortTarget(probe([String(process.ppid)]), '3000')).rejects.toThrow('cannot be stopped')
    await expect(inspectPortTarget(probe([pid], `${(process.getuid?.() ?? 0) + 1} started node`), '3000')).rejects.toThrow('current OS user')
    await expect(inspectPortTarget(probe([pid], ''), '3000')).rejects.toThrow('exited')
  })
  it('requires a single-use confirmation, rechecks identity and runs only SIGTERM', async () => {
    let identity = `${process.getuid?.() ?? 0} Wed Nov 11 09:00:00 2026 /fixture/node`
    const run: ProbeRun = async (executable) => ({ code: 0, stdout: executable === 'lsof' ? `p${pid}` : identity, stderr: '' })
    const execute = vi.fn<(definition: ProcessDefinition) => string>(() => 'fixture-run')
    const runner = { execute, list: () => [{ id: 'fixture-run', commandId: 'system.port.stop', status: 'running', preview: 'fixture', output: [], startedAt: new Date().toISOString() }] } as unknown as ManagedRunner
    const store = { saveHistory: vi.fn() } as unknown as SettingsStore
    const service = new CommandService(store, {} as WorkspaceService, runner, () => 1000, undefined, run)
    const request = { commandId: 'system.port.stop', params: { port: '3000', pid: '' } }
    const preview = await service.preview(request)
    expect(preview.display).toBe(`kill -TERM ${pid}`)
    expect(preview.consequences.join(' ')).toContain('TCP port 3000')
    await expect(service.execute(request)).rejects.toThrow('Confirmation')
    identity += '-changed'
    await expect(service.execute(request, preview.confirmationToken)).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
    const fresh = await service.preview(request)
    await service.execute(request, fresh.confirmationToken)
    expect(execute.mock.calls[0][0].argv).toEqual(['-TERM', pid])
    await expect(service.execute(request, fresh.confirmationToken)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
