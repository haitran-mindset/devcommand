import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsPatchSchema } from '../src/shared/contracts'
import { openSettingsStore } from '../src/main/infrastructure/database/store'

describe('settings contract', () => {
  it('rejects unknown keys, invalid routes and out-of-range dimensions', () => {
    for (const patch of [{ shell: 'rm -rf' }, { route: '../' }, { terminalHeight: 1 }, { theme: 'pink' }, { sidebarCollapsed: 'yes' }]) {
      expect(settingsPatchSchema.safeParse(patch).success).toBe(false)
    }
    expect(settingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
  })
})
describe('SQLite settings', () => {
  it('migrates once, preserves partial updates and persists after reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'devcommand-'))
    try {
      const path = join(directory, 'settings.sqlite')
      const first = openSettingsStore(path)
      expect(first.get()).toEqual(defaultSettings)
      first.update({ theme: 'light', route: 'settings' })
      expect(() => first.update({ terminalHeight: 999 })).toThrow()
      expect(first.get().theme).toBe('light')
      first.close()
      const second = openSettingsStore(path)
      expect(second.get()).toEqual({ ...defaultSettings, theme: 'light', route: 'settings' })
      second.update({ sidebarCollapsed: true })
      expect(second.get().theme).toBe('light')
      second.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('reports malformed persisted settings without silently resetting them', () => {
    const store = openSettingsStore(':memory:')
    expect(() => store.update({ theme: 'invalid' } as never)).toThrow()
    store.close()
    const directory = mkdtempSync(join(tmpdir(), 'devcommand-corrupt-'))
    try {
      const path = join(directory, 'settings.sqlite')
      const initial = openSettingsStore(path)
      initial.close()
      const raw = new Database(path)
      raw.prepare('INSERT INTO app_settings VALUES (?, ?)').run('preferences', '{invalid')
      raw.close()
      const reopened = openSettingsStore(path)
      expect(() => reopened.get()).toThrow()
      reopened.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
