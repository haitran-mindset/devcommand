import { commandFamily } from '../../../shared/command-groups'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { GitService, validateGitPath } from '../git/service'
import { homedir } from 'node:os'
import type { CommandPreview, CommandRequest, CommandSummary, HistoryEntry, SearchRequest } from '../../../shared/commands'
import { commandRequestSchema, searchSchema } from '../../../shared/commands'
import type { ExecutionSnapshot } from '../../../shared/runtime'
import type { SettingsStore } from '../../infrastructure/database/store'
import { PublicError, WorkspaceService, gitSafetyArgs, gitProbe } from '../workspace/service'
import { type Definition, displayCommand, expand, getDefinition, registry, validateParams } from './registry'
import { ManagedRunner, type ProcessDefinition } from '../execution/runner'
import { redact } from '../execution/redact'
import type { TerminalManager } from '../terminal/manager'
import { permissionArguments, permissionTarget } from './permissions'
import { inspectPortTarget } from './ports'
import { findExecutable, type ProbeRun } from '../cli/probe'

interface Prepared { definition: Definition; request: CommandRequest; process: ProcessDefinition; preview: CommandPreview; binding: string }
interface Confirmation { binding: string; state: string; expires: number }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class CommandService {
  private confirmations = new Map<string, Confirmation>()
  private requests = new Map<string, CommandRequest>()
  private resources = new Map<string, string>()
  private busy = new Set<string>()
  private git: GitService
  constructor(private store: SettingsStore, private workspace: WorkspaceService, private runner: ManagedRunner, private now = () => Date.now(), private persistenceFailure = () => {}, private portProbe?: ProbeRun) { this.git = new GitService(workspace) }
  search(input: SearchRequest): CommandSummary[] {
    const request = searchSchema.parse(input)
    const favorites = this.store.favorites()
    const terms = request.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return registry.filter((definition) => terms.every((term) => `${commandFamily(definition).title} ${definition.title} ${definition.description} ${definition.category} ${definition.aliases.join(' ')}`.toLowerCase().includes(term)) && (request.category === 'all' || request.category === definition.category) && (request.risk === 'all' || request.risk === definition.risk) && (request.platform === 'all' || definition.supportedPlatforms.includes(request.platform)) && (!request.favoritesOnly || favorites.includes(definition.id)))
      .map(({ executable, arguments: _arguments, mutation: _mutation, network: _network, projectFile: _projectFile, ...definition }) => { void _arguments; void _mutation; void _network; void _projectFile; return { ...definition, favorite: favorites.includes(definition.id), unavailableReason: !definition.supportedPlatforms.includes(process.platform as 'darwin' | 'win32' | 'linux') ? 'Unavailable on this operating system.' : !findExecutable(executable) ? `${executable} is not installed or absent from the application PATH.` : undefined } })
  }
  async prepare(input: CommandRequest): Promise<Prepared> {
    const request = commandRequestSchema.parse(input)
    const definition = getDefinition(request.commandId)
    if (!definition.supportedPlatforms.includes(process.platform as 'darwin' | 'win32' | 'linux')) throw new PublicError('This built-in command is unavailable on this operating system.')
    const params = validateParams(definition, request.params)
    request.params = params
    if (definition.requiresRepository && !request.workspaceId) throw new PublicError('Choose a Git workspace before previewing this command.')
    const repository = request.workspaceId ? await this.workspace.status(request.workspaceId) : undefined
    const cwd = repository?.rootPath ?? homedir()
    if (definition.category === 'Permissions' && repository?.bare) throw new PublicError('Choose a working-tree repository for permissions commands.')
    const executable = findExecutable(definition.executable)
    if (!executable) throw new PublicError(`${definition.executable} is not installed or absent from the application PATH.`)
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
    const permission = definition.category === 'Permissions' ? permissionTarget(cwd, params.target, definition.mutation) : undefined
    const portTarget = definition.id === 'system.port.stop' ? await inspectPortTarget(this.portProbe, params.port, params.pid) : undefined
    const argv = permission ? permissionArguments(definition, params, permission.target) : portTarget ? ['-TERM', portTarget.pid] : definition.id === 'git.unstage' && repository?.unborn ? ['rm', '--cached', '--force', '--', params.path] : definition.id === 'git.unstage' && originalPath ? ['restore', '--staged', '--', params.path, originalPath] : expand(definition, params)
    const executionArgs = definition.executable === 'git' && definition.requiresRepository ? [...gitSafetyArgs, ...argv] : argv
    const safeParams = { ...params }
    for (const parameter of definition.parameters) if (parameter.sensitive) safeParams[parameter.key] = '[REDACTED]'
    const safeArgs = permission || portTarget ? argv : definition.executable === 'git' && definition.requiresRepository ? [...gitSafetyArgs, ...(definition.id === 'git.unstage' && (repository?.unborn || originalPath) ? argv : expand(definition, safeParams))] : expand(definition, safeParams)
    const display = redact(displayCommand(definition.executable, safeArgs))
    const consequences: string[] = []
    if (permission) consequences.push(`Target: ${permission.target}. Current mode: ${permission.mode}; owner UID:GID: ${permission.owner}.`, definition.mutation ? 'Changes this path only, without recursion or automatic sudo. Access changes may affect your tools and collaborators.' : 'Reads permissions without changing this path.')
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
    return { definition, request, process: { commandId: definition.id, executable, argv: executionArgs, cwd, preview: display, timeoutMs: definition.network ? 60000 : 10000, secrets: definition.parameters.filter((parameter) => parameter.sensitive).map((parameter) => params[parameter.key]) }, preview: { display, cwd, risk: definition.risk, consequences, repository }, binding: digest(JSON.stringify([definition.id, params, request.workspaceId ?? null, executable, portTarget, permission?.state])) }
  }
  private async state(request: CommandRequest): Promise<string> {
    const definition = getDefinition(request.commandId)
    const params = validateParams(definition, request.params)
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
      if (prepared.definition.interactive) throw new PublicError('Open this AI CLI in an interactive terminal instead of managed execution.')
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
  async launch(request: CommandRequest, token: string, terminals: TerminalManager) {
    const confirmation = this.confirmations.get(token)
    this.confirmations.delete(token)
    const prepared = await this.prepare(request)
    if (!prepared.definition.interactive) throw new PublicError('This command is not an interactive CLI session.')
    if (!confirmation || confirmation.expires <= this.now() || confirmation.binding !== prepared.binding) throw new PublicError('Confirmation is missing, expired or does not match this session. Preview again.')
    if (confirmation.state !== await this.state(prepared.request)) throw new PublicError('The project changed after preview. Review the session again.')
    return terminals.startProgram({ executable: prepared.process.executable, argv: prepared.process.argv, cwd: prepared.process.cwd, label: prepared.definition.title })
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
    const omit = snapshot.commandId.startsWith('git.config.')
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
  history(): HistoryEntry[] { return this.store.history() }
  favorite(id: string, favorite: boolean) { getDefinition(id); this.store.favoriteCommand(id, favorite) }
  clearConfirmations() { this.confirmations.clear() }
}
