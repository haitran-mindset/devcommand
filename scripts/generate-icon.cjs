// Render the source vector with Electron; no external image dependencies required.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { execFileSync } = require('node:child_process')
const { setTimeout, clearTimeout } = require('node:timers')

const profile = mkdtempSync(join(tmpdir(), 'devcommand-icon-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } })
  const svg = readFileSync(resolve('resources/icon.svg'), 'utf8')
  const painted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Icon rendering timed out.')), 10000)
    window.webContents.on('paint', (_event, _rect, image) => {
      const size = image.getSize()
      const pixel = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
      const bitmap = image.toBitmap()
      // Ignore the initial empty frame before the vector has been painted.
      if (bitmap[pixel + 3] && bitmap[pixel] > bitmap[pixel + 1] + 20) {
        clearTimeout(timer)
        resolve(image)
      }
    })
  })
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{margin:0;background:transparent;width:1024px;height:1024px}</style>${svg}`)}`)
  const capture = await painted
  const icon = capture.resize({ width: 1024, height: 1024 })
  writeFileSync(resolve('resources/icon.png'), icon.toPNG())
  if (process.platform === 'darwin') {
    const iconset = join(profile, 'DevCommand.iconset')
    require('node:fs').mkdirSync(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) writeFileSync(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), icon.resize({ width: size * scale, height: size * scale }).toPNG())
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', resolve('resources/icon.icns')])
  }
  window.destroy()
}).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }).finally(() => { rmSync(profile, { recursive: true, force: true }); app.exit(process.exitCode || 0) })
