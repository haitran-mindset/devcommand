const { join } = require('node:path')
module.exports = async (context) => {
  const { preparePty } = await import('./prepare-native.mjs')
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  preparePty(join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty'))
}
