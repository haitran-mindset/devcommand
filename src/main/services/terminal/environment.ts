import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { TerminalEnvironment } from '../../../shared/runtime'

export interface ShellEnvironment extends TerminalEnvironment { paths: Map<string, string> }
export function getShellEnvironment(): ShellEnvironment {
  const cwd = realpathSync(homedir())
  if (!statSync(cwd).isDirectory()) throw new Error('Home directory is unavailable')
  let candidates: string[]
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows'
    candidates = [join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), join(root, 'System32', 'cmd.exe')]
  } else {
    let installed: string[] = []
    try { installed = readFileSync('/etc/shells', 'utf8').split('\n').map((line) => line.trim()).filter((line) => line.startsWith('/')) } catch { /* Use OS shell fallbacks. */ }
    candidates = [...new Set([...installed, '/bin/zsh', '/bin/bash', '/bin/sh'])]
  }
  const paths = new Map<string, string>()
  const shells: TerminalEnvironment['shells'] = []
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK)
      if (!statSync(path).isFile()) continue
      const id = `shell-${shells.length}`
      paths.set(id, path)
      shells.push({ id, label: path.split(/[\\/]/).pop()! })
    } catch { /* Not an installed executable. */ }
  }
  if (!shells.length) throw new Error('No supported installed shell found')
  const defaultShellId = shells.find((shell) => paths.get(shell.id) === process.env.SHELL)?.id ?? shells[0].id
  return { cwd, shells, defaultShellId, paths }
}
export function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // Keep the local user's PATH and shell setup, but never inherit Electron inspector/loader controls.
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_') || key.startsWith('VITE_') || key.startsWith('DEVCOMMAND_') || ['NODE_OPTIONS', 'NODE_INSPECT_RESUME_ON_START', 'NODE_CHANNEL_FD'].includes(key)) delete env[key]
  }
  const paths = (env.PATH ?? '').split(delimiter).filter(isAbsolute)
  if (process.platform !== 'win32') paths.push(join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin')
  env.PATH = [...new Set(paths)].join(delimiter)
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
