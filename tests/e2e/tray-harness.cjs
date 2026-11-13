// Test-only native menu inspection; never shipped in the app.
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron startup hook is CommonJS. */
const { Tray } = require('electron')
const setContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function (menu) { globalThis.devcommandTrayMenu = menu; return setContextMenu.call(this, menu) }
const destroy = Tray.prototype.destroy
Tray.prototype.destroy = function () { globalThis.devcommandTrayDestroyed = true; return destroy.call(this) }
