import { z } from 'zod'
import type { ApiResult } from './contracts'
import type { TerminalSession } from './runtime'
import { hasControlCharacters } from './text'

const label = (max: number) => z.string().trim().min(1).max(max).refine(value => !hasControlCharacters(value))
export const savedCommandTagSchema = label(40).refine(value => !value.includes(','), 'A tag cannot contain commas.').transform(value => value.toLowerCase())
export const savedCommandFieldsSchema = z.object({
  title: z.string().trim().max(100).refine(value => !hasControlCharacters(value)).default(''),
  command: z.string().max(8192).transform(value => value.replace(/\r\n/g, '\n')).refine(value => value.trim().length > 0 && !hasControlCharacters(value.replace(/[\n\t]/g, '')), 'Enter a command without terminal control characters.'),
  description: z.string().trim().max(500).refine(value => !hasControlCharacters(value)),
  tags: z.array(savedCommandTagSchema).max(12).transform(values => [...new Set(values)])
}).strict()
export const savedCommandSchema = savedCommandFieldsSchema.extend({ id: z.uuid(), revision: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict()
export type SavedCommand = z.infer<typeof savedCommandSchema>
export type SavedCommandFields = z.infer<typeof savedCommandFieldsSchema>
export const savedCommandSaveSchema = savedCommandFieldsSchema.extend({ id: z.uuid().optional(), revision: z.uuid().optional() }).strict().refine(value => Boolean(value.id) === Boolean(value.revision), 'An edit requires its current revision.')
export type SaveSavedCommand = z.input<typeof savedCommandSaveSchema>
export const savedCommandReferenceSchema = z.object({ id: z.uuid(), revision: z.uuid() }).strict()
export const savedCommandsClearSchema = z.object({ entries: z.array(savedCommandReferenceSchema).min(1).max(1000).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length) }).strict()
export type SavedCommandsClear = z.infer<typeof savedCommandsClearSchema>
export function savedCommandTitle(entry: Pick<SavedCommand, 'title' | 'command'>): string {
  return entry.title || entry.command.split('\n').find(line => line.trim())?.trim().replace(/\s+/g, ' ').slice(0, 100) || 'Saved command'
}
export const savedCommandTagUpdateSchema = z.object({ ids: z.array(z.uuid()).min(1).max(1000).refine(ids => new Set(ids).size === ids.length), tag: savedCommandTagSchema, operation: z.enum(['add', 'remove']) }).strict()
export type SavedCommandTagUpdate = z.infer<typeof savedCommandTagUpdateSchema>
export const savedCommandMoveSchema = z.object({ sourceId: z.uuid(), targetId: z.uuid(), placement: z.enum(['before', 'after']) }).strict()
export type SavedCommandMove = z.infer<typeof savedCommandMoveSchema>
export const savedCommandRunSchema = savedCommandReferenceSchema.extend({ workspaceId: z.uuid().nullable(), terminalId: z.uuid().nullable().optional() }).strict()
export type SavedCommandRun = z.infer<typeof savedCommandRunSchema>
export interface SavedCommandPreview { title: string; command: string; cwd: string; shell: string; token: string; expiresAt: string }
export interface SavedCommandsAPI {
  savedCommands: {
    list(): Promise<ApiResult<SavedCommand[]>>
    save(input: SaveSavedCommand): Promise<ApiResult<SavedCommand>>
    remove(input: Pick<SavedCommand, 'id' | 'revision'>): Promise<ApiResult<null>>
    clear(input: SavedCommandsClear): Promise<ApiResult<null>>
    tag(input: SavedCommandTagUpdate): Promise<ApiResult<null>>
    move(input: SavedCommandMove): Promise<ApiResult<null>>
    preview(input: SavedCommandRun): Promise<ApiResult<SavedCommandPreview>>
    run(input: SavedCommandRun & { token: string }): Promise<ApiResult<TerminalSession>>
  }
}
