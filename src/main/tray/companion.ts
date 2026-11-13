import { Menu, Tray, nativeImage } from 'electron'
/** One native tray for the app lifetime. Quick Terminal opens a normal shell without inserting any command. */
export class MenuBarCompanion {
  private tray: Tray
  private pending = false
  constructor(iconPath: string, private open: () => Promise<void>, private signal: () => void, private quit: () => void) {
    let image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') {
      // Terminal glyph on transparent pixels, at 2x resolution for a crisp menu-bar template.
      const size = 36, pixels = Buffer.alloc(size * size * 4)
      const dot = (x: number, y: number) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const at = ((y + dy) * size + x + dx) * 4; if (at >= 0 && at + 3 < pixels.length) pixels[at + 3] = 255 } }
      for (let step = 0; step <= 8; step++) { dot(7 + step, 8 + step); dot(15 - step, 16 + step) }
      for (let x = 19; x <= 29; x++) dot(x, 25)
      image = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 }); image.setTemplateImage(true)
    }
    this.tray = new Tray(image)
    this.tray.setToolTip('DevCommand')
    this.tray.on('double-click', () => { void this.open() })
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { id: 'open-devcommand', label: 'Open DevCommand', click: () => { void this.open() } },
      { id: 'quick-terminal', label: 'Quick Terminal', click: () => { this.pending = true; void this.open().then(() => this.signal()) } },
      { type: 'separator' },
      { id: 'quit-devcommand', label: 'Quit', click: this.quit },
    ]))
  }
  takeQuickTerminal() { const pending = this.pending; this.pending = false; return pending }
  destroy() { this.pending = false; this.tray.destroy() }
}
