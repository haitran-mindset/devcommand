import { afterEach, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
const fake = vi.hoisted(() => ({ menu: [] as MenuItemConstructorOptions[], destroyed: false }))
vi.mock('electron', () => {
  const image = { resize() { return this }, setTemplateImage: vi.fn() }
  return { nativeImage: { createFromPath: () => image, createFromBitmap: () => image }, Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => template }, Tray: class { on() {} setToolTip() {} setContextMenu(menu: MenuItemConstructorOptions[]) { fake.menu = menu } destroy() { fake.destroyed = true } } }
})
import { MenuBarCompanion } from '../src/main/tray/companion'
afterEach(() => { fake.menu = []; fake.destroyed = false })
it('opens a normal terminal via a one-use intent and exposes only the requested menu items', async () => {
  const open = vi.fn(async () => {}), signal = vi.fn(), quit = vi.fn()
  const companion = new MenuBarCompanion('/icon.png', open, signal, quit)
  expect(fake.menu.filter(item => item.id).map(item => item.label)).toEqual(['Open DevCommand', 'Quick Terminal', 'Quit'])
  expect(fake.menu.some(item => item.id === 'quick-commands')).toBe(false)
  fake.menu.find(item => item.id === 'quick-terminal')!.click!({} as never, {} as never, {} as never)
  await Promise.resolve()
  expect(open).toHaveBeenCalledOnce(); expect(signal).toHaveBeenCalledOnce()
  expect(companion.takeQuickTerminal()).toBe(true); expect(companion.takeQuickTerminal()).toBe(false)
  fake.menu.find(item => item.id === 'quit-devcommand')!.click!({} as never, {} as never, {} as never)
  expect(quit).toHaveBeenCalledOnce(); companion.destroy(); expect(fake.destroyed).toBe(true)
})
