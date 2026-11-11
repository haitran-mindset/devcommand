import type { CommandSummary } from './commands'

interface Family {
  id: string
  title: string
  description: string
  prefix?: string
  ids?: string[]
  defaultId: string
}
export interface CommandGroup {
  id: string
  title: string
  description: string
  defaultId: string
  commands: CommandSummary[]
}
const families: Family[] = [
  { id: 'git.remotes', title: 'Git Remotes', description: 'View, add and update remote repositories', prefix: 'git.remote.', defaultId: 'git.remote.set-url' },
  { id: 'git.config', title: 'Git Config', description: 'Read and update Git configuration', prefix: 'git.config.', defaultId: 'git.config.list' },
  { id: 'git.branches', title: 'Git Branches', description: 'Create, switch and manage branches', prefix: 'git.branch.', defaultId: 'git.branch.list' },
  { id: 'git.changes', title: 'Git Changes', description: 'Inspect, stage and restore working files', ids: ['git.status', 'git.diff', 'git.stage', 'git.unstage', 'git.restore'], defaultId: 'git.status' },
  { id: 'git.sync', title: 'Git Sync', description: 'Fetch, pull and push repository changes', ids: ['git.fetch', 'git.pull', 'git.push'], defaultId: 'git.fetch' },
  { id: 'git.history', title: 'Git History', description: 'Inspect commits and reset changes', ids: ['git.log', 'git.reset.soft', 'git.reset.mixed', 'git.reset.hard'], defaultId: 'git.log' },
  { id: 'git.stash', title: 'Git Stash', description: 'Save and restore unfinished work', prefix: 'git.stash.', defaultId: 'git.stash.list' },
  { id: 'node', title: 'Node.js', description: 'Check Node version and runtime details', prefix: 'node.', defaultId: 'node.version' },
  { id: 'npm', title: 'npm', description: 'Check npm version and dependencies', prefix: 'npm.', defaultId: 'npm.version' },
  { id: 'flutter', title: 'Flutter', description: 'Inspect the SDK, toolchain and devices', prefix: 'flutter.', defaultId: 'flutter.version' },
  { id: 'system.files', title: 'Files & Directories', description: 'Inspect directories and disk usage', ids: ['system.pwd', 'system.list', 'system.disk'], defaultId: 'system.pwd' },
  { id: 'system.ports', title: 'Ports & Processes', description: 'Find listeners and manage port processes', ids: ['system.ports', 'system.port', 'system.port.process', 'system.port.stop'], defaultId: 'system.ports' },
  { id: 'permissions.files', title: 'File Permissions', description: 'Inspect permissions, chmod and chown', ids: ['permissions.inspect', 'permissions.chmod', 'permissions.chown'], defaultId: 'permissions.inspect' },
  { id: 'permissions.acl', title: 'File ACL', description: 'View, grant and remove access entries', prefix: 'permissions.acl.', defaultId: 'permissions.acl.view' },
  ...(['codex', 'claude', 'gemini', 'antigravity'] as const).map((tool) => ({ id: `ai.${tool}`, title: { codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', antigravity: 'Antigravity CLI' }[tool], description: 'Start, resume and inspect the developer CLI', prefix: `ai.${tool}.`, defaultId: `ai.${tool}.start` })),
]
export function commandFamily(command: Pick<CommandSummary, 'id' | 'title' | 'description'>): Omit<CommandGroup, 'commands'> {
  const family = families.find((family) => family.ids?.includes(command.id) || (family.prefix && command.id.startsWith(family.prefix)))
  return family ?? { id: command.id, title: command.title, description: command.description, defaultId: command.id }
}
export function groupCommands(commands: readonly CommandSummary[]): CommandGroup[] {
  const groups = new Map<string, CommandGroup>()
  for (const command of commands) {
    const identity = commandFamily(command)
    let group = groups.get(identity.id)
    if (!group) { group = { id: identity.id, title: identity.title, description: identity.description, defaultId: identity.defaultId, commands: [] }; groups.set(identity.id, group) }
    group.commands.push(command)
  }
  return [...groups.values()]
}
export function defaultCommand(group: CommandGroup): CommandSummary {
  return group.commands.find((command) => command.id === group.defaultId) ?? group.commands[0]
}
const labels: Record<string, string> = {
  'git.remote.set-url': 'Change URL', 'git.remote.add': 'Add remote', 'git.remote.remove': 'Remove remote', 'git.remote.list': 'List remotes', 'git.remote.rename': 'Rename remote',
  'git.config.list': 'List config', 'git.config.get': 'Get value', 'git.config.set': 'Set value',
  'git.branch.list': 'List branches', 'git.branch.create': 'Create branch', 'git.branch.switch': 'Switch branch', 'git.branch.delete': 'Delete branch', 'git.branch.rename': 'Rename branch',
  'git.status': 'Status', 'git.diff': 'Diff', 'git.stage': 'Stage file', 'git.unstage': 'Unstage file', 'git.restore': 'Restore tracked files',
  'git.fetch': 'Fetch', 'git.pull': 'Pull', 'git.push': 'Push', 'git.log': 'Commit log', 'git.reset.soft': 'Reset soft', 'git.reset.mixed': 'Reset mixed', 'git.reset.hard': 'Reset hard',
  'git.stash.list': 'List stashes', 'git.stash.push': 'Save tracked changes', 'git.stash.apply': 'Apply stash', 'git.stash.pop': 'Pop stash', 'git.stash.drop': 'Drop stash',
  'node.version': 'Version', 'node.runtime': 'Runtime details', 'npm.version': 'Version', 'npm.dependencies': 'Dependencies', 'flutter.version': 'Version', 'flutter.doctor': 'Doctor', 'flutter.devices': 'Devices',
  'system.pwd': 'Working directory', 'system.list': 'List files', 'system.disk': 'Disk usage', 'system.ports': 'All TCP listeners', 'system.port': 'Inspect listening port', 'system.port.process': 'Find process', 'system.port.stop': 'Stop process',
  'permissions.inspect': 'Inspect permissions', 'permissions.chmod': 'Change permissions (chmod)', 'permissions.chown': 'Change owner (chown)', 'permissions.acl.view': 'View ACL', 'permissions.acl.add': 'Add entry', 'permissions.acl.remove': 'Remove entry', 'permissions.acl.clear': 'Clear ACL',
}
export function actionLabel(command: CommandSummary): string {
  if (command.id.startsWith('ai.')) return ({ start: 'Start session', resume: 'Resume latest', help: 'Help', version: 'Version' } as Record<string, string>)[command.id.split('.').at(-1)!] ?? command.title
  return labels[command.id] ?? command.title
}

export function sharedActionParams(current: CommandSummary, next: CommandSummary, params: Record<string, string>): Record<string, string> {
  const shared: Record<string, string> = {}
  for (const parameter of next.parameters) {
    const previous = current.parameters.find((candidate) => candidate.key === parameter.key && !candidate.sensitive)
    const value = params[parameter.key]
    if (previous && !parameter.sensitive && typeof value === 'string' && (!parameter.options || parameter.options.includes(value))) shared[parameter.key] = value
  }
  return shared
}
