import { spawn } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { childEnvironment } from '../terminal/environment'
import { redact } from '../execution/redact'
import type { RepositoryStatus, Workspace } from '../../../shared/commands'
import type { SettingsStore } from '../../infrastructure/database/store'

import { PublicError } from '../../security/errors'
export { PublicError } from '../../security/errors'
export const gitSafetyArgs = ['--literal-pathspecs', '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never']
export function gitProbe(cwd: string, argv: string[], allowedFailure = false, preserveOutput = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const processEnv = { ...childEnvironment(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', LC_ALL: 'C' }
    for (const key of Object.keys(processEnv)) if (key.startsWith('GIT_') && !['GIT_TERMINAL_PROMPT', 'GIT_OPTIONAL_LOCKS', 'GIT_PAGER'].includes(key)) delete (processEnv as NodeJS.ProcessEnv)[key]
    const child = spawn('git', [...gitSafetyArgs, ...argv], { cwd, shell: false, env: processEnv, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let output = '', exceeded = false
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL') }, 5000)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; if (output.length > 512 * 1024) { exceeded = true; child.kill('SIGKILL') } })
    child.on('error', () => { clearTimeout(timer); reject(new PublicError('Git is unavailable or this directory cannot be accessed.')) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (exceeded || (code !== 0 && !allowedFailure)) reject(new PublicError('Git could not read this repository. Check its path, permissions and Git installation.'))
      else resolve(code === 0 ? preserveOutput ? output : output.trimEnd() : '')
    })
  })
}
export class WorkspaceService {
  constructor(private store: SettingsStore) {}
  async addDirectory(path: string): Promise<Workspace> {
    const canonical = realpathSync(path)
    if (!statSync(canonical).isDirectory()) throw new PublicError('Select an existing Git directory.')
    const bare = await gitProbe(canonical, ['rev-parse', '--is-bare-repository']) === 'true'
    const root = bare ? await gitProbe(canonical, ['rev-parse', '--absolute-git-dir']) : await gitProbe(canonical, ['rev-parse', '--show-toplevel'])
    return this.store.addWorkspace(realpathSync(root))
  }
  async resolve(id: string): Promise<Workspace> {
    const workspace = this.store.listWorkspaces().find((item) => item.id === id)
    if (!workspace) throw new PublicError('Choose an existing workspace first.')
    let canonical: string
    try { canonical = realpathSync(workspace.rootPath); if (!statSync(canonical).isDirectory()) throw new Error() } catch { throw new PublicError('Repository directory is missing or inaccessible. Remove this entry and add it again.') }
    if (canonical !== workspace.rootPath) throw new PublicError('Repository path changed. Add the repository again.')
    const bare = await gitProbe(canonical, ['rev-parse', '--is-bare-repository']) === 'true'
    const root = realpathSync(await gitProbe(canonical, bare ? ['rev-parse', '--absolute-git-dir'] : ['rev-parse', '--show-toplevel']))
    if (root !== canonical) throw new PublicError('This entry no longer identifies the original Git root. Add it again.')
    return workspace
  }
  async status(id: string): Promise<RepositoryStatus> {
    const workspace = await this.resolve(id)
    const cwd = workspace.rootPath
    const bare = await gitProbe(cwd, ['rev-parse', '--is-bare-repository']) === 'true'
    const [raw, head, branch, remoteNames] = await Promise.all([
      bare ? Promise.resolve('') : gitProbe(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']),
      gitProbe(cwd, ['rev-parse', '--verify', 'HEAD'], true), gitProbe(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], true), gitProbe(cwd, ['remote'])
    ])
    const remotes: RepositoryStatus['remotes'] = []
    for (const name of remoteNames.split('\n').filter(Boolean).slice(0, 30)) {
      const [fetchUrl, pushUrl] = await Promise.all([gitProbe(cwd, ['remote', 'get-url', '--', name], true), gitProbe(cwd, ['remote', 'get-url', '--push', '--', name], true)])
      remotes.push({ name, fetchUrl: redact(fetchUrl), pushUrl: redact(pushUrl) })
    }
    return { rootPath: cwd, branch: branch || 'Detached HEAD', head, clean: !raw.split('\n').some((line) => line && !line.startsWith('#')), bare, unborn: !head, detached: !branch, conflicts: raw.split('\n').some((line) => line.startsWith('u ')), upstream: raw.match(/^# branch.upstream (.+)$/m)?.[1], remotes }
  }
  async fingerprint(id: string): Promise<string> {
    const workspace = await this.resolve(id)
    const status = await this.status(id)
    const [refs, changes, staged, porcelain, config] = await Promise.all([
      gitProbe(workspace.rootPath, ['show-ref'], true), status.bare ? Promise.resolve('') : gitProbe(workspace.rootPath, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD'], true, true),
      status.bare ? Promise.resolve('') : gitProbe(workspace.rootPath, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv'], true, true),
      status.bare ? Promise.resolve('') : gitProbe(workspace.rootPath, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
      gitProbe(workspace.rootPath, ['config', '--local', '--list'], true, true)
    ])
    return JSON.stringify([status, refs, changes, staged, porcelain, config])
  }
}
