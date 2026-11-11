import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, CheckCircle2, Clock, Folder, FolderOpen, GitBranch, KeyRound, LayoutGrid, Star, Terminal } from 'lucide-react'
import { groupCommands, defaultCommand } from '../../../../shared/command-groups'
import { conciseCommandDisplay } from '../../../../shared/text'
import { Button } from '../../components/ui/button'
import { CommandIcon } from '../commands/CommandIcon'
import { useSession } from '../../lib/session'
import { unwrap } from '../../lib/settings'
import { useRepository, useWorkspaces } from '../../lib/workspace'

export function Dashboard() {
  const navigate = useNavigate(), session = useSession()
  const workspaces = useWorkspaces()
  const selected = workspaces.data?.entries.find((entry) => entry.id === workspaces.data.selectedId)
  const repository = useRepository(selected?.id)
  const favorites = useQuery({ queryKey: ['library', 'dashboard-favorites'], queryFn: async () => unwrap(await window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: true })) })
  const history = useQuery({ queryKey: ['history'], queryFn: async () => unwrap(await window.devcommand.library.history()) })
  const groups = groupCommands(favorites.data ?? [])
  const openCommand = (id: string) => { session.select(id); session.setQuery(''); navigate(`/commands?focus=${encodeURIComponent(id)}`) }
  return <section className="dashboard-page" aria-label="Dashboard">
    <header className="dashboard-heading"><div><h1>Dashboard</h1><p>Your workspace, ready to go.</p></div><Button size="sm" onClick={() => navigate('/commands')}><LayoutGrid />Explore commands<ArrowUpRight /></Button></header>
    <div className="dashboard-top-grid">
      <section className="panel dashboard-repository" aria-labelledby="dashboard-workspace-title">
        <header className="dashboard-section-heading"><span><FolderOpen /><h2 id="dashboard-workspace-title">Current workspace</h2></span><span className="dashboard-local"><i />Local</span></header>
        {workspaces.isPending ? <p className="dashboard-empty" role="status">Loading repositories…</p> : workspaces.isError ? <p className="dashboard-empty" role="alert">Unable to load repositories.</p> : selected ? <>
          <div className="dashboard-repo-name"><span className="dashboard-repo-icon"><Folder /></span><div><h3>{selected.name}</h3><p title={selected.rootPath}>{selected.rootPath}</p></div></div>
          <div className="dashboard-repo-status"><span><GitBranch />{repository.data?.branch ?? 'Loading branch…'}</span>{repository.isError ? <span>Repository unavailable</span> : repository.data && <span className={repository.data.clean ? 'is-clean' : ''}><CheckCircle2 />{repository.data.conflicts ? 'Merge conflicts' : repository.data.clean ? 'Clean working tree' : 'Uncommitted changes'}</span>}</div>
          <div className="dashboard-repo-actions"><Button variant="outline" size="sm" onClick={() => navigate('/git')}><GitBranch />Open Git Manager</Button><Button variant="ghost" size="sm" onClick={() => navigate('/workspaces')}>Switch repository<ArrowUpRight /></Button></div>
        </> : <div className="dashboard-start"><Folder /><h3>Connect your workspace</h3><p>Add a local repository to configure commands in context.</p><Button variant="outline" size="sm" onClick={() => navigate('/workspaces')}>Manage repositories<ArrowUpRight /></Button></div>}
        <footer className="dashboard-repo-footer"><span>{workspaces.data?.entries.length ?? 0} repositories connected</span><button onClick={() => navigate('/workspaces')}>View all<ArrowUpRight /></button></footer>
      </section>
      <section className="panel dashboard-shortcuts" aria-labelledby="dashboard-shortcuts-title"><header className="dashboard-section-heading"><span><Terminal /><h2 id="dashboard-shortcuts-title">Jump back in</h2></span></header>
        {([{ title: 'Command Explorer', description: 'Find a command and make it yours', path: '/commands', icon: LayoutGrid }, { title: 'Git Manager', description: 'Branches, changes and repository settings', path: '/git', icon: GitBranch }, { title: 'SSH Manager', description: 'Keys, agent and host aliases', path: '/ssh', icon: KeyRound }] as const).map(({ title, description, path, icon: Icon }) => <button className="dashboard-shortcut" key={path} onClick={() => navigate(path)}><span className="dashboard-shortcut-icon"><Icon /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight /></button>)}
      </section>
    </div>
    <div className="dashboard-bottom-grid">
      <section className="panel dashboard-favorites" aria-labelledby="dashboard-favorites-title"><header className="dashboard-section-heading"><span><Star /><h2 id="dashboard-favorites-title">Favorites</h2><small>{groups.length}</small></span><button onClick={() => navigate('/my-commands')}>View all<ArrowUpRight /></button></header>
        {favorites.isPending ? <p className="dashboard-empty" role="status">Loading favorites…</p> : favorites.isError ? <p className="dashboard-empty" role="alert">Unable to load favorites.</p> : !groups.length ? <div className="dashboard-empty"><Star /><p>Keep useful commands close.</p><small>Star commands in the explorer to find them here.</small></div> : groups.slice(0, 4).map((group) => <button className="dashboard-command" key={group.id} onClick={() => openCommand(defaultCommand(group).id)}><CommandIcon id={defaultCommand(group).id} /><span><strong>{group.title}</strong><small>{group.commands.length} saved {group.commands.length === 1 ? 'action' : 'actions'}</small></span><ArrowUpRight /></button>)}
      </section>
      <section className="panel dashboard-activity" aria-labelledby="dashboard-activity-title"><header className="dashboard-section-heading"><span><Clock /><h2 id="dashboard-activity-title">Recent activity</h2></span><button onClick={() => navigate('/history')}>View history<ArrowUpRight /></button></header>
        {history.isPending ? <p className="dashboard-empty" role="status">Loading activity…</p> : history.isError ? <p className="dashboard-empty" role="alert">Unable to load activity.</p> : !history.data?.length ? <div className="dashboard-empty"><Clock /><p>A fresh start.</p><small>Your managed command runs will appear here.</small></div> : history.data.slice(0, 4).map(({ execution }) => <button className="dashboard-run" key={execution.id} onClick={() => navigate('/history')}><span className={`dashboard-run-dot status-${execution.status}`} /><span><code>{conciseCommandDisplay(execution.preview)}</code><small><time dateTime={execution.startedAt}>{new Date(execution.startedAt).toLocaleString()}</time></small></span><span className={`execution-status status-${execution.status}`}>{execution.status}</span></button>)}
      </section>
    </div>
  </section>
}
