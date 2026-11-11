import { isAbsolute } from 'node:path'
import { hasControlCharacters } from '../../../shared/text'
import { configKeys, gitSnapshotSchema, gitDiffSchema, type ConfigValue, type GitDiff, type GitFile, type GitSnapshot } from '../../../shared/git'
import type { z } from 'zod'
import { WorkspaceService, PublicError, gitProbe } from '../workspace/service'
import { redact } from '../execution/redact'
import { parseStatus, nulRecords } from './parse'

export function validateGitPath(path: string) {
  if (!path || path === '.' || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.git' || part === '' || part === '.') || hasControlCharacters(path) || path.length > 2048) throw new PublicError('Choose a changed repository-relative file without traversal or control characters.')
}
export class GitService {
  constructor(private workspace: WorkspaceService) {}
  async files(workspaceId: string): Promise<GitFile[]> {
    const repository = await this.workspace.status(workspaceId)
    if (repository.bare) return []
    return parseStatus(await gitProbe(repository.rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
  }
  async snapshot(input: z.input<typeof gitSnapshotSchema>): Promise<GitSnapshot> {
    const { workspaceId, section, offset } = gitSnapshotSchema.parse(input)
    const status = await this.workspace.status(workspaceId)
    const cwd = status.rootPath
    const snapshot: GitSnapshot = { status, files: [], branches: [], commits: [], stashes: [], config: [], warnings: [], hasMore: false }
    if (section === 'overview' || section === 'stash') snapshot.files = status.bare ? [] : parseStatus(await gitProbe(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
    if (section === 'config') {
      const read = async (key: string, scope?: 'local' | 'global'): Promise<ConfigValue | undefined> => {
        const raw = await gitProbe(cwd, ['config', ...(scope ? [`--${scope}`] : []), '--null', '--show-origin', '--show-scope', '--get', key], true)
        if (!raw) return undefined
        const [actualScope, origin, value] = raw.split('\0')
        if (value === undefined) throw new PublicError('Git returned an unsupported config format.')
        return { scope: actualScope, origin: redact(origin), value: redact(value) }
      }
      snapshot.config = await Promise.all(configKeys.map(async (key) => {
        const [local, global, effective] = await Promise.all([read(key, 'local'), read(key, 'global'), read(key)])
        return { key, local, global, effective }
      }))
    }
    if (section === 'branches') {
      const raw = await gitProbe(cwd, ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)%00', 'refs/heads'])
      const merged = status.unborn ? new Set<string>() : new Set((await gitProbe(cwd, ['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads'])).split('\n'))
      snapshot.branches = nulRecords(raw, 5).map(([name, oid, head, upstream, worktreePath]) => ({ name, oid, current: head === '*', upstream, worktreePath, merged: merged.has(name) }))
    }
    if (section === 'commits' && !status.unborn) {
      const raw = await gitProbe(cwd, ['log', '--no-show-signature', '--no-decorate', '--format=%H%x00%an%x00%aI%x00%s%x00', `--skip=${offset}`, '-51', 'HEAD', '--'])
      const records = nulRecords(raw, 4)
      snapshot.hasMore = records.length > 50
      snapshot.commits = records.slice(0, 50).map(([oid, author, date, subject]) => ({ oid, author: redact(author), date, subject: redact(subject) }))
    }
    if (section === 'stash' && !status.bare) {
      const raw = await gitProbe(cwd, ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%aI%x00', '-51'])
      const records = nulRecords(raw, 4)
      snapshot.hasMore = records.length > 50
      snapshot.stashes = records.slice(0, 50).map(([ref, oid, subject, date]) => ({ ref, oid, subject: redact(subject), date }))
      if (snapshot.hasMore) snapshot.warnings.push('Showing the latest 50 stashes. Older entries remain available through Git CLI.')
    }
    if (status.conflicts) snapshot.warnings.push('Merge conflicts are present. Stage resolved files only after reviewing their content. Branch switches and stash application are blocked until conflicts are resolved.')
    if (status.bare) snapshot.warnings.push('Bare repository: no working tree or staging operations are available.')
    if (status.detached && !status.unborn) snapshot.warnings.push('Detached HEAD: create or switch to a named branch if you want to work on a local branch.')
    if (status.unborn) snapshot.warnings.push('This repository has no commits. Commit history is empty; staging and configuration remain available.')
    return snapshot
  }
  async diff(input: z.input<typeof gitDiffSchema>): Promise<GitDiff> {
    const request = gitDiffSchema.parse(input)
    const status = await this.workspace.status(request.workspaceId)
    if (request.path) validateGitPath(request.path)
    const options = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames']
    let args: string[]
    if (request.commit) {
      if (!await gitProbe(status.rootPath, ['rev-parse', '--verify', `${request.commit}^{commit}`], true)) throw new PublicError('That commit no longer exists.')
      args = ['show', '--format=fuller', '--no-show-signature', ...options, request.commit, '--']
    } else if (request.stash) {
      const oid = await gitProbe(status.rootPath, ['rev-parse', '--verify', request.stash], true)
      if (!oid) throw new PublicError('That stash no longer exists.')
      if (request.expectedStashOid && request.expectedStashOid !== oid) throw new PublicError('This stash changed since it was displayed. Refresh the stash list.')
      args = ['stash', 'show', '-p', ...options, oid]
    } else {
      if (status.bare) throw new PublicError('A working tree is required to inspect file changes.')
      if (request.path) {
        const files = await this.files(request.workspaceId)
        const file = files.find((entry) => entry.path === request.path)
        if (!file) throw new PublicError('This file is no longer in the change list. Refresh first.')
        if (file.untracked) return { text: '', notice: 'Untracked file. Stage it to inspect the indexed diff; file contents are not read directly by DevCommand.' }
      }
      args = ['diff', ...options, ...(request.staged ? ['--cached'] : []), '--', ...(request.path ? [request.path] : [])]
    }
    const text = redact(await gitProbe(status.rootPath, args, false, true))
    return { text, notice: text ? undefined : 'No textual diff. The file may be unchanged, binary, a submodule, or changed in the other staging area.' }
  }
}
