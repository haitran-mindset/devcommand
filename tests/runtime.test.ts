import { textChunks } from '../src/shared/text'
import { describe, expect, it } from 'vitest'
import { executeSchema, terminalAckSchema, terminalCreateSchema, terminalResizeSchema, terminalWriteSchema } from '../src/shared/runtime'
import { descendants } from '../src/main/infrastructure/process/terminate'
import { childEnvironment } from '../src/main/services/terminal/environment'

describe('runtime boundary validation', () => {
  it('allows only fixed managed command IDs without arbitrary process options', () => {
    expect(executeSchema.parse({ commandId: 'git.version' })).toEqual({ commandId: 'git.version' })
    for (const value of [{ commandId: 'rm' }, { commandId: 'git.version', executable: 'sh' }, { commandId: 'node.version', argv: ['-e', 'malicious()'] }, { commandId: 'git.version', cwd: '/' }]) expect(executeSchema.safeParse(value).success).toBe(false)
  })
  it('bounds terminal inputs, dimensions and session IDs', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(terminalCreateSchema.safeParse({ shellId: 'shell-0', cols: 80, rows: 24 }).success).toBe(true)
    expect(terminalCreateSchema.safeParse({ shellId: 'sh', cols: 80, rows: 24, cwd: '/etc' }).success).toBe(false)
    expect(terminalResizeSchema.safeParse({ sessionId: id, cols: 9999, rows: 0 }).success).toBe(false)
    expect(terminalWriteSchema.safeParse({ sessionId: id, data: 'a'.repeat(16385) }).success).toBe(false)
    expect(terminalWriteSchema.safeParse({ sessionId: '../other', data: 'pwd\r' }).success).toBe(false)
    expect(terminalAckSchema.safeParse({ sessionId: id, sequence: -1 }).success).toBe(false)
  })
  it('finds only descendants in child-first order', () => {
    expect(descendants(777700, '777701 777700\n777702 777701\n777703 1\n777704 777700\ninvalid')).toEqual([777702, 777701, 777704])
  })
  it('does not propagate Electron loader controls to shell/managed children', () => {
    const env = childEnvironment()
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.TERM).toBe('xterm-256color')
  })
})

describe('Unicode transport chunks', () => {
  it('preserves astral characters at both input and output boundaries', () => {
    for (const limit of [8192, 16384]) {
      const input = 'a'.repeat(limit - 1) + '😀日本語' + 'b'.repeat(limit)
      const chunks = [...textChunks(input, limit)]
      expect(chunks.every((chunk) => chunk.length <= limit)).toBe(true)
      expect(chunks.map((chunk) => Buffer.from(chunk).toString('utf8')).join('')).toBe(input)
    }
  })
})
