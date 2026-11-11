import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import type { ExecutionEvent } from '../src/shared/runtime'
import { ManagedRunner } from '../src/main/services/execution/runner'
import { LineRedactor } from '../src/main/services/execution/redact'

async function waitUntil(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for process lifecycle')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
function definition(script: string, timeoutMs = 3000) {
  return { commandId: 'test.internal', executable: process.execPath, argv: ['-e', script], cwd: tmpdir(), preview: 'internal test fixture', timeoutMs }
}
describe('managed process core', () => {
  it('streams separate stdout/stderr, preserves sequence and final exit status', async () => {
    const events: ExecutionEvent[] = [], runner = new ManagedRunner((event) => events.push(event))
    try {
      const id = runner.execute(definition("process.stdout.write('first\\n');setTimeout(()=>{process.stderr.write('second\\n');process.exitCode=7},40)"))
      await waitUntil(() => runner.list()[0]?.finishedAt !== undefined)
      const result = runner.list()[0]
      expect(result.id).toBe(id); expect(result.status).toBe('failed'); expect(result.exitCode).toBe(7)
      expect(result.output.map((item) => [item.stream, item.data])).toEqual([['stdout', 'first\n'], ['stderr', 'second\n']])
      expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1))
      expect(events.at(-1)?.type).toBe('status')
    } finally { await runner.closeAll() }
  })
  it('reports unavailable executables without exposing raw environment or paths', async () => {
    const runner = new ManagedRunner(() => {})
    try {
      runner.execute({ ...definition(''), executable: '/nonexistent/devcommand-missing' })
      await waitUntil(() => Boolean(runner.list()[0]?.finishedAt))
      expect(runner.list()[0].status).toBe('failed')
      expect(runner.list()[0].error).toContain('Executable unavailable')
      expect(runner.list()[0].error).not.toContain('/nonexistent')
    } finally { await runner.closeAll() }
  })
  it('redacts tokens split across OS chunks and suppresses oversized lines', () => {
    const redactor = new LineRedactor()
    expect(redactor.push('token=sec')).toBe('')
    expect(redactor.push('ret\nBearer abc')).toBe('token=[REDACTED]\n')
    expect(redactor.push('def\n')).toBe('Bearer [REDACTED]\n')
    expect(redactor.push('x'.repeat(9000))).toContain('omitted')
    expect(redactor.push('hidden-tail\nnormal\n')).toBe('normal\n')
    expect(redactor.flush()).toBe('')
  })
  it('cancels and times out processes with a bounded completion', async () => {
    const runner = new ManagedRunner(() => {})
    try {
      const id = runner.execute(definition('setInterval(()=>{},1000)'))
      await runner.cancel(id)
      expect(runner.list()[0].status).toBe('cancelled')
      expect(runner.list()[0].finishedAt).toBeDefined()
      runner.execute(definition('setInterval(()=>{},1000)', 60))
      await waitUntil(() => runner.list()[1]?.finishedAt !== undefined)
      expect(runner.list()[1].status).toBe('timed-out')
    } finally { await runner.closeAll() }
  })
  it('bounds retained output and terminates an output flood', async () => {
    const runner = new ManagedRunner(() => {})
    try {
      runner.execute(definition("const text='x'.repeat(1000)+'\\n';for(let i=0;i<1500;i++)process.stdout.write(text)"))
      await waitUntil(() => Boolean(runner.list()[0]?.finishedAt))
      const result = runner.list()[0]
      expect(result.truncated).toBe(true)
      expect(result.output.reduce((sum, item) => sum + item.data.length, 0)).toBeLessThanOrEqual(128 * 1024)
      expect(result.status).toBe('failed')
      expect(result.error).toContain('Output limit')
    } finally { await runner.closeAll() }
  })
})
