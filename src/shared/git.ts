import { z } from 'zod'
import type { ApiResult } from './contracts'
import type { RepositoryStatus } from './commands'
export const configKeys = ['user.name', 'user.email', 'core.autocrlf', 'pull.rebase', 'init.defaultBranch'] as const
export const gitSections = ['overview', 'config', 'remotes', 'branches', 'commits', 'stash'] as const
export type GitSection = typeof gitSections[number]
export const gitSnapshotSchema = z.object({ workspaceId: z.string().uuid(), section: z.enum(gitSections), offset: z.number().int().min(0).max(10000).default(0) }).strict()
export const gitDiffSchema = z.object({ workspaceId: z.string().uuid(), path: z.string().min(1).max(2048).optional(), staged: z.boolean().default(false), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(), stash: z.string().regex(/^stash@\{\d{1,4}\}$/).optional(), expectedStashOid: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional() }).strict().refine((request) => !(request.commit && request.stash), 'Choose either a commit or a stash').refine((request) => !request.expectedStashOid || !!request.stash, 'Expected stash commit requires a stash reference').refine((request) => !(request.path && (request.commit || request.stash)), 'File paths cannot be combined with commit/stash views')
export interface GitFile { path: string; originalPath?: string; indexStatus: string; worktreeStatus: string; untracked: boolean; conflicted: boolean }
export interface GitBranch { name: string; oid: string; current: boolean; upstream: string; worktreePath: string; merged: boolean }
export interface GitCommit { oid: string; author: string; date: string; subject: string }
export interface GitStash { ref: string; oid: string; subject: string; date: string }
export interface ConfigValue { value: string; origin: string; scope: string }
export interface GitConfig { key: typeof configKeys[number]; local?: ConfigValue; global?: ConfigValue; effective?: ConfigValue }
export interface GitSnapshot { status: RepositoryStatus; files: GitFile[]; branches: GitBranch[]; commits: GitCommit[]; stashes: GitStash[]; config: GitConfig[]; hasMore: boolean; warnings: string[] }
export interface GitDiff { text: string; notice?: string }
export interface GitAPI {
  git: {
    snapshot(request: z.input<typeof gitSnapshotSchema>): Promise<ApiResult<GitSnapshot>>
    diff(request: z.input<typeof gitDiffSchema>): Promise<ApiResult<GitDiff>>
    onChanged(handler: (workspaceId: string) => void): () => void
  }
}
