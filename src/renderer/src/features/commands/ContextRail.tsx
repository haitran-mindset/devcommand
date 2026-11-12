import { conciseCommandDisplay } from '../../../../shared/text'
import { copyText } from '../../lib/clipboard'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Archive, ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Clock3, Copy, FolderGit2, GitBranch, GitCommitHorizontal, Link, RefreshCw, SlidersHorizontal, Terminal, type LucideIcon } from 'lucide-react'
import type { CommandRequest } from '../../../../shared/commands'
import { useRepository, useWorkspaces } from '../../lib/workspace'
import { useSession } from '../../lib/session'
import { unwrap } from '../../lib/settings'
import { Button } from '../../components/ui/button'

export function ContextRail() {
  const workspaces = useWorkspaces(), id = workspaces.data?.selectedId
  const workspace = workspaces.data?.entries.find((entry) => entry.id === id)
  const repository = useRepository(id), navigate = useNavigate(), session = useSession()
  const [error, setError] = useState('')
  const history = useQuery({ queryKey: ['history'], queryFn: async () => unwrap(await window.devcommand.library.history()) })
  const remote = repository.data?.remotes.find((entry) => entry.name === 'origin') ?? repository.data?.remotes[0]
  const open = (request: CommandRequest) => {
    session.select(request.commandId); session.setDraft(request); session.setQuery('')
    navigate(`/commands?focus=${encodeURIComponent(request.commandId)}`)
  }
  const actions: { id: string; title: string; icon: LucideIcon; params: CommandRequest['params'] }[] = [
    { id: 'git.pull', title: 'Pull', icon: ArrowDown, params: { name: remote?.name ?? 'origin', branch: repository.data?.branch ?? 'main' } },
    { id: 'git.push', title: 'Push', icon: ArrowUp, params: { name: remote?.name ?? 'origin', branch: repository.data?.branch ?? 'main' } },
    { id: 'git.fetch', title: 'Fetch', icon: RefreshCw, params: { name: remote?.name ?? 'origin' } },
    { id: 'git.branch.create', title: 'Branch', icon: GitBranch, params: {} },
    { id: 'git.stash.push', title: 'Stash', icon: Archive, params: {} },
    { id: 'git.remote.list', title: 'Remotes', icon: Link, params: {} }
  ]
  const recent = history.data?.filter((entry) => entry.request.workspaceId === (id ?? undefined)).slice(0, 3)
  return <aside className="context-rail" aria-label="Repository tools">
    <section className="panel context-card"><h2><FolderGit2 />Repository</h2>
      {workspaces.isPending && <p>Loading repositories…</p>}
      {workspaces.isError && <p role="alert">Unable to load repositories.</p>}
      {!id && !workspaces.isPending && <div className="rail-empty"><FolderGit2 /><p>Connect a repository to see its context here.</p><Button variant="outline" size="sm" onClick={() => navigate('/workspaces')}>Add repository</Button></div>}
      {workspace && <><strong className="repository-name" title={workspace.rootPath}><SlidersHorizontal />{workspace.name}</strong>
        <dl className="repository-details"><div><dt><GitBranch />Branch</dt><dd>{repository.data?.branch ?? '—'}</dd></div><div><dt><Link />Remote</dt><dd title={remote?.fetchUrl}>{remote?.fetchUrl ?? 'Not configured'}</dd>{remote && <Button size="icon" variant="ghost" aria-label="Copy repository remote" onClick={() => { void copyText(remote.fetchUrl).then(() => setError('Remote copied.')).catch(() => setError('Unable to copy remote.')) }}><Copy /></Button>}</div><div><dt><GitCommitHorizontal />Commit</dt><dd><code>{repository.data?.head ? repository.data.head.slice(0, 8) : 'No commits'}</code></dd></div><div><dt><Terminal />Status</dt><dd>{repository.data ? <span className={repository.data.clean ? 'repository-status clean' : 'repository-status changed'}>{repository.data.clean ? <CheckCircle2 /> : <CircleAlert />}{repository.data.conflicts ? 'Conflicts' : repository.data.clean ? 'Clean' : 'Changes'}</span> : 'Reading…'}</dd></div></dl></>}
      {repository.isError && <p role="alert">{repository.error.message}</p>}{error && <p role="status" className="rail-feedback">{error}</p>}
    </section>
    <section className="panel context-card"><h2><SlidersHorizontal />Quick Actions</h2><div className="quick-actions">{actions.map(({ id: commandId, title, icon: Icon, params }) => <button key={commandId} disabled={!id || !repository.data} title={`Configure ${title}`} onClick={() => open({ commandId, params, workspaceId: id! })}><Icon /><span>{title}</span></button>)}</div></section>
    <section className="panel context-card recent-card"><h2><Clock3 />Recent Commands<button onClick={() => navigate('/history')}>View all</button></h2>
      {history.isPending && <p>Loading recent activity…</p>}{history.isError && <p role="alert">Unable to load saved history.</p>}{recent?.length === 0 && <p className="rail-empty-copy">Your recent managed commands will appear here.</p>}
      {recent?.map(({ request, execution }) => <button className="recent-command" key={execution.id} onClick={() => open(request)} title={`Review ${conciseCommandDisplay(execution.preview)}`}><span className={`activity-icon status-${execution.status}`}>{execution.status === 'succeeded' ? <CheckCircle2 /> : execution.status === 'running' ? <Clock3 /> : <CircleAlert />}</span><span><strong>{request.commandId.replaceAll('.', ' ')}</strong><small>{execution.status}</small></span><Clock3 /></button>)}
    </section>
  </aside>
}
