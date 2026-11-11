import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { dockerActionSchema, type DockerAction, type DockerSnapshot, type SshPreview } from '../../../shared/extended'
import { Confirmations, hash } from '../../security/confirmations'
import { PublicError } from '../../security/errors'
import { findExecutable, type ProbeRun } from '../cli/probe'
import { redact } from '../execution/redact'
import { displayCommand } from '../commands/registry'
import type { WorkspaceService } from '../workspace/service'
import type { ManagedRunner } from '../execution/runner'

const row = z.record(z.string(), z.unknown())
const clean = (value: unknown) => typeof value === 'string' ? [...redact(value)].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 2000) : ''
function rows(text: string) { return text.trim() ? text.trim().split('\n').map((line) => row.parse(JSON.parse(line))) : [] }
function validateEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    if (!['unix:', 'npipe:', 'tcp:', 'ssh:'].includes(url.protocol) || url.password || (url.username && url.protocol !== 'ssh:') || url.search || url.hash || /[\r\n\0]/.test(endpoint)) throw new Error()
    return endpoint
  } catch { throw new PublicError('Docker endpoint must be credential-free and use a supported transport.') }
}
export class DockerService {
  private confirmations = new Confirmations()
  private validating = false
  private active = new Set<string>()
  constructor(private probe: ProbeRun, private workspace: WorkspaceService, private runner: ManagedRunner) {}
  private async target() {
    const current = await this.probe('docker', ['context', 'show'])
    if (current.code !== 0) throw new PublicError('Unable to read the active Docker context.')
    const context = current.stdout.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(context)) throw new PublicError('The active Docker context has an unsupported name.')
    const direct = !process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST
    if (direct) {
      return { context: 'DOCKER_HOST', endpoint: validateEndpoint(direct), args: ['--host', direct] }
    }
    const inspected = await this.probe('docker', ['context', 'inspect', context])
    if (inspected.code !== 0) throw new PublicError('Unable to inspect the active Docker context.')
    const values = z.array(z.object({ Endpoints: z.object({ docker: z.object({ Host: z.string() }) }) })).parse(JSON.parse(inspected.stdout))
    const endpoint = values[0]?.Endpoints.docker.Host
    if (!endpoint || redact(endpoint) !== endpoint) throw new PublicError('Docker context has an unsupported or credential-bearing endpoint.')
    return { context, endpoint: validateEndpoint(endpoint), args: ['--context', context] }
  }
  private async read(args: string[], command: string[]) {
    const result = await this.probe('docker', [...args, ...command])
    if (result.code !== 0) throw new PublicError('Docker could not read this daemon. Check the engine, context and permissions, then refresh.')
    return result.stdout
  }
  private async load() {
    const target = await this.target()
    const info = row.parse(JSON.parse(await this.read(target.args, ['info', '--format', '{{json .}}'])))
    const result = await Promise.all([
      this.read(target.args, ['ps', '--all', '--no-trunc', '--format', '{{json .}}']),
      this.read(target.args, ['image', 'ls', '--no-trunc', '--format', '{{json .}}']),
      this.read(target.args, ['volume', 'ls', '--format', '{{json .}}']),
      this.read(target.args, ['network', 'ls', '--no-trunc', '--format', '{{json .}}'])
    ])
    const snapshot: DockerSnapshot = { cliAvailable: true, daemonAvailable: true, context: target.context, endpoint: clean(target.endpoint), daemonId: clean(info.ID), version: clean(info.ServerVersion),
      containers: rows(result[0]).map((r) => ({ id: clean(r.ID), name: clean(r.Names), image: clean(r.Image), state: clean(r.State), status: clean(r.Status), ports: clean(r.Ports) })),
      images: rows(result[1]).map((r) => ({ id: clean(r.ID), repository: clean(r.Repository), tag: clean(r.Tag), size: clean(r.Size) })),
      volumes: rows(result[2]).map((r) => ({ name: clean(r.Name), driver: clean(r.Driver) })),
      networks: rows(result[3]).map((r) => ({ id: clean(r.ID), name: clean(r.Name), driver: clean(r.Driver) })) }
    if (!snapshot.daemonId) throw new PublicError('Docker daemon identity is unavailable; controlled actions are disabled.')
    return { snapshot, target }
  }
  async snapshot(): Promise<DockerSnapshot> {
    const empty: DockerSnapshot = { cliAvailable: !!findExecutable('docker'), daemonAvailable: false, context: '', endpoint: '', daemonId: '', version: '', containers: [], images: [], volumes: [], networks: [] }
    if (!empty.cliAvailable) return { ...empty, reason: 'Docker CLI is not installed or is absent from the application PATH.' }
    try { return (await this.load()).snapshot } catch (error) { return { ...empty, reason: error instanceof PublicError ? error.message : 'Unable to read Docker metadata. Check the CLI version and daemon, then refresh.' } }
  }
  private async prepare(input: DockerAction) {
    const action = dockerActionSchema.parse(input), { snapshot, target } = await this.load()
    const argv = [...target.args], consequences = [`Target: ${snapshot.context} · ${snapshot.endpoint} · daemon ${snapshot.daemonId}.`]
    let cwd = homedir(), identity: unknown
    if (action.kind.startsWith('container.')) {
      const entity = snapshot.containers.find((entry) => entry.id === action.target)
      if (!entity || !/^[a-f0-9]{64}$/.test(entity.id)) throw new PublicError('The selected container no longer exists. Refresh the list.')
      identity = entity
      const operation = action.kind.split('.')[1]
      if (operation === 'remove' && entity.state !== 'exited' && entity.state !== 'created' && entity.state !== 'dead') throw new PublicError('Stop the container before removing it. Force removal is unavailable.')
      if (operation === 'logs' || operation === 'follow') { argv.push('logs', '--tail', '200', ...(operation === 'follow' ? ['--follow'] : []), entity.id); consequences.push('Shows up to 200 recent log lines. Follow stops after 60 seconds or on Cancel. Output stays in memory and is not saved to history.') }
      else { argv.push(operation === 'remove' ? 'rm' : operation, entity.id); consequences.push(operation === 'remove' ? 'Deletes this stopped container and its writable layer. Volumes are preserved; container-layer data cannot be recovered here.' : `${operation} affects this container and may interrupt its services.`) }
    } else if (action.kind === 'image.remove') {
      const entity = snapshot.images.find((entry) => entry.id === action.target)
      if (!entity || !/^sha256:[a-f0-9]{64}$/.test(entity.id)) throw new PublicError('The selected full image ID no longer exists.')
      identity = entity; argv.push('image', 'rm', entity.id); consequences.push('Removes the image without force. Docker refuses images still referenced by containers or multiple tags.')
    } else if (action.kind === 'volume.remove') {
      const entity = snapshot.volumes.find((entry) => entry.name === action.target)
      if (!entity) throw new PublicError('The selected volume no longer exists.')
      const refs = await this.read(target.args, ['ps', '--all', '--quiet', '--filter', `volume=${entity.name}`])
      if (refs.trim()) throw new PublicError('This volume is referenced by a container. Remove those references outside this action first.')
      const details = z.array(z.object({ Name: z.string(), CreatedAt: z.string().optional(), Mountpoint: z.string(), Driver: z.string() })).parse(JSON.parse(await this.read(target.args, ['volume', 'inspect', entity.name])))
      identity = details; argv.push('volume', 'rm', entity.name); consequences.push('PERMANENT DATA LOSS: deletes this unused volume and all its data. There is no automatic backup or undo. Docker must still consider it unused at execution.')
    } else if (action.kind === 'network.remove') {
      const entity = snapshot.networks.find((entry) => entry.id === action.target)
      if (!entity || !/^[a-f0-9]{64}$/.test(entity.id) || ['bridge', 'host', 'none'].includes(entity.name)) throw new PublicError('Choose an existing custom network. Built-in networks cannot be removed.')
      const details = z.array(z.object({ Id: z.string(), Containers: z.record(z.string(), z.unknown()).nullable().optional() })).parse(JSON.parse(await this.read(target.args, ['network', 'inspect', entity.id])))
      if (!details.length || Object.keys(details[0].Containers ?? {}).length) throw new PublicError('Disconnect all containers before removing this network.')
      identity = entity; argv.push('network', 'rm', entity.id); consequences.push('Removes this empty custom network without force.')
    } else {
      if (!action.workspaceId) throw new PublicError('Select a Git workspace containing a Compose file first.')
      cwd = (await this.workspace.resolve(action.workspaceId)).rootPath
      const files = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].filter((name) => { try { return lstatSync(join(cwd, name)).isFile() } catch { return false } })
      if (files.length !== 1) throw new PublicError('The workspace must contain exactly one standard Compose file; select a workspace with an unambiguous configuration.')
      const bounded = (name: string) => { const path = join(cwd, name); try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new PublicError('Compose files and .env must be bounded regular files without symlinks.'); return hash(readFileSync(path).toString('utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error } }
      identity = [cwd, files[0], bounded(files[0]), bounded('.env')]
      const compose = ['compose', '--project-directory', cwd, '--file', join(cwd, files[0])]
      // Hash effective configuration, including resolved includes/extends/env_file and interpolation.
      // Never return or persist it: normalized environment values may contain local secrets.
      const effective = row.parse(JSON.parse(await this.read(target.args, [...compose, 'config', '--format', 'json'])))
      if (Object.keys((effective.configs ?? {}) as object).length || Object.keys((effective.secrets ?? {}) as object).length) throw new PublicError('Controlled Compose currently excludes configs/secrets file references. Manage this project outside DevCommand.')
      identity = [identity, hash(JSON.stringify(effective))]
      argv.push(...compose, ...(action.kind === 'compose.up' ? ['up', '--detach', '--no-build', '--pull', 'never'] : ['down']))
      consequences.push(`Compose target directory: ${cwd}. File: ${files[0]}.`, 'Compose executes repository-defined services using local Docker privileges and may read referenced configuration, bind-mount files, or access networks. Only proceed with trusted repository content.', action.kind === 'compose.up' ? 'Starts services using existing images; builds and image pulls are disabled.' : 'Stops and removes the Compose containers and networks. Named volumes are preserved; writable container layers are lost.')
    }
    return { action, argv, cwd, consequences, state: hash(JSON.stringify([target, snapshot.daemonId, identity])), display: displayCommand('docker', argv) }
  }
  async preview(action: DockerAction): Promise<SshPreview> {
    const prepared = await this.prepare(action)
    return { ...this.confirmations.issue(prepared.action, prepared.state), display: prepared.display, consequences: prepared.consequences }
  }
  async execute(action: DockerAction, token: string): Promise<{ kind: 'execution'; executionId: string }> {
    const expected = this.confirmations.take(token, dockerActionSchema.parse(action))
    if (this.validating || this.runner.list().some((job) => this.active.has(job.id) && !job.finishedAt)) throw new PublicError('Wait for the current Docker operation to finish before starting another.')
    this.validating = true
    try {
      const prepared = await this.prepare(action)
      if (expected !== prepared.state) throw new PublicError('Docker context, daemon or selected resource changed. Review a fresh preview.')
      const executable = findExecutable('docker'); if (!executable) throw new PublicError('Docker CLI is no longer available.')
      const executionId = this.runner.execute({ commandId: `docker.${action.kind}`, executable, argv: prepared.argv, cwd: prepared.cwd, preview: prepared.display, timeoutMs: 60000 })
      for (const id of this.active) if (!this.runner.list().some((job) => job.id === id && !job.finishedAt)) this.active.delete(id)
      this.active.add(executionId)
      return { kind: 'execution', executionId }
    } finally { this.validating = false }
  }
  clear() { this.confirmations.clear() }
}
