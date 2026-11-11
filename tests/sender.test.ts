import { describe, expect, it } from 'vitest'
import { assertTrustedSender } from '../src/main/security/sender'
const trusted = { senderId: 3, expectedId: 3, frameUrl: 'file:///app/index.html#/commands', isMainFrame: true, rendererUrl: 'file:///app/index.html' }
describe('IPC authorization', () => {
  it('allows the registered main frame and hash routes', () => {
    expect(() => assertTrustedSender(trusted)).not.toThrow()
  })
  it('rejects wrong windows, subframes and unexpected URLs', () => {
    for (const patch of [{ senderId: 4 }, { isMainFrame: false }, { frameUrl: undefined }, { frameUrl: 'file:///other/index.html' }, { frameUrl: 'https://evil.example' }, { frameUrl: 'file:///app/index.html?injected=1' }]) {
      expect(() => assertTrustedSender({ ...trusted, ...patch })).toThrow()
    }
  })
  it('checks exact development origin, path and port', () => {
    const dev = { ...trusted, rendererUrl: 'http://localhost:5173/', frameUrl: 'http://localhost:5173/#/settings' }
    expect(() => assertTrustedSender(dev)).not.toThrow()
    expect(() => assertTrustedSender({ ...dev, frameUrl: 'http://localhost:5174/' })).toThrow()
  })
})
