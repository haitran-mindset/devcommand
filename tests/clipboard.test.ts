import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from '../src/renderer/src/lib/clipboard'

afterEach(() => vi.unstubAllGlobals())

it('explains how to recover when a running preload lacks clipboard support', async () => {
  vi.stubGlobal('window', { devcommand: {} })
  await expect(copyText('public text')).rejects.toThrow('restart DevCommand')
})

it('does not report success when the native clipboard rejects a write', async () => {
  vi.stubGlobal('window', { devcommand: { clipboard: { writeText: vi.fn().mockResolvedValue({ ok: false, error: 'Clipboard unavailable.' }) } } })
  await expect(copyText('public text')).rejects.toThrow('Clipboard unavailable.')
})
