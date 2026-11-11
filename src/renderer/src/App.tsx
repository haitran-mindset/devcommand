import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Box, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Database, Folder, FolderOpen, GitBranch, GitCommitHorizontal, House, Info, KeyRound, LayoutGrid, Monitor, Moon, Network, PanelLeftClose, PanelLeftOpen, Radio, RefreshCw, Search, Settings, SquareTerminal, Star, Sun, Terminal, X, Clock, Archive, type LucideIcon } from 'lucide-react'
import { Button } from './components/ui/button'
import { cn } from './lib/utils'
import { useSettings, useUpdateSettings } from './lib/settings'
import { useSession } from './lib/session'
import { TerminalDock } from './features/terminal/TerminalDock'
import { ManagedPanel } from './features/execution/ManagedPanel'
import { CommandExplorer } from './features/commands/CommandExplorer'
import { RepositoryPicker } from './features/workspace/RepositoryPicker'
import { WorkspacesPage } from './features/workspace/WorkspacesPage'
import { GitManager } from './features/git/GitManager'
import { RunningTasks } from './features/execution/RunningTasks'
import { HistoryPage } from './features/history/HistoryPage'
import { SshManager } from './features/ssh/SshManager'
import { DockerManager } from './features/docker/DockerManager'
import { useWorkspaces, useRepository, useExecutionRefresh } from './lib/workspace'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from './lib/settings'
import { defaultSettings, routes, type AppRoute, type AppSettings } from '../../shared/contracts'

const nav: { route: AppRoute; label: string; icon: LucideIcon }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: House },
  { route: 'commands', label: 'Command Explorer', icon: LayoutGrid },
  { route: 'workflows', label: 'Workflows', icon: Network },
  { route: 'workspaces', label: 'Repositories', icon: Folder },
  { route: 'git', label: 'Git Manager', icon: GitBranch },
  { route: 'ssh', label: 'SSH Manager', icon: KeyRound },
  { route: 'docker', label: 'Docker', icon: Box },
  { route: 'shell', label: 'Shell Tools', icon: SquareTerminal },
  { route: 'history', label: 'History', icon: Clock },
]
const gitNavigation = [
  { tab: 'overview', label: 'Overview', icon: LayoutGrid },
  { tab: 'branches', label: 'Branches', icon: GitBranch },
  { tab: 'commits', label: 'Commits', icon: GitCommitHorizontal },
  { tab: 'remotes', label: 'Remotes', icon: Radio },
  { tab: 'stash', label: 'Stash', icon: Archive },
  { tab: 'config', label: 'Config', icon: Settings }
]

function IconButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</Button>
}
function useTheme(theme: AppSettings['theme']) {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
export function App() {
  const query = useSettings()
  const update = useUpdateSettings()
  const settings = query.data ?? defaultSettings
  const navigate = useNavigate()
  const location = useLocation()
  const restored = useRef(false)
  const help = useRef<HTMLDialogElement>(null)
  const [gitOpen, setGitOpen] = useState(true)
  const [notice, setNotice] = useState('')
  const session = useSession()
  const client = useQueryClient()
  const workspaces = useWorkspaces()
  const selectedWorkspace = workspaces.data?.entries.find((entry) => entry.id === workspaces.data.selectedId)
  const repository = useRepository(workspaces.data?.selectedId)
  const [openingRepository, setOpeningRepository] = useState(false)
  const [refreshingRepository, setRefreshingRepository] = useState(false)
  const openRepository = async () => {
    if (!selectedWorkspace || openingRepository) return
    setOpeningRepository(true)
    try {
      if (typeof window.devcommand.workspace.open !== 'function') throw new Error('Restart DevCommand to enable opening repository folders.')
      unwrap(await window.devcommand.workspace.open(selectedWorkspace.id))
      setNotice('Repository folder opened.')
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Unable to open repository folder.') }
    finally { setOpeningRepository(false) }
  }
  const refreshRepository = async () => {
    if (!selectedWorkspace || refreshingRepository) return
    setRefreshingRepository(true)
    try {
      const result = await repository.refetch({ throwOnError: true })
      if (result.isError) throw result.error
      await Promise.all([
        client.invalidateQueries({ queryKey: ['git', selectedWorkspace.id] }, { throwOnError: true }),
        client.invalidateQueries({ queryKey: ['git-diff', selectedWorkspace.id] }, { throwOnError: true }),
        client.invalidateQueries({ queryKey: ['preview'] }),
      ])
      setNotice('Repository refreshed.')
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Unable to refresh repository.') }
    finally { setRefreshingRepository(false) }
  }

  useExecutionRefresh()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const palette = useRef<HTMLDialogElement>(null)
  const paletteResults = useQuery({ queryKey: ['palette', session.query], queryFn: async () => unwrap(await window.devcommand.library.search({ query: session.query, category: 'all', risk: 'all', platform: 'all', favoritesOnly: false })), enabled: paletteOpen })
  useEffect(() => { if (paletteOpen) palette.current?.showModal(); else palette.current?.close() }, [paletteOpen])
  const route = location.pathname.slice(1) || 'commands'
  const exploring = route === 'commands' || route === 'my-commands'
  const gitTab = route === 'git-config' ? 'config' : route === 'git-remote' ? 'remotes' : new URLSearchParams(location.search).get('tab') ?? 'overview'
  useTheme(settings.theme)
  useEffect(() => window.devcommand.library.onHistoryError(setNotice), [])
  useEffect(() => {
    if (query.data && !restored.current) {
      restored.current = true
      navigate(`/${query.data.route}`, { replace: true })
    }
  }, [query.data, navigate])
  useEffect(() => {
    if (!restored.current || !routes.includes(route as AppRoute) || route === settings.route) return
    update.mutate({ route: route as AppRoute })
    // Persist only navigation events; successful writes update settings independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.target instanceof Element && event.target.closest('.terminal-view')) return
      const key = event.key.toLowerCase()
      if (key === 'k') { event.preventDefault(); setPaletteOpen(true) }
      if (key === 'p') { event.preventDefault(); navigate('/workspaces') }
      if (key === ',') { event.preventDefault(); navigate('/settings') }
      if (key === 'j') { event.preventDefault(); update.mutate({ terminalVisible: !settings.terminalVisible }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, settings.terminalVisible, update])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [notice])
  const windowControl = (action: 'minimize' | 'maximize' | 'close') => {
    void window.devcommand?.window.control(action).then((result) => { if (!result.ok) setNotice(result.error) }).catch(() => setNotice('Window action failed.'))
  }
  if (query.isPending) return <div className="startup"><SquareTerminal /><h1>DevCommand</h1><p>Loading local preferences…</p></div>
  if (query.isError) return <div className="startup"><Info /><h1>Unable to load preferences</h1><p role="alert">{query.error.message}</p><Button onClick={() => void query.refetch()}>Try again</Button></div>
  return <div className={cn('application command-center', settings.sidebarCollapsed && 'sidebar-collapsed')}>
    <header className="titlebar">
      {exploring ? <div className="search-bar global-search"><Search /><input aria-label="Search commands" maxLength={200} placeholder="Search commands, aliases and tools…" value={session.query} onChange={(event) => session.setQuery(event.target.value)} /><button className="search-shortcut" aria-label="Open command palette" onClick={() => setPaletteOpen(true)}><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd></button></div> : <button className="global-search search-trigger" onClick={() => setPaletteOpen(true)}><Search /><span>Search commands, aliases and tools…</span><kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd></button>}
      <div className="header-tools"><IconButton label="Keyboard shortcuts" onClick={() => help.current?.showModal()}><CircleHelp /></IconButton><IconButton label="Open settings" onClick={() => navigate('/settings')}><Settings /></IconButton></div>
    </header>
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="traffic-lights"><button aria-label="Close window" title="Close window" onClick={() => windowControl('close')} /><button aria-label="Minimize window" title="Minimize window" onClick={() => windowControl('minimize')} /><button aria-label="Maximize or restore window" title="Maximize or restore window" onClick={() => windowControl('maximize')} /></div><div className="brand-lockup"><div className="brand-icon"><Terminal /></div><div className="brand"><strong>DevCommand</strong><span>Developer Command Center</span></div></div></div>
      <nav aria-label="Main navigation">
        {nav.map(({ route: target, label, icon: Icon }) => <div key={target} className={target === 'git' ? 'git-nav-group' : undefined}>
          <div className="nav-line"><NavLink to={`/${target}`} aria-label={label} title={label} className={cn('nav-item', target === 'commands' && route === 'my-commands' && 'active', target === 'git' && ['git-config', 'git-remote'].includes(route) && 'active')}><Icon /><span>{label}</span></NavLink>{target === 'git' && <button className="nav-expand" aria-label="Toggle Git sections" aria-expanded={gitOpen} onClick={() => setGitOpen(!gitOpen)}>{gitOpen ? <ChevronDown /> : <ChevronRight />}</button>}</div>
          {target === 'git' && gitOpen && <div className="git-subnav">{gitNavigation.map(({ tab, label: tabLabel, icon: TabIcon }) => <RouterLink key={tab} to={`/git?tab=${tab}`} aria-label={`Git ${tabLabel}`} aria-current={['git', 'git-config', 'git-remote'].includes(route) && gitTab === tab ? 'page' : undefined} className={cn('nav-item nav-child', ['git', 'git-config', 'git-remote'].includes(route) && gitTab === tab && 'active')}><TabIcon /><span>{tabLabel}</span></RouterLink>)}</div>}
        </div>)}
      </nav>
      <div className="sidebar-bottom"><NavLink className="nav-item" aria-label="Settings" title="Settings" to="/settings"><Settings /><span>Settings</span></NavLink><div className="local-storage"><div><Database /></div><span><strong>Local workspace</strong><small>Stored on this device</small></span></div><button className="collapse-button" aria-label={settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => update.mutate({ sidebarCollapsed: !settings.sidebarCollapsed })}>{settings.sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}<span>Collapse sidebar</span></button></div>
    </aside>
    <main className="workspace">
      <section className="workspace-context" aria-label="Repository context"><RepositoryPicker notify={setNotice} /><span className="branch-pill"><GitBranch />{repository.data ? `${repository.data.branch}${repository.data.unborn ? ' (unborn)' : ''}${repository.data.bare ? ' (bare)' : ''}` : 'No branch'}{repository.data && <i />}</span><span className={cn('repo-state', repository.data?.clean && 'is-clean', repository.isError && 'has-error')}><CheckCircle2 />{repository.isFetching ? 'Refreshing…' : repository.isError ? 'Repository unavailable' : repository.data ? repository.data.conflicts ? 'Merge conflicts' : repository.data.clean ? 'Clean working tree' : 'Uncommitted changes' : 'No repository connected'}</span><div className="context-actions">{selectedWorkspace && <Button variant="outline" size="sm" disabled={openingRepository} title="Open repository folder" onClick={() => void openRepository()}><FolderOpen />{openingRepository ? 'Opening…' : 'Open repository'}</Button>}<IconButton label="Refresh repository" disabled={!selectedWorkspace || refreshingRepository || repository.isFetching} onClick={() => void refreshRepository()}><RefreshCw /></IconButton></div></section>
      <div className={cn('page-content', route === 'settings' && 'settings-content')}>
        {(route === 'commands' || route === 'my-commands') ? <CommandExplorer key={location.key} notify={setNotice} favoritesOnly={route === 'my-commands'} /> : route === 'workspaces' ? <WorkspacesPage /> : route === 'history' ? <HistoryPage /> : ['git', 'git-config', 'git-remote'].includes(route) ? <GitManager route={route} /> : route === 'ssh' ? <SshManager /> : route === 'docker' ? <DockerManager /> : route === 'shell' ? <ManagedPanel /> : route === 'settings' ? <SettingsPage settings={settings} save={(patch) => update.mutate(patch)} pending={update.isPending} /> : route === 'dashboard' ? <Dashboard navigate={navigate} /> : <ModulePage route={route} navigate={navigate} />}
      </div>
      <div className={cn('bottom-workspace', exploring && 'with-tasks')} hidden={!settings.terminalVisible}>
        <TerminalDock visible={settings.terminalVisible} height={settings.terminalHeight} saveHeight={(height) => update.mutate({ terminalHeight: height })} hide={() => update.mutate({ terminalVisible: false })} />
        {exploring && <RunningTasks />}
      </div>
      {!settings.terminalVisible && <button className="dock-toggle" onClick={() => update.mutate({ terminalVisible: true })}><Terminal />Show terminal dock <kbd>⌘ J</kbd></button>}
      <footer className="statusbar"><span><span className="status-dot" />Command Center <span className="status-separator">/</span> v0.1.0</span><span><Monitor />Local environment<span className="status-separator">·</span>Sessions stay in memory</span></footer>
    </main>
    <dialog ref={help} className="confirmation-dialog" aria-labelledby="shortcuts-title"><h2 id="shortcuts-title">Keyboard shortcuts</h2><div className="shortcut-row">Command palette<kbd>⌘ / Ctrl K</kbd></div><div className="shortcut-row">Repositories<kbd>⌘ / Ctrl P</kbd></div><div className="shortcut-row">Toggle terminal<kbd>⌘ / Ctrl J</kbd></div><div className="shortcut-row">Review command<kbd>⌘ / Ctrl Enter</kbd></div><div className="confirmation-actions"><Button onClick={() => help.current?.close()}>Close</Button></div></dialog>
    <dialog ref={palette} className="command-palette" aria-labelledby="palette-title" onCancel={() => setPaletteOpen(false)}><h2 id="palette-title">Command palette</h2><input autoFocus aria-label="Search command palette" maxLength={200} value={session.query} placeholder="Search commands or aliases…" onChange={(event) => session.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); palette.current?.querySelector<HTMLButtonElement>('.palette-results button')?.focus() } }} /><div className="palette-results">{paletteResults.data?.map((entry) => <button key={entry.id} onClick={() => { session.select(entry.id); session.setQuery(''); setPaletteOpen(false); navigate(`/commands?focus=${encodeURIComponent(entry.id)}`) }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus() } if (event.key === 'ArrowUp') { event.preventDefault(); (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus() } }}><span><strong>{entry.title}</strong><small>{entry.category} · {entry.risk}</small></span><ChevronRight /></button>)}{paletteResults.data?.length === 0 && <p>No matching commands.</p>}</div><Button variant="outline" onClick={() => setPaletteOpen(false)}>Close</Button></dialog>
    {(notice || update.isError) && <div role="status" className="toast"><Info />{notice || 'Could not save preferences. Try again.'}<IconButton label="Dismiss notification" onClick={() => { setNotice(''); update.reset() }}><X /></IconButton></div>}
  </div>
}

function SettingsPage({ settings, save, pending }: { settings: AppSettings; save: (patch: Partial<AppSettings>) => void; pending: boolean }) {
  return <section className="panel settings-page"><div className="page-heading"><Settings /><div><h1>Settings</h1><p>Make DevCommand feel like your workspace.</p></div></div><div className="setting-section"><h2>Appearance</h2><p>Choose a theme, or follow your system preferences.</p><div className="theme-options">{([{ id: 'dark', icon: Moon, label: 'Dark' }, { id: 'light', icon: Sun, label: 'Light' }, { id: 'system', icon: Monitor, label: 'System' }] as const).map(({ id, icon: Icon, label }) => <button disabled={pending} key={id} className={cn('theme-choice', settings.theme === id && 'chosen')} aria-pressed={settings.theme === id} onClick={() => save({ theme: id })}><Icon /><span>{label}</span>{settings.theme === id && <Check />}</button>)}</div></div><div className="setting-section"><h2>Layout</h2><label className="checkbox-row"><span>Collapse sidebar</span><input type="checkbox" checked={settings.sidebarCollapsed} disabled={pending} onChange={(e) => save({ sidebarCollapsed: e.target.checked })} /></label><label className="checkbox-row"><span>Show terminal dock</span><input type="checkbox" checked={settings.terminalVisible} disabled={pending} onChange={(e) => save({ terminalVisible: e.target.checked })} /></label></div><div className="setting-section"><h2>Keyboard shortcuts</h2><div className="shortcut-row">Search commands<kbd>⌘ / Ctrl K</kbd></div><div className="shortcut-row">Toggle terminal dock<kbd>⌘ / Ctrl J</kbd></div><div className="shortcut-row">Open settings<kbd>⌘ / Ctrl ,</kbd></div></div><div className="privacy-note"><Check />Preferences stay on this device. No account or telemetry.</div></section>
}
function Dashboard({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const workspaces = useWorkspaces()
  const favorites = useQuery({ queryKey: ['library', 'dashboard-favorites'], queryFn: async () => unwrap(await window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: true })) })
  const history = useQuery({ queryKey: ['history'], queryFn: async () => unwrap(await window.devcommand.library.history()) })
  const session = useSession()
  return <section className="panel welcome-page"><div className="welcome-icon"><Terminal /></div><span className="reference-badge">Your local command center</span><h1>A little less memorizing.<br />A little more building.</h1><p>Choose a repository, configure a command, and keep your terminal close.</p><div className="welcome-actions"><Button onClick={() => navigate('/commands')}><SquareTerminal />Explore commands</Button><Button variant="outline" onClick={() => navigate('/workspaces')}><Folder />Manage repositories</Button></div><div className="foundation-cards"><div><FolderOpen /><h2>Workspaces</h2><p>{workspaces.data?.entries.length ?? 0} repositories connected.</p>{workspaces.data?.entries.slice(0, 3).map((entry) => <p key={entry.id}>{entry.name}</p>)}</div><div><Star /><h2>Favorites</h2>{favorites.data?.length === 0 && <p>Star a command to find it here.</p>}{favorites.data?.slice(0, 3).map((entry) => <Button key={entry.id} variant="link" onClick={() => { session.select(entry.id); session.setQuery(''); navigate('/commands') }}>{entry.title}</Button>)}</div><div><Clock /><h2>Recent activity</h2>{history.data?.length === 0 && <p>No managed executions yet.</p>}{history.data?.slice(0, 3).map((entry) => <p key={entry.execution.id}>{entry.request.commandId} · {entry.execution.status}</p>)}<Button variant="link" onClick={() => navigate('/history')}>View history</Button></div></div></section>
}
function ModulePage({ route, navigate }: { route: string; navigate: ReturnType<typeof useNavigate> }) {
  const item = nav.find((entry) => entry.route === route)
  const Icon = item?.icon ?? Info
  const phase = ['git-config', 'git-remote'].includes(route) ? 4 : ['ssh', 'docker', 'shell'].includes(route) ? 5 : route === 'workflows' ? 6 : 3
  return <section className="panel module-page"><div className="welcome-icon"><Icon /></div><span className="reference-badge">Planned for Phase {phase}</span><h1>{item?.label ?? 'Page not found'}</h1><p>{route === 'workspaces' ? 'No repositories connected yet. Adding and switching local repositories will be available in Phase 3.' : `This module is part of the next development stages. Your local files and configuration have not been accessed.`}</p><Button variant="outline" onClick={() => navigate('/commands')}><SquareTerminal />Browse command references</Button></section>
}
