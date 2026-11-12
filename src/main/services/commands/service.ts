import { commandFamily } from '../../../shared/command-groups'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { GitService, validateGitPath } from '../git/service'
import { homedir } from 'node:os'
import type { CommandPreview, CommandRequest, CommandSummary, HistoryEntry, SearchRequest } from '../../../shared/commands'
import { commandRequestSchema, searchSchema, favoriteMoveSchema } from '../../../shared/commands'
import type { ExecutionSnapshot } from '../../../shared/runtime'
import type { SettingsStore } from '../../infrastructure/database/store'
import { PublicError, WorkspaceService, gitSafetyArgs, gitProbe } from '../workspace/service'
import { type Definition, displayCommand, expand, getDefinition, registry, validateParams } from './registry'
import { ManagedRunner, type ProcessDefinition } from '../execution/runner'
import { redact } from '../execution/redact'
import type { SshAction, SshAgentLifetime } from '../../../shared/extended'
import { keyGenerationArguments, type SshService } from '../ssh/service'
import type { TerminalManager } from '../terminal/manager'
import { fileOperation } from './files'
import { permissionArguments, permissionTarget } from './permissions'
import { inspectPortTarget } from './ports'
import { findExecutable, type ProbeRun } from '../cli/probe'

interface Prepared { definition: Definition; request: CommandRequest; process: ProcessDefinition; preview: CommandPreview; binding: string; initialCommand?: string; ssh?: { action: SshAction; token: string; expiresAt: string } }
interface Confirmation { binding: string; state: string; expires: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class CommandService {
  private confirmations = new Map<string, Confirmation>()
  private requests = new Map<string, CommandRequest>()
  private resources = new Map<string, string>()
  private busy = new Set<string>()
  private git: GitService
  constructor(private store: SettingsStore, private workspace: WorkspaceService, private runner: ManagedRunner, private now = () => Date.now(), private persistenceFailure = () => {}, private portProbe?: ProbeRun, private ssh?: SshService) { this.git = new GitService(workspace) }
  search(input: SearchRequest): CommandSummary[] {
    const request = searchSchema.parse(input)
    const favorites = this.store.favorites()
    const terms = request.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const matches = registry.filter((definition) => terms.every((term) => `${commandFamily(definition).title} ${definition.title} ${definition.description} ${definition.category} ${definition.aliases.join(' ')}`.toLowerCase().includes(term)) && (request.category === 'all' || request.category === definition.category) && (request.risk === 'all' || request.risk === definition.risk) && (request.platform === 'all' || definition.supportedPlatforms.includes(request.platform)) && (!request.favoritesOnly || favorites.includes(definition.id)))
      .map(({ executable, arguments: _arguments, mutation: _mutation, network: _network, projectFile: _projectFile, successExitCodes: _successExitCodes, ...definition }) => { void _arguments; void _mutation; void _network; void _projectFile; void _successExitCodes; return { ...definition, favorite: favorites.includes(definition.id), unavailableReason: !definition.supportedPlatforms.includes(process.platform as 'darwin' | 'win32' | 'linux') ? 'Unavailable on this operating system.' : !findExecutable(executable) ? `${executable} is not installed or absent from the application PATH.` : undefined } })
    if (!request.favoritesOnly) return matches
    const order = new Map(this.favoriteGroupOrder().map((id, index) => [id, index]))
    return matches.sort((a, b) => (order.get(commandFamily(a).id) ?? 200) - (order.get(commandFamily(b).id) ?? 200))
  }
  private favoriteGroupOrder(): string[] {
    const favorites = new Set(this.store.favorites())
    const current = [...new Set(registry.filter((entry) => favorites.has(entry.id)).map((entry) => commandFamily(entry).id))]
    const saved = this.store.favoriteOrder()
    return [...saved.filter((id) => current.includes(id)), ...current.filter((id) => !saved.includes(id))]
  }
  moveFavorite(input: unknown) {
    const { sourceId, targetId, placement } = favoriteMoveSchema.parse(input)
    const order = this.favoriteGroupOrder()
    if (!order.includes(sourceId) || !order.includes(targetId)) throw new PublicError('These favorite groups changed. Refresh and try again.')
    if (sourceId === targetId) return
    const next = order.filter((id) => id !== sourceId), target = next.indexOf(targetId)
    next.splice(target + (placement === 'after' ? 1 : 0), 0, sourceId)
    this.store.setFavoriteOrder(next)
  }
  async prepare(input: CommandRequest): Promise<Prepared> {
    const request = commandRequestSchema.parse(input)
    const definition = getDefinition(request.commandId)
    if (!definition.supportedPlatforms.includes(process.platform as 'darwin' | 'win32' | 'linux')) throw new PublicError('This built-in command is unavailable on this operating system.')
    const params = validateParams(definition, request.params)
    request.params = params
    if (definition.requiresRepository && !request.workspaceId) throw new PublicError('Choose a Git workspace before previewing this command.')
    const repository = request.workspaceId && definition.category !== 'SSH' ? await this.workspace.status(request.workspaceId) : undefined
    const cwd = repository?.rootPath ?? homedir()
    if (definition.id.startsWith('compare.')) {
      for (const key of ['leftFile', 'rightFile']) {
        try {
          params[key] = realpathSync(resolve(cwd, params[key]))
          if (!lstatSync(params[key]).isFile()) throw new Error()
        } catch { throw new PublicError('Choose two existing regular files. Relative paths start at the selected workspace or home directory.') }
      }
    }
    if (definition.id.startsWith('find.')) {
      try {
        params.searchRoot = realpathSync(resolve(cwd, params.searchRoot))
        if (!lstatSync(params.searchRoot).isDirectory()) throw new Error()
      } catch { throw new PublicError('Choose an existing readable search directory. Relative paths start at the workspace or home directory.') }
    }
    if (definition.category === 'Permissions' && repository?.bare) throw new PublicError('Choose a working-tree repository for permissions commands.')
    const executable = findExecutable(definition.executable)
    if (!executable) throw new PublicError(`${definition.executable} is not installed or absent from the application PATH.`)
    if (definition.id === 'ssh.key.generate' || ['ssh.agent.add', 'ssh.agent.remove', 'ssh.agent.clear'].includes(definition.id)) {
      const action = await this.sshAction(request)
      const preview = await this.ssh!.preview(action)
      const path = params.keyName ? join(this.ssh!.directory, params.keyName) : this.ssh!.directory
      const argv = action.kind === 'key.generate' ? keyGenerationArguments(action.keyType ?? 'ed25519', action.comment, path) : action.kind === 'agent.add' ? (action.lifetimeSeconds === 'unlimited' ? [path] : ['-t', action.lifetimeSeconds ?? '3600', path]) : action.kind === 'agent.remove' ? ['-d', join(this.ssh!.directory, action.publicKeyName)] : ['-D']
      return { definition, request, process: { commandId: definition.id, executable, argv, cwd: action.kind === 'agent.clear' ? homedir() : this.ssh!.directory, preview: preview.display }, preview: { display: preview.display, cwd: action.kind === 'agent.clear' ? homedir() : this.ssh!.directory, risk: definition.risk, consequences: preview.consequences }, binding: '', ssh: { action, token: preview.token, expiresAt: preview.expiresAt } }
    }
    let initialCommand: string | undefined
    let agentKeyState: string | undefined
    let agentDisplay: string | undefined
    if (definition.id === 'ssh.agent.start') {
      if (!findExecutable('ssh-agent')) throw new PublicError('ssh-agent is not installed or absent from the application PATH.')
      if (!findExecutable('ssh-add')) throw new PublicError('ssh-add is not installed or absent from the application PATH.')
      if (!this.ssh) throw new PublicError('SSH metadata is unavailable. Restart DevCommand.')
      const key = (await this.ssh.snapshot()).keys.find((entry) => entry.name === params.keyName + '.pub')
      if (!key?.privateAvailable) throw new PublicError('Choose an existing SSH key with a public .pub file and a private key with safe permissions.')
      agentKeyState = key.fingerprint
      const addCommand = displayCommand('ssh-add', [join(this.ssh.directory, params.keyName)])
      agentDisplay = 'eval "$(ssh-agent -s)" && ' + addCommand
      // Check ssh-agent's status before eval so startup failure cannot load a key into the inherited agent.
      initialCommand = 'devcommand_agent_env="$(ssh-agent -s)" && eval "$devcommand_agent_env" && ' + addCommand
    }
    const sshDirectoryArgs = definition.id === 'ssh.key.list' ? ['-la', this.ssh?.directory ?? join(homedir(), '.ssh')] : undefined
    let sourceState: string | undefined
    let zshSyntaxArgs: string[] | undefined
    if (definition.id === 'zsh.syntax' || definition.id === 'zsh.source') {
      const root = process.env.ZDOTDIR || homedir()
      if (!isAbsolute(root)) throw new PublicError('ZDOTDIR must be an absolute directory. Check your shell environment.')
      const path = join(root, definition.id === 'zsh.source' ? '.zshrc' : params.configFile)
      try { const file = lstatSync(path); if (!file.isFile() || file.isSymbolicLink() || file.size > 256 * 1024) throw new Error() }
      catch { throw new PublicError('Choose an existing regular Zsh startup file smaller than 256 KiB. Symlinks are not accepted.') }
      if (definition.id === 'zsh.source') {
        initialCommand = displayCommand('source', [path])
        const file = lstatSync(path, { bigint: true })
        sourceState = [path, file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].map(String).join(':')
      } else zshSyntaxArgs = ['-f', '-n', '--', path]
    }
    let sshFingerprintArgs: string[] | undefined
    if (definition.id === 'ssh.key.fingerprint') {
      if (!this.ssh) throw new PublicError('SSH metadata is unavailable. Restart DevCommand.')
      await this.ssh.publicKey(params.keyName + '.pub')
      sshFingerprintArgs = ['-E', 'sha256', '-lf', join(this.ssh.directory, params.keyName + '.pub')]
    }

    if (definition.projectFile) { try { if (!lstatSync(join(cwd, definition.projectFile)).isFile()) throw new Error() } catch { throw new PublicError(`The selected workspace requires ${definition.projectFile}.`) } }
    if (repository?.bare && /^(git\.(status|diff|restore|reset\.|stash\.|stage|unstage|branch.switch|pull))/.test(definition.id)) throw new PublicError('This operation requires a working tree; the selected repository is bare.')
    if (repository?.unborn && /git\.(reset\.|restore|stash\.|branch.create|log)/.test(definition.id)) throw new PublicError('This repository has no commits yet. Create the initial commit outside DevCommand first.')
    if (repository?.conflicts && ['git.pull', 'git.branch.switch', 'git.stash.apply', 'git.stash.pop'].includes(definition.id)) throw new PublicError('Resolve the existing merge conflicts before running this command.')
    if (params.name && repository) {
      const exists = repository.remotes.some((remote) => remote.name === params.name)
      if (definition.id === 'git.remote.add' && exists) throw new PublicError('That remote already exists. Use Change Git Remote URL instead.')
      if (definition.id !== 'git.remote.add' && !exists) throw new PublicError('That remote does not exist in the selected repository.')
      if (definition.network) {
        const remote = repository.remotes.find((item) => item.name === params.name)!
        validateParams(getDefinition('git.remote.set-url'), { name: params.name, url: definition.id === 'git.push' ? remote.pushUrl : remote.fetchUrl })
      }
      if (params.newName && repository.remotes.some((remote) => remote.name === params.newName)) throw new PublicError('The new remote name is already in use.')
    }
    if (params.branch && repository) {
      if (!await gitProbe(cwd, ['check-ref-format', '--branch', params.branch], true)) throw new PublicError('Invalid Git branch name.')
      if (['git.branch.switch', 'git.branch.delete', 'git.branch.rename', 'git.push'].includes(definition.id) && !await gitProbe(cwd, ['rev-parse', '--verify', `refs/heads/${params.branch}`], true)) throw new PublicError('That local branch does not exist.')
      if (definition.id === 'git.branch.delete' && repository.branch === params.branch) throw new PublicError('Switch away from the current branch before deleting it.')
      if (definition.id === 'git.branch.create' && await gitProbe(cwd, ['rev-parse', '--verify', `refs/heads/${params.branch}`], true)) throw new PublicError('That local branch already exists.')
    }
    if (repository && ['git.branch.delete', 'git.branch.rename', 'git.branch.switch'].includes(definition.id)) {
      const branches = (await this.git.snapshot({ workspaceId: request.workspaceId!, section: 'branches' })).branches
      const target = branches.find((entry) => entry.name === params.branch)
      if (target?.worktreePath && (definition.id === 'git.branch.delete' || !target.current)) throw new PublicError('This branch is checked out in a worktree. Switch it there before changing it.')
      if (definition.id === 'git.branch.delete' && !target?.merged) throw new PublicError('This branch has unmerged commits. Merge or back up those commits first; force deletion is not available.')
      if (params.newBranch && (!await gitProbe(cwd, ['check-ref-format', '--branch', params.newBranch], true) || branches.some((entry) => entry.name === params.newBranch))) throw new PublicError('Choose a valid new branch name that is not already in use.')
    }
    let originalPath: string | undefined
    if (params.path) {
      validateGitPath(params.path)
      const file = (await this.git.files(request.workspaceId!)).find((entry) => entry.path === params.path)
      originalPath = file?.originalPath
      if (definition.id === 'git.unstage' && originalPath) validateGitPath(originalPath)
      if (!file) throw new PublicError('This path is no longer in the change list. Refresh before proceeding.')
      if (definition.id === 'git.unstage' && (file.untracked || file.indexStatus === ' ')) throw new PublicError('This file has no staged changes.')
      if (definition.id === 'git.stage' && !file.untracked && file.worktreeStatus === ' ' && !file.conflicted) throw new PublicError('This file has no unstaged changes.')
    }
    if (definition.id === 'git.stash.push' && !(await this.git.files(request.workspaceId!)).some((file) => !file.untracked)) throw new PublicError('There are no tracked changes to stash. Untracked files are not included.')
    if (repository && ['git.stash.apply', 'git.stash.pop'].includes(definition.id) && !repository.clean) throw new PublicError('Use a clean working tree before applying or popping a stash.')
    if (params.key === 'core.autocrlf' && params.value && !['true', 'false', 'input'].includes(params.value)) throw new PublicError('core.autocrlf must be true, false or input.')
    if (params.key === 'init.defaultBranch' && params.value && (params.value.startsWith('-') || !await gitProbe(cwd, ['check-ref-format', '--branch', params.value], true))) throw new PublicError('Use a valid Git default branch name.')
    if (params.key === 'pull.rebase' && params.value && !['true', 'false', 'merges'].includes(params.value)) throw new PublicError('pull.rebase must be true, false or merges.')
    if (params.ref && !await gitProbe(cwd, ['rev-parse', '--verify', `${params.ref}^{commit}`], true)) throw new PublicError('The target commit does not exist.')
    if (params.stash) {
      const oid = await gitProbe(cwd, ['rev-parse', '--verify', params.stash], true)
      if (!oid) throw new PublicError('That stash does not exist.')
      if (params.expectedOid && params.expectedOid !== oid) throw new PublicError('The selected stash changed since it was displayed. Refresh the stash list and review the intended entry.')
    }
    const files = definition.id.startsWith('files.') ? fileOperation(cwd, definition.id, params) : undefined
    if (files && repository?.bare) throw new PublicError('Choose a working-tree repository for file operations.')
    const permission = definition.category === 'Permissions' ? permissionTarget(cwd, params.target, definition.mutation) : undefined
    const portTarget = definition.id === 'system.port.stop' ? await inspectPortTarget(this.portProbe, params.port, params.pid) : undefined
    const findArgs = definition.id.startsWith('find.') ? expand(definition, params) : undefined
    if (findArgs && params.maxDepth !== 'all') findArgs.splice(2, 0, '-maxdepth', params.maxDepth)
    const argv = sshDirectoryArgs ?? findArgs ?? files?.argv ?? zshSyntaxArgs ?? sshFingerprintArgs ?? (permission ? permissionArguments(definition, params, permission.target) : portTarget ? ['-TERM', portTarget.pid] : definition.id === 'git.unstage' && repository?.unborn ? ['rm', '--cached', '--force', '--', params.path] : definition.id === 'git.unstage' && originalPath ? ['restore', '--staged', '--', params.path, originalPath] : expand(definition, params))
    const executionArgs = definition.executable === 'git' && definition.requiresRepository ? [...gitSafetyArgs, ...argv] : argv
    const safeParams = { ...params }
    for (const parameter of definition.parameters) if (parameter.sensitive) safeParams[parameter.key] = '[REDACTED]'
    const safeArgs = sshDirectoryArgs || findArgs || files || zshSyntaxArgs || sshFingerprintArgs || permission || portTarget ? argv : definition.executable === 'git' && definition.requiresRepository ? [...gitSafetyArgs, ...(definition.id === 'git.unstage' && (repository?.unborn || originalPath) ? argv : expand(definition, safeParams))] : expand(definition, safeParams)
    const display = agentDisplay ?? initialCommand ?? redact(displayCommand(definition.executable, safeArgs))
    const consequences: string[] = []
    if (definition.id.startsWith('compare.')) consequences.push('Read-only comparison. Relative file paths start at the selected workspace or home directory; absolute paths are also supported. Symbolic links resolve to their regular-file targets.', 'Exit 0 means equal under the selected comparison rules; exit 1 means different. Both are successful comparisons. Higher exit codes indicate an error. An equal result usually has no output.', 'Diff output may contain file contents and is saved in Execution History. Large comparisons are subject to the managed execution timeout and output limits.')
    if (files) consequences.push(...files.consequences, 'Paths are checked inside the selected repository at preview and run. Symbolic links and .git metadata are refused. No sudo or recursive operations are used.', 'Do not change the same paths in another tool while this operation runs. CLI filesystem operations are not atomically isolated from concurrent filesystem changes.')
    if (definition.id.startsWith('find.')) consequences.push('Reads names and metadata only; symbolic links inside the search directory are not followed. Results include hidden directories, limited by maximum depth when selected. The default / searches from the filesystem root without a depth limit; access follows your existing OS permissions.', 'An empty result is successful. Permission errors can produce partial results and a failed exit status. Large searches may hit the managed execution timeout; narrow the directory or depth.')
    if (permission) consequences.push(`Target: ${permission.target}. Current mode: ${permission.mode}; owner UID:GID: ${permission.owner}.`, definition.mutation ? 'Changes this path only, without recursion or automatic sudo. Access changes may affect your tools and collaborators.' : 'Reads permissions without changing this path.')
    else if (definition.category === 'SSH') {
      if (definition.id === 'ssh.agent.start') consequences.push('Starts a new agent, then adds the selected key in the same terminal tab. Existing terminals and the app agent environment are unchanged.', 'Key loading runs only if agent startup succeeds. Enter any key passphrase in the terminal. No lifetime flag is set; the key remains until removed or the agent exits. Close this new agent with ssh-agent -k when finished.')
      else if (definition.id === 'ssh.key.list') consequences.push('Lists SSH directory filenames and metadata only. Does not read private key contents, create keys or modify agent identities.')
      else if (definition.id === 'ssh.github.test') consequences.push('Runs ssh -T git@github.com using your existing SSH configuration and agent. Does not start an agent or add keys.', 'OpenSSH may prompt to trust a new host or unlock a key. GitHub can return exit code 1 after successful authentication; read its message.')
      else if (definition.id === 'ssh.connect') consequences.push('Opens an interactive SSH connection using your OpenSSH configuration and OS agent. Enter any password or passphrase in the terminal.', 'Session input/output is not saved in Execution History. No remote command is submitted by DevCommand.')
      else if (definition.id === 'ssh.test') consequences.push('Tests a direct hostname/IP, bypassing SSH config aliases, proxy and local commands. Unknown/changed host keys are refused; prompts are disabled.', 'Git providers may return a nonzero exit code after successful authentication. Read the diagnostic output instead of relying only on the exit code.')
      else if (definition.id.startsWith('ssh.agent.')) consequences.push('Reads the OS agent without loading, removing or changing identities. No identities (exit 1) is an empty result; an unreachable agent remains an error.')
    }
    else if (definition.id.startsWith('zsh.')) {
      if (definition.id === 'zsh.source') consequences.push('Opens a new interactive Zsh tab with -f, then sources the displayed .zshrc once in that shell. Aliases, functions and environment changes stay available in the new tab; existing tabs are unchanged.', 'Sourcing executes the commands in this file with your normal OS permissions. DevCommand does not edit it. Terminal input/output is not saved in Execution History.')
      else if (definition.id === 'zsh.start') consequences.push('Starts an interactive Zsh with your existing startup files. Those files may run commands using your normal OS permissions.', 'Ctrl+C interrupts the foreground job and keeps this shell tab open. No command is submitted automatically.')
      else if (definition.id === 'zsh.clean') consequences.push('Starts interactive Zsh with -f, skipping user startup files. The system /etc/zshenv can still be read.', 'Uses the inherited environment; it is not an OS sandbox or a reset of your environment variables.')
      else consequences.push('Uses a fresh Zsh with -f rather than the state of an existing terminal tab. User startup files are skipped; the system /etc/zshenv may still run.')
      if (definition.id === 'zsh.syntax') consequences.push('Parses only the selected startup file with -n; it does not execute commands from that file or modify it. Syntax-check output is omitted from persistent history.')
    }
    else if (definition.id.startsWith('ngrok.')) {
      if (definition.interactive) consequences.push('Publishes the selected service or configured endpoints through your ngrok account. Access follows your existing ngrok endpoint policy.', 'Uses your existing ngrok credentials and configuration. Some endpoint types or custom domains require account entitlements.', 'Ctrl+C stops the agent and returns to the shell in this tab. Session output is not saved in Execution History.')
      else consequences.push('Inspects the installed ngrok agent or validates its configuration without starting an endpoint.')
    }
    else if (definition.id.startsWith('cloudflared.')) {
      if (['cloudflared.quick', 'cloudflared.run'].includes(definition.id)) consequences.push('Publishes the configured service through Cloudflare. Anyone allowed by your tunnel access settings may reach it.', 'Runs in the terminal until stopped with Ctrl+C or the session is closed. Tunnel URLs and session output are not saved in Execution History.')
      else if (definition.id === 'cloudflared.login') consequences.push('Opens Cloudflare authentication in your browser. cloudflared saves its account certificate in its own configuration directory.')
      else if (definition.id === 'cloudflared.create') consequences.push('Creates a tunnel in your Cloudflare account and writes its credentials to the cloudflared configuration directory.')
      else if (definition.network) consequences.push('Reads tunnel metadata from your Cloudflare account using your existing cloudflared credentials.')
    }
    else if (definition.interactive) consequences.push('Opens the installed AI CLI in an interactive terminal for the selected repository. It may read project instructions, contact its provider and edit files using its own permission settings.', 'No prompt is submitted by DevCommand. Session input/output is not saved in Execution History; the CLI manages its own session data.')
    else if (portTarget) consequences.push(`Send SIGTERM to PID ${portTarget.pid}, listening on TCP port ${params.port}.`, redact(`Process: ${portTarget.identity}`), 'Unsaved work in this process may be lost. SIGTERM requests a normal shutdown; it does not force-kill the process.')
    else if (definition.mutation) consequences.push(definition.category === 'Flutter' ? 'Flutter may initialize or update SDK caches, contact SDK/device services and trigger OS permission prompts. Analytics are suppressed for this invocation; existing analytics preferences are unchanged.' : `This ${definition.risk} operation changes ${params.scope === 'global' ? 'your global Git configuration' : 'the selected repository'}.`)
    if (definition.id === 'git.remote.set-url') consequences.push(`Remote ${params.name}: ${repository?.remotes.find((remote) => remote.name === params.name)?.fetchUrl} → ${params.url}`)
    if (definition.id === 'git.remote.remove') consequences.push('The remote configuration and its tracking references will be removed. The server repository is not deleted.')
    if (definition.id === 'git.restore' || definition.id === 'git.reset.hard') consequences.push('Tracked file changes may be permanently lost. Hard reset may also delete untracked files that obstruct tracked paths. There is no automatic backup.')
    if (definition.id === 'git.reset.mixed') consequences.push('Moves HEAD and resets the index. Staged changes become unstaged.')
    if (definition.id === 'git.reset.soft') consequences.push('Moves HEAD to the target commit; files and index remain unchanged.')
    if (definition.id === 'git.branch.delete') consequences.push(`Deletes merged branch ${params.branch}. Unmerged or checked-out branches are refused; force deletion is unavailable.`)
    if (definition.id === 'git.branch.rename') consequences.push(`Renames ${params.branch} to ${params.newBranch}. Remote branches are not renamed.`)
    if (definition.id === 'git.stage' && repository?.conflicts) consequences.push('Staging a conflicted file marks it resolved in the index. Review its content and remove all conflict markers first; DevCommand does not resolve conflicts automatically.')
    if (definition.id === 'git.stage') consequences.push(`Stages the current content/deletion of ${params.path}. This does not create a commit.`)
    if (definition.id === 'git.unstage' && repository?.conflicts) consequences.push('Unstaging can clear unmerged index entries while leaving conflict markers in the file. Resolve the working-tree content before committing.')
    if (definition.id === 'git.unstage') consequences.push(`Unstages ${params.path}; its working-tree content is preserved.${repository?.unborn ? ' The index entry is removed because there is no initial commit yet.' : ''}`)
    if (params.stash) consequences.push(`Selected stash: ${params.stash}, commit ${await gitProbe(cwd, ['rev-parse', '--verify', params.stash])}.`)
    if (definition.id === 'git.stash.drop') consequences.push('Permanently removes this saved stash without applying it. There is no automatic backup or undo in DevCommand.')
    if (definition.id === 'git.stash.pop') consequences.push('Applies the stash and drops it only on success. On conflict, Git retains the stash; resolve conflicts manually.')
    if (definition.network && definition.category === 'Git') consequences.push('Connects to the configured remote using your local Git/SSH authentication. Network commands may take up to 60 seconds.')
    if (repository && !repository.clean && definition.mutation && !portTarget && !permission && !definition.interactive) consequences.push('This working tree contains local changes. Review and back up your work before continuing.')
    if (definition.executable === 'git' && definition.requiresRepository) consequences.push('Managed Git disables hooks, fsmonitor, external/file transports and interactive paging.')
    return { definition, request, initialCommand, process: { commandId: definition.id, executable, argv: executionArgs, cwd, preview: display, timeoutMs: definition.network || definition.id.startsWith('find.') ? 60000 : 10000, successExitCodes: definition.successExitCodes, secrets: definition.parameters.filter((parameter) => parameter.sensitive).map((parameter) => params[parameter.key]) }, preview: { display, cwd, risk: definition.risk, consequences, repository }, binding: digest(JSON.stringify([definition.id, params, request.workspaceId ?? null, executable, portTarget, permission?.state, sourceState, files?.state, agentKeyState])) }
  }
  private async state(request: CommandRequest): Promise<string> {
    const definition = getDefinition(request.commandId)
    const params = validateParams(definition, request.params)
    if (definition.category === 'SSH') return digest(JSON.stringify(params))
    if (definition.id.startsWith('files.')) {
      if (!request.workspaceId) throw new PublicError('Choose a repository for file operations.')
      return digest(fileOperation((await this.workspace.resolve(request.workspaceId)).rootPath, definition.id, params).state)
    }
    if (definition.category === 'Permissions') {
      if (!request.workspaceId) throw new PublicError('Choose a repository before inspecting permissions.')
      const root = (await this.workspace.resolve(request.workspaceId)).rootPath
      return digest(permissionTarget(root, params.target, definition.mutation).state)
    }
    if (definition.id === 'system.port.stop') return digest(JSON.stringify(await inspectPortTarget(this.portProbe, params.port, params.pid)))
    const repository = request.workspaceId ? await this.workspace.fingerprint(request.workspaceId) : ''
    const globalValue = params.scope === 'global' && params.key ? await gitProbe((request.workspaceId ? await this.workspace.resolve(request.workspaceId) : { rootPath: homedir() }).rootPath, ['config', '--global', '--get', params.key], true, true) : ''
    const cwd = request.workspaceId ? (await this.workspace.resolve(request.workspaceId)).rootPath : homedir()
    const stashOid = params.stash ? await gitProbe(cwd, ['rev-parse', '--verify', params.stash], true) : ''
    let pathState = ''
    if (params.path) {
      validateGitPath(params.path)
      try { const stat = lstatSync(join(cwd, params.path), { bigint: true }); pathState = [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':') } catch { pathState = 'missing' }
    }
    return digest(JSON.stringify([repository, globalValue, stashOid, pathState]))
  }
  async preview(request: CommandRequest): Promise<CommandPreview> {
    const parsed = commandRequestSchema.parse(request)
    if (parsed.commandId === 'ssh.key.generate' || ['ssh.agent.add', 'ssh.agent.remove', 'ssh.agent.clear'].includes(parsed.commandId)) {
      const prepared = await this.prepare(parsed)
      return { ...prepared.preview, confirmationToken: prepared.ssh!.token, expiresAt: prepared.ssh!.expiresAt }
    }
    const before = getDefinition(parsed.commandId).mutation && (parsed.workspaceId || parsed.commandId === 'system.port.stop') ? await this.state(parsed) : undefined
    const prepared = await this.prepare(request)
    if (!prepared.definition.mutation) return prepared.preview
    const state = await this.state(prepared.request)
    if (before !== undefined && before !== state) throw new PublicError('Target state changed while preparing the preview. Try again.')
    for (const [token, confirmation] of this.confirmations) if (confirmation.expires <= this.now()) this.confirmations.delete(token)
    while (this.confirmations.size >= 64) this.confirmations.delete(this.confirmations.keys().next().value!)
    const token = randomUUID(), expires = this.now() + 60000
    this.confirmations.set(token, { binding: prepared.binding, state, expires })
    return { ...prepared.preview, confirmationToken: token, expiresAt: new Date(expires).toISOString() }
  }
  private async resource(request: CommandRequest): Promise<string> {
    if (request.commandId.startsWith('ssh.')) return 'ssh-cli'
    if (request.commandId === 'system.port.stop') return `port:${request.params.port}`
    if (request.params.scope === 'global') return 'global-config'
    if (!request.workspaceId) return 'home'
    const workspace = await this.workspace.resolve(request.workspaceId)
    const commonDir = await gitProbe(workspace.rootPath, ['rev-parse', '--git-common-dir'])
    return realpathSync(resolve(workspace.rootPath, commonDir))
  }
  async execute(request: CommandRequest, token?: string): Promise<{ executionId: string }> {
    // Consume before the first await so concurrent submissions cannot reuse a token.
    const confirmation = token ? this.confirmations.get(token) : undefined
    if (token) this.confirmations.delete(token)
    const lock = await this.resource(request)
    if (this.busy.has(lock)) throw new PublicError('Another command is being validated for this workspace. Try again.')
    this.busy.add(lock)
    try {
      if ([...this.requests.keys()].some((id) => this.resources.get(id) === lock && this.runner.list().some((job) => job.id === id && !job.finishedAt))) throw new PublicError('Wait for the current command in this workspace to finish.')
      const prepared = await this.prepare(request)
      if (prepared.definition.interactive) throw new PublicError('Open this command in an interactive terminal instead of managed execution.')
      if (prepared.definition.mutation) {
        if (!confirmation || confirmation.expires <= this.now() || confirmation.binding !== prepared.binding) throw new PublicError('Confirmation is missing, expired or does not match this request. Preview again.')
        if (confirmation.state !== await this.state(prepared.request)) throw new PublicError('Repository, configuration or process state changed after preview. Review a fresh preview before running.')
      }
      const executionId = this.runner.execute(prepared.process)
      const storedRequest = { ...prepared.request, params: { ...prepared.request.params } }
      let rerunnable = true
      for (const parameter of prepared.definition.parameters) if (parameter.sensitive) { storedRequest.params[parameter.key] = ''; rerunnable = false }
      this.requests.set(executionId, storedRequest)
      this.resources.set(executionId, lock)
      const snapshot = this.runner.list().find((entry) => entry.id === executionId)!
      this.save({ request: storedRequest, execution: this.persistedSnapshot(snapshot), rerunnable })
      return { executionId }
    } finally { this.busy.delete(lock) }
  }
  private async sshAction(input: CommandRequest): Promise<SshAction> {
    const request = commandRequestSchema.parse(input)
    const params = validateParams(getDefinition(request.commandId), request.params)
    if (!this.ssh) throw new PublicError('SSH metadata is unavailable. Restart DevCommand.')
    if (request.commandId === 'ssh.key.generate') return { kind: 'key.generate', name: params.keyName, comment: params.comment, ...(params.keyType === 'rsa' ? { keyType: 'rsa' as const } : {}) }
    if (request.commandId === 'ssh.agent.clear') return { kind: 'agent.clear' }
    if (!['ssh.agent.add', 'ssh.agent.remove'].includes(request.commandId)) throw new PublicError('Unsupported SSH key action.')
    const snapshot = await this.ssh.snapshot()
    const key = snapshot.keys.find((key) => key.name === params.keyName + '.pub')
    if (!key) throw new PublicError('This public key is unavailable. Refresh SSH Manager and check the key basename.')
    return request.commandId === 'ssh.agent.remove' ? { kind: 'agent.remove', publicKeyName: key.name, fingerprint: key.fingerprint } : { kind: 'agent.add', publicKeyName: key.name, fingerprint: key.fingerprint, lifetimeSeconds: params.lifetimeSeconds as SshAgentLifetime }
  }
  async launch(request: CommandRequest, token: string, terminals: TerminalManager) {
    if (request.commandId === 'ssh.key.generate' || ['ssh.agent.add', 'ssh.agent.remove', 'ssh.agent.clear'].includes(request.commandId)) {
      const action = await this.sshAction(request)
      const result = await this.ssh!.execute(action, token, terminals, this.runner)
      if (result.kind !== 'terminal') throw new PublicError('Unable to open the SSH terminal action.')
      return result.session
    }
    const confirmation = this.confirmations.get(token)
    this.confirmations.delete(token)
    const prepared = await this.prepare(request)
    if (!prepared.definition.interactive) throw new PublicError('This command is not an interactive CLI session.')
    if (!confirmation || confirmation.expires <= this.now() || confirmation.binding !== prepared.binding) throw new PublicError('Confirmation is missing, expired or does not match this session. Preview again.')
    if (confirmation.state !== await this.state(prepared.request)) throw new PublicError('The project changed after preview. Review the session again.')
    return terminals.startProgram({ executable: prepared.process.executable, argv: prepared.process.argv, cwd: prepared.process.cwd, label: prepared.definition.title, ...(prepared.initialCommand ? { initialCommand: prepared.initialCommand } : {}), keepShell: !prepared.definition.id.startsWith('zsh.') && prepared.definition.id !== 'ssh.agent.start' })
  }
  private readonly clearedHistory = new Set<string>()
  clearHistory() {
    this.store.clearHistory()
    for (const id of this.requests.keys()) this.clearedHistory.add(id)
  }
  private save(entry: HistoryEntry) {
    try { this.store.saveHistory(entry) } catch { this.persistenceFailure() }
  }
  private persistedSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
    const omit = snapshot.commandId.startsWith('git.config.') || snapshot.commandId === 'zsh.syntax'
    return { ...snapshot, preview: redact(snapshot.preview), output: omit ? [] : snapshot.output.map((chunk) => ({ ...chunk, data: redact(chunk.data) })), error: snapshot.error ? redact(snapshot.error) : undefined }
  }
  completed(id: string) {
    const snapshot = this.runner.list().find((entry) => entry.id === id)
    const request = this.requests.get(id)
    if (!snapshot || !request || !snapshot.finishedAt) return
    const definition = getDefinition(request.commandId)
    if (!this.clearedHistory.delete(id)) this.save({ request, execution: this.persistedSnapshot(snapshot), rerunnable: !definition.parameters.some((parameter) => parameter.sensitive) })
    this.requests.delete(id)
    this.resources.delete(id)
  }
  history(): HistoryEntry[] {
    return this.store.history().map((entry) => {
      const commandAvailable = registry.some((definition) => definition.id === entry.request.commandId)
      return { ...entry, commandAvailable, rerunnable: entry.rerunnable && commandAvailable }
    })
  }
  favorite(id: string, favorite: boolean) { getDefinition(id); this.store.favoriteCommand(id, favorite) }
  clearConfirmations() { this.confirmations.clear() }
}
