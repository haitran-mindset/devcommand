import { sshAgentLifetimes, sshAgentLifetimeLabels, sshKeyTypes } from '../../../shared/extended'
import { configKeys } from '../../../shared/git'
import { hasControlCharacters } from '../../../shared/text'
import { redact } from '../execution/redact'
import { z } from 'zod'
import type { CommandParameter, CommandSummary } from '../../../shared/commands'
import { PublicError } from '../workspace/service'

export type Argument = string | { param: string } | { flag: string; param: string }
export interface Definition extends Omit<CommandSummary, 'favorite'> { executable: string; arguments: Argument[]; mutation: boolean; network?: boolean; projectFile?: string; successExitCodes?: number[] }
const name = (key = 'name', label = 'Remote Name', defaultValue = 'origin'): CommandParameter => ({ key, label, type: 'string', required: true, defaultValue })
const choice = (key: string, label: string, options: string[], defaultValue = options[0]): CommandParameter => ({ key, label, type: 'enum', required: true, options, defaultValue })
const stashParameters = (): CommandParameter[] => [name('stash', 'Stash Reference', 'stash@{0}'), { key: 'expectedOid', label: 'Expected Stash Commit (optional)', type: 'string', required: false, defaultValue: '' }]
const param = (key: string): Argument => ({ param: key })
const definitions: Definition[] = []
function git(id: string, title: string, description: string, args: Argument[], parameters: CommandParameter[] = [], risk: Definition['risk'] = 'safe', aliases: string[] = [], network = false) {
  definitions.push({ id: `git.${id}`, title, description, category: 'Git', aliases, risk, parameters, arguments: args, executable: 'git', requiresRepository: true, supportedPlatforms: ['darwin', 'win32', 'linux'], mutation: risk !== 'safe', network, examples: [`git ${args.map((arg) => typeof arg === 'string' ? arg : `<${arg.param}>`).join(' ')}`] })
}
git('remote.set-url', 'Change Git Remote URL', 'Update the remote repository address', ['remote', 'set-url', '--', param('name'), param('url')], [name(), name('url', 'New Remote URL', 'git@github.com:user/repo.git')], 'caution', ['change remote', 'change git remote', 'change remote url'])
git('remote.add', 'Add Git Remote', 'Add a new remote repository', ['remote', 'add', '--', param('name'), param('url')], [name(), name('url', 'Remote URL', 'git@github.com:user/repo.git')], 'caution')
git('remote.remove', 'Remove Git Remote', 'Remove configuration and remote-tracking references', ['remote', 'remove', '--', param('name')], [name()], 'dangerous')
git('remote.list', 'List Git Remotes', 'Show configured fetch and push addresses', ['remote', '-v'])
git('remote.rename', 'Rename Git Remote', 'Rename an existing remote', ['remote', 'rename', '--', param('name'), param('newName')], [name(), name('newName', 'New Remote Name', 'upstream')], 'caution')
git('status', 'Git Status', 'Inspect staged, unstaged and untracked changes', ['status', '--short', '--branch'], [], 'safe', ['working tree', 'changes'])
git('config.list', 'List Git Config', 'List configuration for the selected scope', ['config', { flag: '--', param: 'scope' }, '--list', '--show-origin'], [choice('scope', 'Scope', ['local', 'global'])])
git('config.get', 'Get Git Config', 'Read a supported configuration key', ['config', { flag: '--', param: 'scope' }, '--get', param('key')], [choice('scope', 'Scope', ['local', 'global']), choice('key', 'Config Key', [...configKeys])])
git('config.set', 'Set Git Config', 'Update a supported local or global setting', ['config', { flag: '--', param: 'scope' }, param('key'), param('value')], [choice('scope', 'Scope', ['local', 'global']), choice('key', 'Config Key', [...configKeys]), { ...name('value', 'Config Value', ''), sensitive: true }], 'caution')
git('branch.list', 'List Git Branches', 'List local branches', ['branch', '--list'])
git('branch.create', 'Create Git Branch', 'Create a branch at the current commit', ['branch', '--', param('branch')], [name('branch', 'Branch Name', 'feature/new-work')], 'caution')
git('branch.switch', 'Switch Git Branch', 'Switch to an existing local branch', ['switch', '--', param('branch')], [name('branch', 'Branch Name', 'main')], 'caution')
git('branch.delete', 'Delete Git Branch', 'Delete a merged local branch; unmerged deletion is refused', ['branch', '-d', '--', param('branch')], [name('branch', 'Branch Name', 'feature/finished')], 'dangerous')
git('branch.rename', 'Rename Git Branch', 'Rename a local branch without overwriting another branch', ['branch', '-m', '--', param('branch'), param('newBranch')], [name('branch', 'Current Branch Name', 'feature/old-name'), name('newBranch', 'New Branch Name', 'feature/new-name')], 'caution')
git('stage', 'Stage File', 'Stage the selected file, including its current changes or deletion', ['add', '--', param('path')], [name('path', 'Repository-relative File', '')], 'caution')
git('unstage', 'Unstage File', 'Remove the selected file from the index without discarding worktree content', ['restore', '--staged', '--', param('path')], [name('path', 'Repository-relative File', '')], 'caution')
git('fetch', 'Git Fetch', 'Fetch refs from a configured remote', ['fetch', '--', param('name')], [name()], 'caution', [], true)
git('pull', 'Git Pull', 'Fast-forward only; conflicts or divergence are refused', ['pull', '--ff-only', '--', param('name'), param('branch')], [name(), name('branch', 'Remote Branch', 'main')], 'caution', [], true)
git('push', 'Git Push', 'Push a local branch without force', ['push', '--', param('name'), param('branch')], [name(), name('branch', 'Local Branch', 'main')], 'caution', [], true)
git('log', 'Git Log', 'Show the latest 30 commits', ['log', '--no-show-signature', '--oneline', '-30'])
git('diff', 'Git Diff', 'Show unstaged changes without external diff drivers', ['diff', '--no-ext-diff', '--no-textconv'])
git('stash.list', 'List Git Stashes', 'List saved stash entries', ['stash', 'list'])
git('stash.push', 'Save Git Stash', 'Stash tracked changes; untracked files remain', ['stash', 'push', '-m', 'DevCommand stash'], [], 'caution')
git('stash.apply', 'Apply Git Stash', 'Apply a saved stash without dropping it', ['stash', 'apply', param('stash')], stashParameters(), 'caution')
git('stash.pop', 'Pop Git Stash', 'Apply a stash and remove it only after successful application', ['stash', 'pop', param('stash')], stashParameters(), 'dangerous')
git('stash.drop', 'Drop Git Stash', 'Permanently remove a stash entry without applying it', ['stash', 'drop', param('stash')], stashParameters(), 'dangerous')
git('restore', 'Restore Tracked Files', 'Discard unstaged tracked changes across this worktree', ['restore', '--worktree', '--', '.'], [], 'dangerous', ['discard changes'])
for (const mode of ['soft', 'mixed', 'hard']) git(`reset.${mode}`, `Git Reset ${mode[0].toUpperCase() + mode.slice(1)}`, `Reset ${mode === 'hard' ? 'HEAD, index and tracked files' : mode === 'mixed' ? 'HEAD and index' : 'HEAD only'}`, ['reset', `--${mode}`, param('ref'), '--'], [name('ref', 'Target Commit', 'HEAD~1')], mode === 'soft' ? 'caution' : 'dangerous', ['undo commit', `reset ${mode}`])
for (const executable of ['git', 'node', 'docker']) definitions.push({ id: `${executable}.version`, title: `${executable[0].toUpperCase() + executable.slice(1)} Version`, description: `Check the installed ${executable} CLI`, category: executable === 'git' ? 'Git' : executable === 'node' ? 'Node' : 'General', aliases: [`${executable} version`], risk: 'safe', parameters: [], arguments: ['--version'], executable, requiresRepository: false, supportedPlatforms: ['darwin', 'win32', 'linux'], mutation: false, examples: [`${executable} --version`] })
for (const [id, title, executable, args] of [['system.pwd', 'Print Working Directory', 'pwd', []], ['system.list', 'List Directory', 'ls', ['-la']]] as const) definitions.push({ id, title, description: 'Inspect the selected workspace or home directory', category: 'System', aliases: [id === 'system.pwd' ? 'pwd' : 'ls'], risk: 'safe', parameters: [], arguments: [...args], executable, requiresRepository: false, supportedPlatforms: ['darwin', 'linux'], mutation: false, examples: [executable + ' ' + args.join(' ')] })
function pack(id: string, title: string, description: string, category: Definition['category'], executable: string, args: Argument[], options: Partial<Pick<Definition, 'parameters' | 'risk' | 'mutation' | 'network' | 'supportedPlatforms' | 'projectFile' | 'aliases' | 'requiresRepository' | 'interactive' | 'successExitCodes'>> = {}) {
  definitions.push({ id, title, description, category, executable, arguments: args, parameters: [], risk: 'safe', mutation: false, aliases: [id.replaceAll('.', ' ')], supportedPlatforms: ['darwin', 'win32', 'linux'], requiresRepository: !!options.projectFile, examples: [displayCommand(executable, args.map((arg) => typeof arg === 'string' ? arg : `<${arg.param}>`))], ...options })
}
pack('npm.version', 'npm Version', 'Show the installed npm CLI version', 'Node', 'npm', ['--version'], { supportedPlatforms: ['darwin', 'linux'] })
pack('npm.dependencies', 'List Node Dependencies', 'Inspect direct dependencies without running package scripts', 'Node', 'npm', ['ls', '--depth=0', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { projectFile: 'package.json', supportedPlatforms: ['darwin', 'linux'] })
pack('node.runtime', 'Node Runtime Details', 'Show runtime versions and platform using fixed built-in code', 'Node', 'node', ['-p', 'JSON.stringify({versions:process.versions,platform:process.platform,arch:process.arch},null,2)'])
pack('flutter.version', 'Flutter Version', 'Show Flutter SDK version; may initialize SDK caches', 'Flutter', 'flutter', ['--suppress-analytics', '--version'], { risk: 'caution', mutation: true, network: true, supportedPlatforms: ['darwin', 'linux'] })
pack('flutter.doctor', 'Flutter Doctor', 'Check the local Flutter development toolchain', 'Flutter', 'flutter', ['--suppress-analytics', 'doctor'], { risk: 'caution', mutation: true, network: true, supportedPlatforms: ['darwin', 'linux'] })
pack('flutter.devices', 'Flutter Devices', 'Discover devices connected to this machine', 'Flutter', 'flutter', ['--suppress-analytics', 'devices'], { risk: 'caution', mutation: true, network: true, supportedPlatforms: ['darwin', 'linux'] })
pack('python.version', 'Python Version', 'Show the installed Python 3 version', 'System', 'python3', ['--version'])
for (const [id, title, executable, args] of [
  ['system.whoami', 'Current User', 'whoami', []],
  ['system.hostname', 'Computer Hostname', 'hostname', []],
  ['system.uname', 'Operating System Information', 'uname', ['-a']],
  ['system.uptime', 'System Uptime', 'uptime', []],
  ['system.date', 'Current Date and Time', 'date', []]
] as const) pack(id, title, 'Read local system information without changing configuration', 'System', executable, [...args], { supportedPlatforms: ['darwin', 'linux'] })
pack('system.disk', 'Disk Usage', 'Show filesystem capacity for the current directory', 'System', 'df', ['-h', '.'], { supportedPlatforms: ['darwin', 'linux'] })
pack('system.port', 'Inspect Listening Port', 'List TCP listeners for a numeric port; no processes are killed', 'System', 'lsof', ['-nP', { flag: '-iTCP:', param: 'port' }, '-sTCP:LISTEN'], { parameters: [name('port', 'TCP Port', '3000')], supportedPlatforms: ['darwin', 'linux'] })
pack('system.ports', 'List TCP Listening Ports', 'Show all TCP listening ports with process names and PIDs', 'System', 'lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { supportedPlatforms: ['darwin', 'linux'], aliases: ['all listening ports', 'tcp ports', 'xem tat ca TCP listening ports', 'xem tất cả cổng TCP'] })
pack('system.port.process', 'Find Process Using Port', 'Show processes using a TCP or UDP port, including their PIDs', 'System', 'lsof', ['-nP', { flag: '-i:', param: 'port' }], { parameters: [name('port', 'Port', '3000')], supportedPlatforms: ['darwin', 'linux'], aliases: ['process using port', 'pid port', 'xem process dang su dung port', 'xem process đang sử dụng port'] })
pack('system.port.stop', 'Stop Process on Port', 'Stop a TCP listener with SIGTERM after reviewing its PID; defaults to port 3000', 'System', 'kill', ['-TERM', { param: 'pid' }], { parameters: [name('port', 'TCP Port', '3000'), { key: 'pid', label: 'PID (optional, required for multiple listeners)', type: 'string', required: false, defaultValue: '' }], risk: 'dangerous', mutation: true, supportedPlatforms: ['darwin', 'linux'], aliases: ['kill port', 'free port', 'stop process port 3000', 'dung process dang chiem port', 'dừng process đang chiếm port'] })
const comparisonParameters = () => [name('leftFile', 'First file', 'before.txt'), name('rightFile', 'Second file', 'after.txt')]
const comparisonOptions = { supportedPlatforms: ['darwin', 'linux'] as Definition['supportedPlatforms'], successExitCodes: [0, 1] }
pack('compare.unified', 'Compare Files', 'Show a unified diff between two regular files', 'System', 'diff', ['-u', param('leftFile'), param('rightFile')], { ...comparisonOptions, parameters: comparisonParameters(), aliases: ['diff', 'file comparison', 'compare files'] })
pack('compare.brief', 'Check Whether Files Differ', 'Report whether two files differ without printing their contents', 'System', 'diff', ['-q', param('leftFile'), param('rightFile')], { ...comparisonOptions, parameters: comparisonParameters() })
pack('compare.whitespace', 'Compare Files (Ignore Whitespace)', 'Show a unified diff ignoring whitespace differences', 'System', 'diff', ['-u', '-w', param('leftFile'), param('rightFile')], { ...comparisonOptions, parameters: comparisonParameters() })
pack('compare.case', 'Compare Files (Ignore Case)', 'Show a unified diff ignoring letter case', 'System', 'diff', ['-u', '-i', param('leftFile'), param('rightFile')], { ...comparisonOptions, parameters: comparisonParameters() })
pack('compare.bytes', 'Compare Files Byte by Byte', 'Report the first differing byte or an EOF difference', 'System', 'cmp', [param('leftFile'), param('rightFile')], { ...comparisonOptions, parameters: comparisonParameters(), aliases: ['cmp', 'binary comparison', 'compare bytes'] })
const fileOptions = { supportedPlatforms: ['darwin', 'linux'] as Definition['supportedPlatforms'], requiresRepository: true, mutation: true, risk: 'caution' as const }
const fileTarget = () => [name('targetPath', 'Path inside repository', 'new-file.txt')]
const filePair = () => [name('sourcePath', 'Source file', 'source.txt'), name('destinationPath', 'Destination file (full path)', 'destination.txt')]
pack('files.create', 'Create File', 'Create a new empty file without replacing existing paths', 'System', 'touch', [param('targetPath')], { ...fileOptions, parameters: fileTarget(), aliases: ['touch', 'create file', 'file operations'] })
pack('files.mkdir', 'Create Directory', 'Create one directory under an existing parent', 'System', 'mkdir', [param('targetPath')], { ...fileOptions, parameters: [name('targetPath', 'Directory path inside repository', 'new-directory')] })
pack('files.copy', 'Copy File', 'Copy one regular file to a new destination', 'System', 'cp', ['-n', param('sourcePath'), param('destinationPath')], { ...fileOptions, parameters: filePair() })
pack('files.move', 'Move File', 'Move one regular file to a new destination', 'System', 'mv', ['-n', param('sourcePath'), param('destinationPath')], { ...fileOptions, parameters: filePair() })
pack('files.rename', 'Rename File', 'Rename one regular file using its full destination path', 'System', 'mv', ['-n', param('sourcePath'), param('destinationPath')], { ...fileOptions, parameters: filePair() })
pack('files.delete', 'Delete File', 'Permanently delete one regular file after confirmation', 'System', 'rm', [param('targetPath')], { ...fileOptions, parameters: fileTarget(), risk: 'dangerous' })
pack('files.rmdir', 'Remove Empty Directory', 'Remove a directory only if it is empty', 'System', 'rmdir', [param('targetPath')], { ...fileOptions, parameters: [name('targetPath', 'Directory path inside repository', 'empty-directory')], risk: 'dangerous' })
const findParameters = () => [name('searchRoot', 'Search directory', '/'), { ...choice('maxDepth', 'Maximum depth', ['all', '1', '2', '3', '5', '10', '20'], 'all'), optionLabels: { all: 'No limit' } }]
const findOptions = { supportedPlatforms: ['darwin', 'linux'] as Definition['supportedPlatforms'] }
const findBase: Argument[] = ['-P', param('searchRoot'), '-mindepth', '1']
pack('find.name', 'Find by Name', 'Find files by a wildcard pattern, such as *.ts or README*', 'System', 'find', [...findBase, '-type', 'f', '-name', param('pattern'), '-print'], { ...findOptions, parameters: [...findParameters(), name('pattern', 'Filename pattern', '*.ts')] })
pack('find.iname', 'Find by Name (Ignore Case)', 'Find files by name without case sensitivity', 'System', 'find', [...findBase, '-type', 'f', '-iname', param('pattern'), '-print'], { ...findOptions, parameters: [...findParameters(), name('pattern', 'Filename pattern', '*readme*')] })
pack('find.extension', 'Find by Extension', 'Find files with a selected extension', 'System', 'find', [...findBase, '-type', 'f', '-name', { flag: '*.', param: 'extension' }, '-print'], { ...findOptions, parameters: [...findParameters(), name('extension', 'Extension (without dot)', 'ts')] })
pack('find.directory', 'Find Directories', 'Find directories by a wildcard name pattern', 'System', 'find', [...findBase, '-type', 'd', '-name', param('pattern'), '-print'], { ...findOptions, parameters: [...findParameters(), name('pattern', 'Directory name pattern', '*')] })
pack('find.empty', 'Find Empty Files or Directories', 'Find empty regular files or directories', 'System', 'find', [...findBase, '-type', param('entryType'), '-empty', '-print'], { ...findOptions, parameters: [...findParameters(), { ...choice('entryType', 'Find', ['f', 'd']), optionLabels: { f: 'Files', d: 'Directories' } }] })
pack('find.size', 'Find Large Files', 'Find regular files larger than a specified size', 'System', 'find', [...findBase, '-type', 'f', '-size', { flag: '+', param: 'size' }, '-print'], { ...findOptions, parameters: [...findParameters(), name('size', 'Minimum size (e.g. 100M, 1G, 512k)', '100M')] })
pack('find.modified', 'Find Recently Modified Files', 'Find regular files modified within the selected number of days', 'System', 'find', [...findBase, '-type', 'f', '-mtime', { flag: '-', param: 'days' }, '-print'], { ...findOptions, parameters: [...findParameters(), choice('days', 'Modified within (days)', ['1', '3', '7', '14', '30'], '7')] })
const sshPlatforms: Definition['supportedPlatforms'] = ['darwin', 'linux']
const sshConnection = [name('host', 'Hostname or Alias', 'github.com'), name('user', 'SSH User', 'git'), name('port', 'SSH Port', '22')]
pack('ssh.connect', 'Connect with SSH', 'Open an interactive SSH connection using your OpenSSH configuration', 'SSH', 'ssh', ['-p', param('port'), '-l', param('user'), param('host')], { parameters: sshConnection, supportedPlatforms: sshPlatforms, interactive: true, mutation: true, risk: 'caution', network: true, aliases: ['ssh login', 'connect server', 'kết nối SSH'] })
pack('ssh.test', 'Test SSH Authentication', 'Test a direct hostname with strict host-key checking and no interactive prompts', 'SSH', 'ssh', ['-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'PermitLocalCommand=no', '-o', 'RemoteCommand=none', '-p', param('port'), '-l', param('user'), param('host')], { parameters: sshConnection.map((field) => field.key === 'host' ? { ...field, label: 'Hostname or IP' } : field), supportedPlatforms: sshPlatforms, mutation: true, risk: 'caution', network: true, aliases: ['ssh -T', 'test ssh', 'kiểm tra SSH'] })
pack('ssh.github.test', 'Test GitHub SSH Connection', 'Check GitHub authentication using your existing SSH configuration; does not start an agent or load keys', 'SSH', 'ssh', ['-T', 'git@github.com'], { supportedPlatforms: sshPlatforms, interactive: true, mutation: true, risk: 'caution', network: true, aliases: ['ssh -T git@github.com', 'test github connection', 'kiểm tra kết nối GitHub'] })
pack('ssh.key.list', 'List SSH Key Files', 'List files in your SSH directory without reading key contents or changing the agent', 'SSH', 'ls', [], { supportedPlatforms: sshPlatforms, aliases: ['ls -la ~/.ssh', 'existing ssh keys', 'liệt kê SSH key'] })
pack('ssh.agent.start', 'Add SSH Key to New Agent', 'Start a new SSH agent and add the selected key in the same terminal tab', 'SSH', 'zsh', ['-f', '-i'], { supportedPlatforms: sshPlatforms, interactive: true, mutation: true, risk: 'caution', parameters: [name('keyName', 'Private key name (inside ~/.ssh)', 'id_ed25519')], aliases: ['add key to new agent', 'ssh-agent', 'eval "$(ssh-agent -s)"', 'khởi động SSH Agent'] })
pack('ssh.version', 'OpenSSH Version', 'Show the installed OpenSSH version', 'SSH', 'ssh', ['-V'], { supportedPlatforms: sshPlatforms })
pack('ssh.help', 'OpenSSH Help', 'Show OpenSSH command-line usage', 'SSH', 'ssh', ['-h'], { supportedPlatforms: sshPlatforms, successExitCodes: [0, 255] })
pack('ssh.key.generate', 'Generate SSH Key', 'Create an ed25519 or RSA 4096-bit key pair; enter the passphrase in the terminal', 'SSH', 'ssh-keygen', [], { parameters: [{ ...choice('keyType', 'Key type', [...sshKeyTypes], 'ed25519'), required: false }, name('keyName', 'Key Basename', 'id_ed25519_devcommand'), { key: 'comment', label: 'Public Comment', type: 'string', required: false, defaultValue: '' }], supportedPlatforms: sshPlatforms, mutation: true, risk: 'caution', interactive: true, aliases: ['ssh-keygen', 'generate key', 'tạo SSH key'] })
pack('ssh.key.fingerprint', 'Show SSH Fingerprint', 'Show the SHA256 fingerprint of a public key in your SSH directory', 'SSH', 'ssh-keygen', [], { parameters: [name('keyName', 'Key Basename', 'id_ed25519')], supportedPlatforms: sshPlatforms, aliases: ['ssh-keygen -lf', 'fingerprint'] })
pack('ssh.agent.list', 'List SSH Agent Identities', 'List fingerprints in the current OS SSH agent', 'SSH', 'ssh-add', ['-l', '-E', 'sha256'], { supportedPlatforms: sshPlatforms, successExitCodes: [0, 1], aliases: ['ssh-add -l', 'agent keys'] })
pack('ssh.agent.public', 'List SSH Agent Public Keys', 'List public keys currently loaded in the OS SSH agent', 'SSH', 'ssh-add', ['-L'], { supportedPlatforms: sshPlatforms, successExitCodes: [0, 1], aliases: ['ssh-add -L'] })
pack('ssh.agent.add', 'Load SSH Key into Agent', 'Load a validated SSH identity into the OS agent for a selected lifetime', 'SSH', 'ssh-add', [], { parameters: [name('keyName', 'Private key name (inside ~/.ssh)', 'id_ed25519'), { ...choice('lifetimeSeconds', 'Key lifetime', [...sshAgentLifetimes], '3600'), required: false, optionLabels: sshAgentLifetimeLabels }], supportedPlatforms: sshPlatforms, mutation: true, risk: 'caution', interactive: true, aliases: ['ssh-add', 'load identity'] })
pack('ssh.agent.remove', 'Remove SSH Key from Agent', 'Remove one selected identity from the shared SSH agent without deleting its files', 'SSH', 'ssh-add', [], { parameters: [name('keyName', 'Key Basename', 'id_ed25519')], supportedPlatforms: sshPlatforms, mutation: true, risk: 'caution', interactive: true, aliases: ['ssh-add -d', 'remove agent key'] })
pack('ssh.agent.clear', 'Remove All SSH Agent Keys', 'Remove every identity from the shared SSH agent without deleting key files', 'SSH', 'ssh-add', ['-D'], { supportedPlatforms: sshPlatforms, mutation: true, risk: 'dangerous', interactive: true, aliases: ['ssh-add -D', 'clear agent', 'remove all keys'] })
const sshExamples: Record<string, string[]> = {
  'ssh.key.list': ['ls -la ~/.ssh'],
  'ssh.agent.start': ['eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519'],
  'ssh.key.generate': ['ssh-keygen -t ed25519 -a 64 -C "work-key" -f ~/.ssh/id_ed25519_work'],
  'ssh.key.fingerprint': ['ssh-keygen -E sha256 -lf ~/.ssh/id_ed25519.pub'],
  'ssh.agent.add': ['ssh-add ~/.ssh/id_ed25519', 'ssh-add -t 600 ~/.ssh/id_ed25519', 'ssh-add -t 3600 ~/.ssh/id_ed25519', 'ssh-add -t 28800 ~/.ssh/id_ed25519', 'ssh-add -t 86400 ~/.ssh/id_ed25519'],
  'ssh.agent.remove': ['ssh-add -d ~/.ssh/id_ed25519.pub'],
}
for (const definition of definitions) if (sshExamples[definition.id]) definition.examples = sshExamples[definition.id]
const permissionPlatforms: Definition['supportedPlatforms'] = ['darwin', 'linux']
const target = (defaultValue = '') => name('target', 'Repository-relative Path', defaultValue)
const aclTool = process.platform === 'darwin' ? 'chmod' : 'setfacl'
pack('permissions.inspect', 'Inspect File Permissions', 'Show permissions, owner and group for a file or directory', 'Permissions', 'ls', ['-ld', param('target')], { parameters: [target('.')], requiresRepository: true, supportedPlatforms: permissionPlatforms, aliases: ['permissions', 'owner group', 'xem quyền'] })
pack('permissions.chmod', 'Change File Permissions', 'Set octal or symbolic chmod permissions on one path', 'Permissions', 'chmod', [param('mode'), param('target')], { parameters: [name('mode', 'Permission Mode', '755'), target()], requiresRepository: true, risk: 'dangerous', mutation: true, supportedPlatforms: permissionPlatforms, aliases: ['chmod', 'chmod 755', 'chmod 644', 'chmod u+x'] })
pack('permissions.chown', 'Change File Owner', 'Change owner or owner:group on one path using your current OS permissions', 'Permissions', 'chown', [param('owner'), param('target')], { parameters: [name('owner', 'Owner or Owner:Group', ''), target()], requiresRepository: true, risk: 'dangerous', mutation: true, supportedPlatforms: permissionPlatforms, aliases: ['chown', 'ownership', 'đổi owner'] })
pack('permissions.acl.view', 'View File ACL', 'Inspect access control entries on one file or directory', 'Permissions', process.platform === 'darwin' ? 'ls' : 'getfacl', [process.platform === 'darwin' ? '-lde' : '--', param('target')], { parameters: [target('.')], requiresRepository: true, supportedPlatforms: permissionPlatforms, aliases: ['acl list', 'getfacl', 'ls -le'] })
const aclIdentity = [choice('principal', 'Principal Type', ['user', 'group']), name('identity', 'User or Group', '')]
pack('permissions.acl.add', 'Add File ACL Entry', 'Grant access to a user or group on one path', 'Permissions', aclTool, [], { parameters: [...aclIdentity, choice('access', 'Access', ['r', 'rw', 'rx', 'rwx']), target()], requiresRepository: true, risk: 'dangerous', mutation: true, supportedPlatforms: permissionPlatforms, aliases: ['setfacl', 'chmod +a', 'acl grant'] })
pack('permissions.acl.remove', 'Remove File ACL Entry', 'Remove a selected ACL entry from one path', 'Permissions', aclTool, [], { parameters: process.platform === 'darwin' ? [name('index', 'ACL Entry Index', '0'), target()] : [...aclIdentity, target()], requiresRepository: true, risk: 'dangerous', mutation: true, supportedPlatforms: permissionPlatforms, aliases: ['acl revoke', 'chmod -a', 'setfacl -x'] })
pack('permissions.acl.clear', 'Clear File ACL', 'Remove extended ACL entries from one path', 'Permissions', aclTool, [process.platform === 'darwin' ? '-N' : '-b', param('target')], { parameters: [target()], requiresRepository: true, risk: 'dangerous', mutation: true, supportedPlatforms: permissionPlatforms, aliases: ['acl clear', 'chmod -N', 'setfacl -b'] })
const aclExamples: Record<string, string[]> = process.platform === 'darwin' ? {
  'permissions.acl.add': ["chmod +a 'user:alice allow read,write' ./file.txt"],
  'permissions.acl.remove': ['chmod -a# 0 ./file.txt'],
} : {
  'permissions.acl.add': ['setfacl -m u:alice:rw- -- ./file.txt'],
  'permissions.acl.remove': ['setfacl -x u:alice -- ./file.txt'],
}
for (const definition of definitions) if (aclExamples[definition.id]) definition.examples = aclExamples[definition.id]
// CLI syntax checked against each vendor's official CLI reference.
// Codex: https://developers.openai.com/codex/cli/reference/
// Claude: https://code.claude.com/docs/en/cli-reference
// Gemini: https://geminicli.com/docs/cli/cli-reference/
// Antigravity: https://antigravity.google/docs/cli/reference
for (const [id, title, executable, resume] of [
  ['codex', 'Codex', 'codex', ['resume', '--last']],
  ['claude', 'Claude Code', 'claude', ['--continue']],
  ['gemini', 'Gemini CLI', 'gemini', ['--resume', 'latest']],
  ['antigravity', 'Antigravity CLI', 'agy', ['--continue']],
] as const) {
  const options = { supportedPlatforms: ['darwin', 'linux'] as Definition['supportedPlatforms'], aliases: [title.toLowerCase(), executable] }
  pack(`ai.${id}.help`, `${title} Help`, `Show ${title} command-line usage`, 'AI Developer CLI', executable, ['--help'], options)
  // The current agy reference/help does not advertise a version flag.
  if (id !== 'antigravity') pack(`ai.${id}.version`, `${title} Version`, `Show the installed ${title} version`, 'AI Developer CLI', executable, ['--version'], options)
  pack(`ai.${id}.start`, `Start ${title}`, `Open ${title} interactively in the selected repository`, 'AI Developer CLI', executable, [], { ...options, interactive: true, requiresRepository: true, risk: 'caution', mutation: true, network: true })
  pack(`ai.${id}.resume`, `Resume ${title}`, `Continue the most recent ${title} session in a terminal`, 'AI Developer CLI', executable, [...resume], { ...options, interactive: true, requiresRepository: true, risk: 'caution', mutation: true, network: true })
}
// Long-running tunnels and account changes use an explicitly confirmed terminal session.
for (const [action, title, args, parameters] of [
  ['quick', 'Start Quick Tunnel', ['tunnel', '--url', param('originUrl')], [name('originUrl', 'Local service URL', 'http://localhost:3000')]],
  ['run', 'Run Cloudflare Tunnel', ['tunnel', 'run', param('tunnel')], [name('tunnel', 'Tunnel name or UUID', 'my-tunnel')]],
  ['login', 'Cloudflare Tunnel Login', ['tunnel', 'login'], []],
  ['create', 'Create Cloudflare Tunnel', ['tunnel', 'create', param('tunnel')], [name('tunnel', 'Tunnel name', 'my-tunnel')]],
] as [string, string, Argument[], CommandParameter[]][]) pack(`cloudflared.${action}`, title, action === 'quick' ? 'Expose a local HTTP service through a temporary public URL' : action === 'run' ? 'Run a named tunnel using your existing cloudflared configuration' : action === 'login' ? 'Authenticate in your browser and save the Cloudflare account certificate' : 'Create a named tunnel and its local credential file', 'General', 'cloudflared', args, { parameters, interactive: true, mutation: true, network: true, risk: 'caution', supportedPlatforms: ['darwin', 'linux'] })
pack('cloudflared.list', 'List Cloudflare Tunnels', 'List tunnels in your authenticated Cloudflare account', 'General', 'cloudflared', ['tunnel', 'list'], { network: true })
pack('cloudflared.info', 'Cloudflare Tunnel Info', 'Inspect active connectors for a named tunnel', 'General', 'cloudflared', ['tunnel', 'info', param('tunnel')], { parameters: [name('tunnel', 'Tunnel name or UUID', 'my-tunnel')], network: true })
pack('cloudflared.version', 'Cloudflared Version', 'Show the installed cloudflared version', 'General', 'cloudflared', ['--version'])
pack('cloudflared.help', 'Cloudflare Tunnel Help', 'Show Cloudflare Tunnel CLI usage', 'General', 'cloudflared', ['tunnel', '--help'])
for (const [action, title, args, parameters] of [
  ['http', 'Start ngrok HTTP Tunnel', ['http', param('port')], [name('port', 'Local port', '3000')]],
  ['http.url', 'Start ngrok HTTP URL', ['http', param('originUrl')], [name('originUrl', 'Local service URL', 'http://localhost:3000')]],
  ['http.domain', 'Start ngrok Custom Domain', ['http', param('port'), '--url', param('publicUrl')], [name('port', 'Local port', '3000'), name('publicUrl', 'Public endpoint URL', 'https://example.ngrok.app')]],
  ['tcp', 'Start ngrok TCP Tunnel', ['tcp', param('port')], [name('port', 'Local port', '5432')]],
  ['start', 'Start Named ngrok Tunnel', ['start', param('tunnel')], [name('tunnel', 'Configured endpoint name', 'my-app')]],
  ['start.all', 'Start All ngrok Tunnels', ['start', '--all'], []],
] as [string, string, Argument[], CommandParameter[]][]) pack(`ngrok.${action}`, title, action.startsWith('start') ? 'Run endpoints defined in your existing ngrok configuration' : 'Forward traffic through ngrok to a local service', 'General', 'ngrok', args, { parameters, interactive: true, mutation: true, network: true, risk: 'caution', supportedPlatforms: ['darwin', 'linux'] })
pack('ngrok.config.check', 'Check ngrok Config', 'Validate the existing ngrok agent configuration', 'General', 'ngrok', ['config', 'check'])
pack('ngrok.version', 'ngrok Version', 'Show the installed ngrok agent version', 'General', 'ngrok', ['version'])
pack('ngrok.help', 'ngrok Help', 'Show ngrok CLI commands and usage', 'General', 'ngrok', ['help'])
const zshPlatforms: Definition['supportedPlatforms'] = ['darwin', 'linux']
pack('zsh.version', 'Zsh Version', 'Show the installed Zsh version', 'System', 'zsh', ['--version'], { supportedPlatforms: zshPlatforms })
pack('zsh.help', 'Zsh Help', 'Show Zsh invocation flags and options', 'System', 'zsh', ['--help'], { supportedPlatforms: zshPlatforms })
pack('zsh.start', 'Open Zsh', 'Open an interactive Zsh using your existing startup configuration', 'System', 'zsh', ['-i'], { supportedPlatforms: zshPlatforms, interactive: true, mutation: true, risk: 'caution' })
pack('zsh.source', 'Reload .zshrc', 'Source your .zshrc in a new interactive Zsh tab', 'System', 'zsh', ['-f', '-i'], { supportedPlatforms: zshPlatforms, interactive: true, mutation: true, risk: 'caution', aliases: ['source ~/.zshrc', 'source zshrc', 'reload zsh configuration'] })
pack('zsh.clean', 'Open Zsh Without User Startup Files', 'Open interactive Zsh with user startup files disabled', 'System', 'zsh', ['-f', '-i'], { supportedPlatforms: zshPlatforms, interactive: true, mutation: true, risk: 'caution', aliases: ['zsh clean', 'zsh no rc', 'zsh -f'] })
pack('zsh.path', 'Show Zsh PATH', 'List inherited PATH entries in a fresh Zsh without user startup files', 'System', 'zsh', ['-f', '-c', 'print -rl -- $path'], { supportedPlatforms: zshPlatforms })
pack('zsh.options', 'Show Zsh Options', 'Show options in a fresh Zsh without user startup files', 'System', 'zsh', ['-f', '-c', 'set -o'], { supportedPlatforms: zshPlatforms })
pack('zsh.keybindings', 'Show Zsh Default Keybindings', 'List default keybindings without loading your user configuration', 'System', 'zsh', ['-f', '-c', 'bindkey'], { supportedPlatforms: zshPlatforms })
pack('zsh.which', 'Find Command in Zsh', 'Find command locations or builtin definitions without executing the command', 'System', 'zsh', ['-f', '-c', 'whence -a -- "$1"', 'devcommand', param('commandName')], { parameters: [name('commandName', 'Command name', 'git')], supportedPlatforms: zshPlatforms, aliases: ['zsh which', 'zsh whence', 'find executable'] })
pack('zsh.syntax', 'Check Zsh Config Syntax', 'Parse a selected Zsh startup file without executing its commands', 'System', 'zsh', ['-f', '-n', '--', param('configFile')], { parameters: [choice('configFile', 'Config file', ['.zshrc', '.zprofile', '.zshenv', '.zlogin', '.zlogout'])], supportedPlatforms: zshPlatforms, aliases: ['zsh syntax', 'zshrc check', 'zsh -n'] })
export const registry: readonly Definition[] = definitions
export function getDefinition(id: string): Definition {
  const definition = registry.find((entry) => entry.id === id)
  if (!definition) throw new PublicError('Unknown built-in command.')
  return definition
}
export function validateParams(definition: Definition, input: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, z.ZodType> = {}
  for (const field of definition.parameters) {
    const schema = field.options ? z.enum(field.options as [string, ...string[]]) : z.string().min(field.required ? 1 : 0).max(2048).refine((value) => !hasControlCharacters(value))
    fields[field.key] = field.required ? schema : schema.optional().default(field.defaultValue ?? '')
  }
  const result = z.object(fields).strict().safeParse(input)
  if (!result.success) throw new PublicError('Fill in all required parameters using valid values.')
  const values = result.data as Record<string, string>
  if (definition.id.startsWith('cloudflared.') || definition.id.startsWith('ngrok.')) {
    if (values.tunnel && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(values.tunnel)) throw new PublicError('Use a tunnel name or UUID without options, paths or whitespace.')
    if (values.publicUrl) {
      let valid = false
      try { const url = new URL(values.publicUrl); valid = url.protocol === 'https:' && /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(url.hostname) && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash } catch { /* Invalid endpoint is rejected below. */ }
      if (!valid || /[\s\\]/.test(values.publicUrl)) throw new PublicError('Use an HTTPS endpoint URL without credentials, a port, path or query parameters.')
    }
    if (values.originUrl) {
      let valid = false
      try { const url = new URL(values.originUrl); valid = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash } catch { /* Invalid URL is rejected below. */ }
      if (!valid || /[\s\\]/.test(values.originUrl)) throw new PublicError('Use a local HTTP(S) URL, such as http://localhost:3000, without credentials or query parameters.')
    }
  }
  if (definition.id.startsWith('find.')) {
    if (values.extension && !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/.test(values.extension)) throw new PublicError('Use an extension without a leading dot, wildcard or path separator.')
    if (values.size && !/^[1-9]\d{0,5}[ckMG]$/.test(values.size)) throw new PublicError('Use a positive size with c, k, M or G, such as 100M.')
    if (values.pattern?.includes('/')) throw new PublicError('Use a filename pattern without directory separators. Choose the search directory separately.')
  }
  if (definition.id === 'zsh.which' && !/^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,79}$/.test(values.commandName)) throw new PublicError('Use a command name without options, paths, whitespace or shell expressions.')
  if (definition.category === 'Permissions') {
    const identity = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/
    if (values.mode?.startsWith('-')) throw new PublicError('Specify who to change, for example u-w or go-r.')
    if (values.mode && !/^(?:0?[0-7]{3}|(?:[ugoa]*[+\-=][rwxX]+)(?:,[ugoa]*[+\-=][rwxX]+)*)$/.test(values.mode)) throw new PublicError('Use a mode such as 755, 0644 or u+x,go-w.')
    if (values.owner && (!/^[^:]+(?::[^:]+)?$/.test(values.owner) || !values.owner.split(':').every((part) => identity.test(part)))) throw new PublicError('Use an OS owner or owner:group without options or whitespace.')
    if (values.identity && !identity.test(values.identity)) throw new PublicError('Use a valid OS user or group name.')
    if (values.index && !/^(?:0|[1-9]\d{0,3})$/.test(values.index)) throw new PublicError('Use a non-negative ACL entry index.')
  }
  if (definition.category === 'SSH') {
    if (values.host && !/^(?:[A-Za-z0-9][A-Za-z0-9_.-]{0,252}|[a-fA-F0-9:]+)$/.test(values.host)) throw new PublicError('Use a hostname, IPv4/IPv6 address or SSH alias without options, whitespace or commands.')
    if (values.user && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(values.user)) throw new PublicError('Use a valid SSH username.')
    if (values.keyName && (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(values.keyName) || values.keyName.endsWith('.pub'))) throw new PublicError('Use a key basename from your SSH directory, without a path or .pub suffix.')
    if (values.comment && values.comment.length > 120) throw new PublicError('Keep the public comment within 120 characters.')
  }
  if (values.pid && (!/^[1-9]\d{0,9}$/.test(values.pid) || Number(values.pid) <= 1 || Number(values.pid) > 2147483647)) throw new PublicError('Use a positive process PID greater than 1.')
  if (values.port && (!/^\d{1,5}$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)) throw new PublicError('Use a numeric TCP port from 1 to 65535.')
  for (const key of ['name', 'newName']) if (values[key] && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(values[key])) throw new PublicError('Remote names must start with a letter or digit and contain only letters, digits, dot, underscore or dash.')
  for (const key of ['branch', 'newBranch', 'ref']) if (values[key] && (!/^[A-Za-z0-9][A-Za-z0-9/._~-]*(?:\^[0-9]*)?$/.test(values[key]) || values[key].includes('..') || values[key].includes('//') || values[key].endsWith('.lock'))) throw new PublicError('Use a valid branch name or commit reference, without options or revision ranges.')
  if (values.expectedOid && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(values.expectedOid)) throw new PublicError('Expected stash commit must be a full Git object ID.')
  if (values.stash && !/^stash@\{\d{1,4}\}$/.test(values.stash)) throw new PublicError('Use a stash reference such as stash@{0}.')
  if (values.url) {
    const ssh = /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9_./~-]+$/.test(values.url) && !values.url.includes('://')
    let secure = false
    try { const url = new URL(values.url); secure = ['https:', 'ssh:'].includes(url.protocol) && /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[A-Fa-f0-9:]+\])$/.test(url.hostname) && /^\/[A-Za-z0-9_./~+-]+$/.test(url.pathname) && !url.password && (!url.username || (url.protocol === 'ssh:' && /^[A-Za-z0-9_.-]+$/.test(url.username))) && !url.search && !url.hash } catch { /* SCP-style SSH URLs are checked above. */ }
    if ((!ssh && !secure) || /[\s\\]/.test(values.url) || /gh[pousr]_|github_pat_|token[=:]/i.test(values.url)) throw new PublicError('Use a credential-free HTTPS or SSH remote URL, without query parameters, fragments or whitespace.')
  }
  for (const field of definition.parameters) if (!field.sensitive && redact(values[field.key]) !== values[field.key]) throw new PublicError('Remove tokens or credentials from command parameters.')
  return values
}
export function expand(definition: Definition, params: Record<string, string>): string[] {
  return definition.arguments.map((arg) => typeof arg === 'string' ? arg : ('flag' in arg ? arg.flag : '') + params[arg.param])
}
export function quotePosix(value: string): string { return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'` }
export function displayCommand(executable: string, argv: string[]): string { return [executable, ...argv].map(quotePosix).join(' ') }
