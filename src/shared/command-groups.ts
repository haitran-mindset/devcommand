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
  { id: 'system.information', title: 'System Information', description: 'Inspect the current user, hostname, operating system, uptime and date', ids: ['system.whoami', 'system.hostname', 'system.uname', 'system.uptime', 'system.date'], defaultId: 'system.whoami' },
  { id: 'system.tool-versions', title: 'Tool Versions', description: 'Check installed Python and Docker CLI versions', ids: ['python.version', 'docker.version'], defaultId: 'python.version' },
  { id: 'compare', title: 'File Comparison', description: 'Compare text files or bytes without modifying either file', prefix: 'compare.', defaultId: 'compare.unified' },
  { id: 'files', title: 'File Operations', description: 'Create, copy, move, rename and remove files', prefix: 'files.', defaultId: 'files.create' },
  { id: 'find', title: 'Find', description: 'Search files and directories by name, size or modification time', prefix: 'find.', defaultId: 'find.name' },
  { id: 'zsh', title: 'Zsh', description: 'Open shells, inspect defaults and check startup syntax', prefix: 'zsh.', defaultId: 'zsh.start' },
  { id: 'ngrok', title: 'ngrok', description: 'Publish local services and run configured endpoints', prefix: 'ngrok.', defaultId: 'ngrok.http' },
  { id: 'cloudflared', title: 'Cloudflare Tunnel', description: 'Share local services and manage Cloudflare tunnels', prefix: 'cloudflared.', defaultId: 'cloudflared.quick' },
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
  { id: 'ssh.connection', title: 'SSH', description: 'Connect and inspect OpenSSH', ids: ['ssh.connect', 'ssh.test', 'ssh.version', 'ssh.help'], defaultId: 'ssh.connect' },
  { id: 'ssh.keys', title: 'SSH Keys', description: 'Generate keys and inspect fingerprints', prefix: 'ssh.key.', defaultId: 'ssh.key.generate' },
  { id: 'ssh.agent', title: 'SSH Agent', description: 'Inspect, load and remove agent identities', prefix: 'ssh.agent.', defaultId: 'ssh.agent.list' },
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
  'compare.unified': 'Unified diff', 'compare.brief': 'Quick check', 'compare.whitespace': 'Ignore whitespace', 'compare.case': 'Ignore case', 'compare.bytes': 'Byte comparison',
  'zsh.source': 'Reload .zshrc', 'zsh.start': 'Open Zsh', 'zsh.clean': 'Open without user startup files', 'zsh.version': 'Version', 'zsh.help': 'Help', 'zsh.path': 'PATH entries', 'zsh.options': 'Default options', 'zsh.keybindings': 'Default keybindings', 'zsh.which': 'Find command', 'zsh.syntax': 'Check config syntax',
  'ngrok.http': 'HTTP by port', 'ngrok.http.url': 'HTTP local URL', 'ngrok.http.domain': 'HTTP custom domain', 'ngrok.tcp': 'TCP tunnel', 'ngrok.start': 'Start named endpoint', 'ngrok.start.all': 'Start all endpoints', 'ngrok.config.check': 'Check config', 'ngrok.version': 'Version', 'ngrok.help': 'Help',
  'cloudflared.quick': 'Quick tunnel', 'cloudflared.run': 'Run named tunnel', 'cloudflared.login': 'Login', 'cloudflared.create': 'Create tunnel', 'cloudflared.list': 'List tunnels', 'cloudflared.info': 'Tunnel info', 'cloudflared.version': 'Version', 'cloudflared.help': 'Help',
  'git.remote.set-url': 'Change URL', 'git.remote.add': 'Add remote', 'git.remote.remove': 'Remove remote', 'git.remote.list': 'List remotes', 'git.remote.rename': 'Rename remote',
  'git.config.list': 'List config', 'git.config.get': 'Get value', 'git.config.set': 'Set value',
  'git.branch.list': 'List branches', 'git.branch.create': 'Create branch', 'git.branch.switch': 'Switch branch', 'git.branch.delete': 'Delete branch', 'git.branch.rename': 'Rename branch',
  'git.status': 'Status', 'git.diff': 'Diff', 'git.stage': 'Stage file', 'git.unstage': 'Unstage file', 'git.restore': 'Restore tracked files',
  'git.fetch': 'Fetch', 'git.pull': 'Pull', 'git.push': 'Push', 'git.log': 'Commit log', 'git.reset.soft': 'Reset soft', 'git.reset.mixed': 'Reset mixed', 'git.reset.hard': 'Reset hard',
  'git.stash.list': 'List stashes', 'git.stash.push': 'Save tracked changes', 'git.stash.apply': 'Apply stash', 'git.stash.pop': 'Pop stash', 'git.stash.drop': 'Drop stash',
  'ssh.connect': 'Connect', 'ssh.test': 'Test authentication', 'ssh.version': 'Version', 'ssh.help': 'Help', 'ssh.key.generate': 'Generate ed25519 key', 'ssh.key.fingerprint': 'Show fingerprint', 'ssh.agent.list': 'List identities', 'ssh.agent.public': 'List public keys', 'ssh.agent.add': 'Load key into agent', 'ssh.agent.remove': 'Remove key from agent', 'ssh.agent.clear': 'Remove all keys',
  'node.version': 'Version', 'node.runtime': 'Runtime details', 'npm.version': 'Version', 'npm.dependencies': 'Dependencies', 'flutter.version': 'Version', 'flutter.doctor': 'Doctor', 'flutter.devices': 'Devices',
  'files.create': 'Create file', 'files.mkdir': 'Create directory', 'files.copy': 'Copy file', 'files.move': 'Move file', 'files.rename': 'Rename file', 'files.delete': 'Delete file', 'files.rmdir': 'Remove empty directory',
  'find.name': 'By name', 'find.iname': 'By name (ignore case)', 'find.extension': 'By extension', 'find.directory': 'Directories', 'find.empty': 'Empty files or directories', 'find.size': 'Large files', 'find.modified': 'Recently modified',
  'system.whoami': 'Current user', 'system.hostname': 'Hostname', 'system.uname': 'Operating system', 'system.uptime': 'Uptime', 'system.date': 'Date and time', 'python.version': 'Python version', 'docker.version': 'Docker CLI version',
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
