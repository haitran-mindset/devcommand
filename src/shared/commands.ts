import { z } from 'zod'
import type { ApiResult } from './contracts'
import type { ExecutionSnapshot, TerminalSession } from './runtime'

export const commandRequestSchema = z.object({ commandId: z.string().min(1).max(80), params: z.record(z.string().max(40), z.union([z.string().max(2048), z.boolean()])).default({}), workspaceId: z.string().uuid().optional() }).strict()
export const commandExecuteSchema = z.object({ request: commandRequestSchema, confirmationToken: z.string().uuid().optional() }).strict()
export const searchSchema = z.object({ query: z.string().max(200).default(''), category: z.enum(['all', 'Git', 'General', 'Node', 'Flutter', 'System', 'Permissions', 'AI Developer CLI', 'SSH']).default('all'), risk: z.enum(['all', 'safe', 'caution', 'dangerous']).default('all'), platform: z.enum(['all', 'darwin', 'win32', 'linux']).default('all'), favoritesOnly: z.boolean().default(false) }).strict()
export type CommandRequest = z.infer<typeof commandRequestSchema>
export const favoriteMoveSchema = z.object({ sourceId: z.string().min(1).max(80), targetId: z.string().min(1).max(80), placement: z.enum(['before', 'after']) }).strict()
export type FavoriteMove = z.infer<typeof favoriteMoveSchema>
export type SearchRequest = z.infer<typeof searchSchema>
export interface CommandParameter { key: string; label: string; type: 'string' | 'enum'; required: boolean; defaultValue?: string; options?: string[]; optionLabels?: Record<string, string>; sensitive?: boolean }
export interface CommandSummary {
  id: string; title: string; description: string; category: 'Git' | 'General' | 'Node' | 'Flutter' | 'System' | 'Permissions' | 'AI Developer CLI' | 'SSH'; aliases: string[];
  risk: 'safe' | 'caution' | 'dangerous'; parameters: CommandParameter[]; examples: string[];
  supportedPlatforms: ('darwin' | 'win32' | 'linux')[]; requiresRepository: boolean; interactive?: boolean; favorite: boolean; unavailableReason?: string
}
export interface Workspace { id: string; name: string; rootPath: string; favorite: boolean; lastOpenedAt: string }
export interface RepositoryStatus {
  rootPath: string; branch: string; head: string; clean: boolean; bare: boolean; unborn: boolean; detached: boolean;
  conflicts: boolean; upstream?: string; remotes: { name: string; fetchUrl: string; pushUrl: string }[]
}
export interface CommandPreview {
  display: string; cwd: string; risk: CommandSummary['risk']; consequences: string[];
  confirmationToken?: string; expiresAt?: string; repository?: RepositoryStatus
}
export interface HistoryEntry { request: CommandRequest; execution: ExecutionSnapshot; rerunnable: boolean }
export interface WorkspaceAPI {
  workspace: {
    open(id: string): Promise<ApiResult<null>>
    list(): Promise<ApiResult<{ entries: Workspace[]; selectedId: string | null }>>
    addDirectory(): Promise<ApiResult<Workspace | null>>
    select(id: string): Promise<ApiResult<null>>
    remove(id: string): Promise<ApiResult<null>>
    favorite(id: string, favorite: boolean): Promise<ApiResult<null>>
    status(id: string): Promise<ApiResult<RepositoryStatus>>
  }
  library: {
    search(request: SearchRequest): Promise<ApiResult<CommandSummary[]>>
    preview(request: CommandRequest): Promise<ApiResult<CommandPreview>>
    execute(request: CommandRequest, confirmationToken?: string): Promise<ApiResult<{ executionId: string }>>
    favorite(commandId: string, favorite: boolean): Promise<ApiResult<null>>
    moveFavorite(input: FavoriteMove): Promise<ApiResult<null>>
    clearHistory(): Promise<ApiResult<null>>
    history(): Promise<ApiResult<HistoryEntry[]>>
    onHistoryError(handler: (message: string) => void): () => void
    launch(request: CommandRequest, confirmationToken: string): Promise<ApiResult<TerminalSession>>
    insert(request: CommandRequest): Promise<ApiResult<TerminalSession>>
  }
}
