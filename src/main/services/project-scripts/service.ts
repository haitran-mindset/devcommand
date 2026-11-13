import { constants, type Dirent } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { hasControlCharacters } from '../../../shared/text'
import { Confirmations, hash } from '../../security/confirmations'
import { PublicError } from '../../security/errors'
import { projectScriptRequestSchema, projectScriptsListSchema, type ProjectScript, type ProjectScriptRequest } from '../../../shared/project-scripts'
import type { WorkspaceService } from '../workspace/service'
import type { TerminalManager } from '../terminal/manager'
import { findExecutable } from '../cli/probe'

const safeName = /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,149}$/
const quote = (value: string) => /^[A-Za-z0-9_./:-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"
export function parseMakeTargets(text: string): string[] {
  const targets = new Set<string>()
  let definition = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:override\s+)?define\b/.test(line)) { definition = true; continue }
    if (/^\s*endef\b/.test(line)) { definition = false; continue }
    if (definition || /^\s|^#/.test(line)) continue
    const match = /^([^:=]+):(?!=)(.*)$/.exec(line)
    if (!match || /\$|%|=/.test(match[1]) || /^[^;#]*=/.test(match[2])) continue
    for (const name of match[1].trim().split(/\s+/)) if (safeName.test(name) && !name.startsWith('.')) targets.add(name)
    if (targets.size > 500) throw new PublicError('Makefile has too many targets (maximum 500).')
  }
  return [...targets]
}
export class ProjectScriptsService {
  private confirmations = new Confirmations()
  private generation = 0
  constructor(private workspace: WorkspaceService, private terminals: TerminalManager) {}
  async list(input: { workspaceId: string }) {
    const { workspaceId } = projectScriptsListSchema.parse(input)
    const cwd = await realpath((await this.workspace.resolve(workspaceId)).rootPath)
    const directory = await stat(cwd, { bigint: true })
    const warnings: string[] = [], contents: [string, string][] = []
    let scannedBytes = 0
    const listDirectory = async (path: string): Promise<Dirent[]> => {
      const entries: Dirent[] = []
      const directory = await opendir(path)
      for await (const entry of directory) {
        if (entries.length >= 1000) { warnings.push('Directory discovery is limited to the first 1000 entries.'); break }
        entries.push(entry)
      }
      return entries
    }
    const read = async (name: string): Promise<string | null> => {
      let file
      try {
        const path = await realpath(join(cwd, name)), pathFromRoot = relative(cwd, path)
        if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) throw new Error('outside')
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        const info = await file.stat()
        if (!info.isFile() || info.size > 1_048_576) throw new Error('size')
        if (scannedBytes + info.size > 8_388_608) { warnings.push('Script discovery reached its 8 MB read limit.'); return null }
        const buffer = Buffer.alloc(1_048_577)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        scannedBytes += bytesRead
        if (bytesRead > 1_048_576) throw new Error('size')
        const text = buffer.subarray(0, bytesRead).toString('utf8')
        contents.push([name, hash(text)]); return text
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        warnings.push(`Unable to read ${name}. Use a regular file inside the repository, no larger than 1 MB.`); return null
      } finally { await file?.close() }
    }
    const scripts: ProjectScript[] = []
    const manifest = await read('package.json')
    if (manifest !== null) {
      try {
        const parsed = z.object({ scripts: z.record(z.string(), z.string()).default({}), packageManager: z.string().optional() }).parse(JSON.parse(manifest))
        const declared = parsed.packageManager?.split('@')[0]
        const locks: string[] = []
        for (const [file, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']] as const) {
          // Lock contents are irrelevant; only use a bounded metadata check.
          try { if ((await stat(join(cwd, file))).isFile()) locks.push(manager) } catch { /* Optional lock. */ }
        }
        const managers = [...new Set(locks)]
        const runner = declared && ['npm', 'pnpm', 'yarn', 'bun'].includes(declared) ? declared : managers.length === 1 ? managers[0] : 'npm'
        if (managers.length > 1 && !declared) warnings.push('Multiple lockfile types found. Using npm; set packageManager in package.json to choose explicitly.')
        if (declared && !['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) warnings.push('Unsupported packageManager. Using the detected lockfile manager or npm.')
        for (const [name, definition] of Object.entries(parsed.scripts)) {
          if (!safeName.test(name) || definition.length > 8192 || hasControlCharacters(definition.replace(/[\n\t]/g, ''))) { warnings.push('Some package scripts were skipped because their names or definitions are unsupported.'); continue }
          if (scripts.length >= 500) throw new PublicError('Too many package scripts (maximum 500).')
          const args = runner === 'npm' ? ['run', '--', name] : ['run', name]
          scripts.push({ id: `package:${name}`, name, source: 'package.json', sourceFile: 'package.json', runner, args, command: `${runner} run ${quote(name)}`, definition })
        }
      } catch { warnings.push('Unable to parse package.json scripts. Check that it contains valid JSON and string-valued scripts.') }
    }
    // GNU make chooses the first available file in this exact order.
    for (const name of ['GNUmakefile', 'makefile', 'Makefile']) {
      const text = await read(name)
      if (text === null) continue
      const filenames = (await listDirectory(cwd)).map(entry => entry.name)
      const sourceFile = filenames.find(file => file === name) ?? filenames.find(file => file.toLowerCase() === name.toLowerCase()) ?? name
      for (const target of parseMakeTargets(text)) scripts.push({ id: `make:${target}`, name: target, source: 'Makefile', sourceFile, runner: 'make', args: ['-f', sourceFile, '--', target], command: `make -f ${quote(sourceFile)} -- ${quote(target)}`, definition: `Target in ${sourceFile}` })
      warnings.push('Makefile discovery reads direct target declarations only. Includes, variables and generated targets are not expanded; make may execute additional recipes when run.')
      break
    }
    // Discover only regular .sh files at root and directly inside scripts/; never recurse or execute discovery tools.
    let shellCandidates = 0
    for (const folder of ['', 'scripts']) {
      let files
      try {
        const directoryPath = await realpath(join(cwd, folder))
        const fromRoot = relative(cwd, directoryPath)
        if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) { warnings.push('Skipped scripts/ because it resolves outside the repository.'); continue }
        files = await listDirectory(directoryPath)
      } catch { continue }
      for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!file.isFile() || !file.name.endsWith('.sh') || hasControlCharacters(file.name) || file.name.length > 150) continue
        if (shellCandidates >= 200) { warnings.push('Only the first 200 shell script candidates are scanned.'); break }
        shellCandidates++
        const sourceFile = folder ? `${folder}/${file.name}` : file.name
        const text = await read(sourceFile)
        if (text === null) continue
        if (text.includes('\0')) { warnings.push(`Skipped binary shell script ${sourceFile}.`); continue }
        const shebang = text.split(/\r?\n/, 1)[0]
        const header = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?|\/(?:usr\/)?bin\/)(bash|zsh|sh)(?:\s+(.*))?$/.exec(shebang)
        if (shebang.startsWith('#!') && !header) { warnings.push(`Skipped ${sourceFile}: only sh, bash and zsh scripts are supported.`); continue }
        const options = header?.[2]?.trim().split(/\s+/).filter(Boolean) ?? []
        if (options.some(option => !/^-[euxvfn]+$/.test(option))) { warnings.push(`Skipped ${sourceFile}: unsupported interpreter options in its shebang.`); continue }
        const runner = header?.[1] ?? 'sh', args = [...options, `./${sourceFile}`]
        const description = text.split(/\r?\n/).find(line => /^#\s+\S/.test(line))?.replace(/^#\s+/, '').slice(0, 240) ?? 'Shell script in this repository'
        scripts.push({ id: `shell:${sourceFile}`, name: file.name, source: 'Shell script', sourceFile, runner, args, command: [runner, ...args].map(quote).join(' '), definition: description })
      }
    }
    return { cwd, scripts, warnings: [...new Set(warnings)], revision: hash(JSON.stringify([cwd, String(directory.dev), String(directory.ino), contents, scripts])) }
  }
  private async prepare(input: ProjectScriptRequest) {
    const request = projectScriptRequestSchema.parse(input)
    if (process.platform === 'win32') throw new PublicError('Project Scripts currently supports macOS and Linux.')
    const snapshot = await this.list({ workspaceId: request.workspaceId })
    if (snapshot.revision !== request.revision) throw new PublicError('Project scripts changed. Refresh the list and review again.')
    const script = snapshot.scripts.find(entry => entry.id === request.id)
    if (!script) throw new PublicError('This script is no longer available.')
    const executable = findExecutable(script.runner)
    if (!executable) throw new PublicError(`Install ${script.runner} and restart DevCommand to run this script.`)
    return { request, snapshot, script, executable, state: hash(JSON.stringify([snapshot.revision, executable, script])) }
  }
  async preview(input: ProjectScriptRequest) {
    const generation = this.generation, prepared = await this.prepare(input)
    if (generation !== this.generation) throw new PublicError('Session changed. Review again.')
    return { ...this.confirmations.issue(prepared.request, prepared.state), command: prepared.script.command, definition: prepared.script.definition, cwd: prepared.snapshot.cwd }
  }
  async run(input: ProjectScriptRequest, token: string) {
    const generation = this.generation, request = projectScriptRequestSchema.parse(input)
    const expected = this.confirmations.take(token, request), prepared = await this.prepare(request)
    if (generation !== this.generation || expected !== prepared.state) throw new PublicError('Project changed. Review again.')
    return this.terminals.startProgram({ executable: prepared.executable, argv: prepared.script.args, cwd: prepared.snapshot.cwd, label: prepared.script.name, keepShell: true })
  }
  clear() { this.generation++; this.confirmations.clear() }
}
