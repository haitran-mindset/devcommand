import { z } from 'zod'
import type { ApiResult } from './contracts'
import type { TerminalSession } from './runtime'
export const projectScriptsListSchema = z.object({ workspaceId: z.uuid() }).strict()
export const projectScriptRequestSchema = projectScriptsListSchema.extend({ id: z.string().min(1).max(600), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export type ProjectScriptRequest = z.infer<typeof projectScriptRequestSchema>
export interface ProjectScript { id: string; name: string; source: 'package.json' | 'Makefile' | 'Shell script'; sourceFile: string; command: string; definition: string; runner: string; args: string[] }
export interface ProjectScriptsSnapshot { cwd: string; revision: string; scripts: ProjectScript[]; warnings: string[] }
export interface ProjectScriptPreview { command: string; definition: string; cwd: string; token: string; expiresAt: string }
export interface ProjectScriptsAPI { projectScripts: {
  list(input: { workspaceId: string }): Promise<ApiResult<ProjectScriptsSnapshot>>
  preview(input: ProjectScriptRequest): Promise<ApiResult<ProjectScriptPreview>>
  run(input: ProjectScriptRequest & { token: string }): Promise<ApiResult<TerminalSession>>
} }
