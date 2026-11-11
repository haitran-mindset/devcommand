import { z } from 'zod'
import type { ApiResult } from './contracts'

export const idSchema = z.string().uuid()
export const terminalCreateSchema = z.object({
  shellId: z.string().min(1).max(40), cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(200)
}).strict()
export const terminalWriteSchema = z.object({ sessionId: idSchema, data: z.string().min(1).max(16384) }).strict()
export const terminalResizeSchema = z.object({ sessionId: idSchema, cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(200) }).strict()
export const terminalAckSchema = z.object({ sessionId: idSchema, sequence: z.number().int().positive() }).strict()
export const executeSchema = z.object({ commandId: z.enum(['git.version', 'node.version']) }).strict()
export type CreateTerminalRequest = z.infer<typeof terminalCreateSchema>
export interface TerminalEnvironment { cwd: string; shells: { id: string; label: string }[]; defaultShellId: string }
export interface TerminalSession { id: string; shell: string; cwd: string; status: 'running' | 'exited'; exitCode?: number }
export interface TerminalDataEvent { sessionId: string; sequence: number; data: string }
export interface TerminalExitEvent { sessionId: string; exitCode: number; signal?: number }
export type ExecutionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out'
export interface ExecutionOutput { sequence: number; stream: 'stdout' | 'stderr'; data: string }
export interface ExecutionSnapshot {
  id: string; commandId: string; preview: string; status: ExecutionStatus; startedAt: string;
  finishedAt?: string; exitCode: number | null; signal: string | null; output: ExecutionOutput[];
  truncated: boolean; error?: string
}
export type ExecutionEvent = { executionId: string; sequence: number } & (
  { type: 'output'; stream: 'stdout' | 'stderr'; data: string } |
  { type: 'status'; status: ExecutionStatus }
)
export interface RuntimeAPI {
  terminal: {
    environment(): Promise<ApiResult<TerminalEnvironment>>
    create(options: CreateTerminalRequest): Promise<ApiResult<TerminalSession>>
    write(sessionId: string, data: string): Promise<ApiResult<null>>
    resize(sessionId: string, cols: number, rows: number): Promise<ApiResult<null>>
    acknowledge(sessionId: string, sequence: number): Promise<ApiResult<null>>
    close(sessionId: string): Promise<ApiResult<null>>
    onData(handler: (event: TerminalDataEvent) => void): () => void
    onExit(handler: (event: TerminalExitEvent) => void): () => void
  }
  commands: {
    execute(request: z.infer<typeof executeSchema>): Promise<ApiResult<{ executionId: string }>>
    listExecutions(): Promise<ApiResult<ExecutionSnapshot[]>>
    cancel(executionId: string): Promise<ApiResult<null>>
    onExecutionEvent(handler: (event: ExecutionEvent) => void): () => void
  }
}
