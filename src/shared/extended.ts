import { z } from 'zod'
import { hasControlCharacters } from './text'
import type { ApiResult } from './contracts'
import type { TerminalSession } from './runtime'
const safe = (max: number) => z.string().max(max).refine((value) => !hasControlCharacters(value))
export const sshName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
const hostFields = { alias: sshName, hostName: z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252}|[a-fA-F0-9:]+)$/), user: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/), port: z.number().int().min(1).max(65535), identityName: z.union([sshName, z.literal('')]), revision: z.string().regex(/^[a-f0-9]{64}$/) }
export const sshActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('key.generate'), name: sshName, comment: safe(120) }).strict(),
  z.object({ kind: z.literal('agent.add'), publicKeyName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.pub$/), fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]+$/) }).strict(),
  z.object({ kind: z.enum(['host.add', 'host.update']), ...hostFields }).strict(),
  z.object({ kind: z.literal('host.remove'), alias: sshName, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal('connection.test'), alias: sshName, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
])
export type SshAction = z.infer<typeof sshActionSchema>
export interface SshKey { name: string; type: string; fingerprint: string; comment: string; privateAvailable: boolean }
export interface SshHost { alias: string; hostName: string; user: string; port: number; identityName: string; editable: boolean; reason?: string }
export interface SshSnapshot { directory: string; revision: string; keys: SshKey[]; hosts: SshHost[]; agent: { available: boolean; message: string; identities: string[] }; tools: Record<'ssh' | 'ssh-keygen' | 'ssh-add', boolean>; writable: boolean; notices: string[] }
export interface SshPreview { token: string; expiresAt: string; display: string; consequences: string[] }
export type SshResult = { kind: 'terminal'; session: TerminalSession } | { kind: 'config'; backupPath?: string } | { kind: 'execution'; executionId: string }
export interface DockerContainer { id: string; name: string; image: string; state: string; status: string; ports: string }
export interface DockerImage { id: string; repository: string; tag: string; size: string }
export interface DockerVolume { name: string; driver: string }
export interface DockerNetwork { id: string; name: string; driver: string }
export interface DockerSnapshot { cliAvailable: boolean; daemonAvailable: boolean; reason?: string; context: string; endpoint: string; daemonId: string; version: string; containers: DockerContainer[]; images: DockerImage[]; volumes: DockerVolume[]; networks: DockerNetwork[] }
export const dockerActionSchema = z.object({ kind: z.enum(['container.start', 'container.stop', 'container.restart', 'container.remove', 'container.logs', 'container.follow', 'image.remove', 'volume.remove', 'network.remove', 'compose.up', 'compose.down']), target: z.string().max(255).regex(/^(?:sha256:)?[A-Za-z0-9][A-Za-z0-9_.-]*$/), workspaceId: z.string().uuid().optional() }).strict()
export type DockerAction = z.infer<typeof dockerActionSchema>
export interface ExtendedAPI {
  ssh: {
    snapshot(): Promise<ApiResult<SshSnapshot>>
    publicKey(name: string): Promise<ApiResult<string>>
    preview(action: SshAction): Promise<ApiResult<SshPreview>>
    execute(action: SshAction, token: string): Promise<ApiResult<SshResult>>
    onChanged(handler: () => void): () => void
  }
  docker: {
    snapshot(): Promise<ApiResult<DockerSnapshot>>
    preview(action: DockerAction): Promise<ApiResult<SshPreview>>
    execute(action: DockerAction, token: string): Promise<ApiResult<{ kind: 'execution'; executionId: string }>>
  }
}
