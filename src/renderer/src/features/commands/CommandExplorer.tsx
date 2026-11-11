import { actionLabel, defaultCommand, groupCommands, sharedActionParams, type CommandGroup } from '../../../../shared/command-groups'
import { conciseCommandDisplay } from '../../../../shared/text'
import { copyText } from '../../lib/clipboard'
import { SelectField } from '../../components/ui/select-field'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, Copy, Folder, GitBranch, Info, LayoutGrid, Link, Play, SlidersHorizontal, Star, Terminal, TriangleAlert } from 'lucide-react'
import type { CommandPreview, CommandRequest, CommandSummary, SearchRequest } from '../../../../shared/commands'
import { useNavigate } from 'react-router-dom'
import { CommandIcon } from './CommandIcon'
import { ContextRail } from './ContextRail'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import { unwrap, useUpdateSettings } from '../../lib/settings'
import { useWorkspaces } from '../../lib/workspace'
import { useSession } from '../../lib/session'

export function CommandExplorer({ notify, favoritesOnly = false }: { notify: (message: string) => void; favoritesOnly?: boolean }) {
  const session = useSession()
  const client = useQueryClient(), navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listError, setListError] = useState('')
  const [savingFavorite, setSavingFavorite] = useState(false)
  const workspaces = useWorkspaces()
  const [category, setCategory] = useState<SearchRequest['category']>('all')
  const [risk, setRisk] = useState<SearchRequest['risk']>('all')
  const [platform, setPlatform] = useState<SearchRequest['platform']>('all')
  const commands = useQuery({ queryKey: ['library', session.query, category, risk, platform, favoritesOnly], queryFn: async () => unwrap(await window.devcommand.library.search({ query: session.query, category, risk, platform, favoritesOnly })) })
  const catalog = useQuery({ queryKey: ['library', '', 'all', 'all', 'all', false], queryFn: async () => unwrap(await window.devcommand.library.search({ query: '', category: 'all', risk: 'all', platform: 'all', favoritesOnly: false })) })
  const groups = groupCommands(commands.data ?? [])
  const catalogGroups = groupCommands(catalog.data ?? [])
  const selected = commands.data?.find((entry) => entry.id === session.selectedId) ?? (groups[0] ? defaultCommand(groups[0]) : undefined)
  const selectedGroup = groups.find((group) => group.commands.some((entry) => entry.id === selected?.id))
  const favorite = async (group: CommandGroup) => {
    if (savingFavorite || !catalog.data) return
    const entries = catalogGroups.find((entry) => entry.id === group.id)?.commands ?? group.commands
    const next = !entries.some((entry) => entry.favorite)
    setSavingFavorite(true); setListError('')
    try { await Promise.all(entries.map(async (entry) => unwrap(await window.devcommand.library.favorite(entry.id, next)))); await client.invalidateQueries({ queryKey: ['library'] }) }
    catch { setListError('Unable to update group favorites. Try again.'); await client.invalidateQueries({ queryKey: ['library'] }) }
    finally { setSavingFavorite(false) }
  }
  return <div className="explorer-grid"><section className="panel command-list" aria-label="Command library">
    <div className="library-heading"><button type="button" aria-pressed={!favoritesOnly} className={!favoritesOnly ? 'selected' : undefined} onClick={() => navigate('/commands')}><LayoutGrid />Commands</button><button type="button" aria-pressed={favoritesOnly} className={favoritesOnly ? 'selected' : undefined} onClick={() => navigate('/my-commands')}><Star />Favorites</button><span className="library-count">{groups.length}</span></div>
    <div className="category-picker"><LayoutGrid /><SelectField label="Command category" value={category} onValueChange={(value) => setCategory(value as typeof category)} options={[{ value: 'all', label: 'All commands' }, 'Git', 'General', 'Node', 'Flutter', 'System', 'Permissions', 'AI Developer CLI']} className="min-w-0 flex-1" /><button aria-label="Toggle command filters" title="Risk and platform filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal /></button></div>
    <div className="library-filters" hidden={!filtersOpen}><SelectField label="Command risk" value={risk} onValueChange={(value) => setRisk(value as typeof risk)} options={[{ value: 'all', label: 'All risks' }, 'safe', 'caution', 'dangerous']} className="min-w-0 flex-1" size="sm" /><SelectField label="Command platform" value={platform} onValueChange={(value) => setPlatform(value as typeof platform)} options={[{ value: 'all', label: 'All platforms' }, 'darwin', 'linux', 'win32']} className="min-w-0 flex-1" size="sm" /></div>
    {listError && <p role="alert" className="terminal-error">{listError}</p>}
    <div className="command-items">{groups.map((group) => {
      const active = group.id === selectedGroup?.id
      const entry = group.commands.find((entry) => entry.id === session.selectedId) ?? defaultCommand(group)
      const entries = catalogGroups.find((candidate) => candidate.id === group.id)?.commands ?? group.commands
      const saved = entries.filter((entry) => entry.favorite).length
      const unavailable = group.commands.every((command) => !!command.unavailableReason)
      return <div key={group.id} className={cn('command-row', active && 'selected')}><button className="command-item" aria-label={group.title} onClick={() => { if (!active || entry.id !== selected?.id) session.select(entry.id) }} aria-pressed={active}><CommandIcon id={entry.id} /><span><strong>{group.title}</strong><small>{unavailable ? entry.unavailableReason : group.description}</small></span><span className="command-group-count" title={`${group.commands.length} matching actions`}>{group.commands.length}</span></button><button className="row-favorite" aria-label={`Favorite ${group.title}`} title={`${saved} of ${entries.length} actions saved. ${saved ? 'Remove group from' : 'Add group to'} Favorites.`} aria-pressed={saved === 0 ? false : saved === entries.length ? true : 'mixed'} disabled={savingFavorite || catalog.isPending || catalog.isError} onClick={() => void favorite(group)}><Star fill={saved ? 'currentColor' : 'none'} /></button></div>
    })}{commands.isPending && <p className="list-empty">Loading commands…</p>}{commands.isError && <p role="alert" className="list-empty">Unable to load commands.</p>}{commands.data?.length === 0 && <div className="list-empty"><p>No matching commands.</p><small>Try “remote”, “undo commit” or change your filters.</small></div>}</div><div className="list-footnote"><Info />{favoritesOnly ? 'Your starred commands, ready to configure.' : 'Choose a command. Make it yours.'}</div></section>
    {selected ? <CommandInspector key={`${selected.id}:${workspaces.data?.selectedId ?? 'home'}:${session.draft ? JSON.stringify(session.draft) : ''}`} command={selected} actions={selectedGroup?.commands ?? [selected]} onActionChange={session.select} workspaceId={workspaces.data?.selectedId ?? undefined} notify={notify} /> : <section className="panel module-page"><h1>Choose a command</h1><p>Select a command from the library to see its parameters and preview.</p></section>}
    <ContextRail />
  </div>
}

function CommandInspector({ command, actions, onActionChange, workspaceId, notify }: { command: CommandSummary; actions: CommandSummary[]; onActionChange: (id: string) => void; workspaceId?: string; notify: (message: string) => void }) {
  const navigate = useNavigate()
  const session = useSession()
  const client = useQueryClient()
  const settings = useUpdateSettings()
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(command.parameters.map((parameter) => [parameter.key, String((session.draft?.commandId === command.id && session.draft.workspaceId === workspaceId ? session.draft.params[parameter.key] : undefined) ?? parameter.defaultValue ?? '')])))
  const [tab, setTab] = useState('Configure')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ request: CommandRequest; preview: CommandPreview } | null>(null)
  const [executionId, setExecutionId] = useState('')
  const request: CommandRequest = { commandId: command.id, params, ...(workspaceId ? { workspaceId } : {}) }
  const switchAction = (id: string) => {
    const next = actions.find((action) => action.id === id)
    if (!next || id === command.id) return
    const shared = sharedActionParams(command, next, params)
    onActionChange(id)
    session.setDraft({ commandId: id, params: shared, ...(workspaceId ? { workspaceId } : {}) })
  }
  const key = JSON.stringify(request)
  const [debouncedKey, setDebouncedKey] = useState(key)
  useEffect(() => { const timer = setTimeout(() => setDebouncedKey(key), 300); return () => clearTimeout(timer) }, [key])
  const preview = useQuery({ queryKey: ['preview', debouncedKey], queryFn: async () => unwrap(await window.devcommand.library.preview(JSON.parse(debouncedKey) as CommandRequest)), retry: false, enabled: !command.unavailableReason })
  const current = debouncedKey === key
  const conciseDisplay = preview.data ? conciseCommandDisplay(preview.data.display) : undefined
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), refetchInterval: (query) => executionId && !query.state.data?.find((entry) => entry.id === executionId)?.finishedAt ? 250 : false })
  const execution = executions.data?.find((entry) => entry.id === executionId)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (confirmation) dialogRef.current?.showModal(); else dialogRef.current?.close() }, [confirmation])
  const perform = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Operation failed.') } finally { setBusy(false) } }
  const execute = async (input: CommandRequest, token?: string) => {
    if (command.interactive) {
      if (typeof window.devcommand.library.launch !== 'function') throw new Error('Restart DevCommand to open AI CLI sessions.')
      if (!token) throw new Error('Review this session before opening the terminal.')
      const terminal = unwrap(await window.devcommand.library.launch(input, token))
      session.setInserted(terminal); settings.mutate({ terminalVisible: true }); setConfirmation(null)
      notify('CLI session opened in the terminal.')
      return
    }
    const result = unwrap(await window.devcommand.library.execute(input, token))
    setExecutionId(result.executionId); setConfirmation(null)
    await client.invalidateQueries({ queryKey: ['executions'] }); await client.invalidateQueries({ queryKey: ['history'] })
  }
  const run = () => void perform(async () => {
    const fresh = unwrap(await window.devcommand.library.preview(request))
    if (fresh.confirmationToken) setConfirmation({ request, preview: fresh })
    else await execute(request)
  })
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.composedPath().some((target) => target instanceof Element && target.matches('[data-slot=select-content], [data-slot=select-item], [data-slot=select-trigger]'))) return; if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !(event.target instanceof Element && event.target.closest('.terminal-view')) && !event.defaultPrevented && !document.querySelector('dialog[open], [data-slot=select-content][data-state=open]') && !busy && !confirmation && current && preview.data) { event.preventDefault(); run() } }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  })
  const sensitive = command.parameters.some((parameter) => parameter.sensitive)
  const tabs = [{ label: 'Configure', icon: SlidersHorizontal }, { label: 'Details', icon: Info }, { label: 'Examples', icon: Code2 }, { label: 'Related', icon: Link }]
  return <section className="panel inspector" aria-label="Command inspector"><div className="inspector-title"><div className="command-icon"><CommandIcon id={command.id} /></div><div><h1>{command.title}</h1><p>{command.description}</p></div><Button className="inspector-favorite" variant="outline" size="icon" aria-label="Favorite command" aria-pressed={command.favorite} onClick={() => void perform(async () => { unwrap(await window.devcommand.library.favorite(command.id, !command.favorite)); await client.invalidateQueries({ queryKey: ['library'] }) })}><Star fill={command.favorite ? 'currentColor' : 'none'} /></Button></div>
    {actions.length > 1 && <div className="command-action-picker"><label htmlFor="command-action">Action</label><SelectField label="Action" id="command-action" value={command.id} onValueChange={switchAction} options={actions.map((action) => ({ value: action.id, label: actionLabel(action) }))} className="min-w-0 flex-1" /><span>{actions.length} actions</span></div>}
    <div className="tabs" role="tablist" aria-label="Command information">{tabs.map(({ label, icon: Icon }, index) => <button key={label} role="tab" id={`tab-${label}`} aria-selected={tab === label} aria-controls="command-tabpanel" tabIndex={tab === label ? 0 : -1} className={cn(tab === label && 'active')} onClick={() => setTab(label)} onKeyDown={(event) => { let next: number; if (event.key === 'ArrowRight') next = (index + 1) % 4; else if (event.key === 'ArrowLeft') next = (index + 3) % 4; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = 3; else return; event.preventDefault(); setTab(tabs[next].label); document.getElementById(`tab-${tabs[next].label}`)?.focus() }}><Icon />{label}</button>)}</div>
    <div className="tab-content" role="tabpanel" id="command-tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'Configure' && <><div className="fields">{command.parameters.map((parameter) => <label key={parameter.key} htmlFor={`param-${parameter.key}`}>{parameter.label}{parameter.required && <span className="required-marker" aria-hidden="true">*</span>}{parameter.options ? <SelectField label={parameter.label} required={parameter.required} id={`param-${parameter.key}`} value={params[parameter.key]} onValueChange={(value) => setParams({ ...params, [parameter.key]: value })} options={parameter.options} className="w-full" /> : <span className="command-input">{parameter.key.toLowerCase().includes('url') ? <Link /> : command.category === 'Git' ? <GitBranch /> : <CommandIcon id={command.id} />}<input aria-label={parameter.label} aria-required={parameter.required} id={`param-${parameter.key}`} type={parameter.sensitive ? 'password' : 'text'} value={params[parameter.key]} maxLength={2048} autoComplete="off" onChange={(event) => setParams({ ...params, [parameter.key]: event.target.value })} /></span>}</label>)}</div>{command.id === 'git.remote.set-url' && <div className="command-note"><Info /><p>Updates the remote URL. Keeps its name and branches unchanged.</p></div>}<div className="preview"><div className="preview-header"><strong>Command Preview</strong><Button variant="outline" size="sm" disabled={!!command.unavailableReason || !current || !preview.data || preview.isError || sensitive || busy} onClick={() => void perform(async () => { await copyText(conciseDisplay!); notify('Command copied.') })}><Copy />Copy</Button></div>{command.unavailableReason ? <p role="status">{command.unavailableReason}</p> : !current || preview.isPending ? <p>Validating parameters…</p> : preview.isError ? <p role="alert" className="terminal-error">{preview.error.message}</p> : <><pre><code>{conciseDisplay}</code></pre>{conciseDisplay !== preview.data.display && <details className="execution-options"><summary>Managed execution options</summary><pre>{preview.data.display}</pre></details>}<p className="preview-cwd">{preview.data.cwd}</p></>}</div></>}
      {tab === 'Details' && <div className="reference-details"><h3>About this command</h3><p>{command.description}</p><h3>Before you run</h3>{preview.data?.consequences.map((text) => <p key={text}>{text}</p>)}{preview.isError && <p>{preview.error.message}</p>}</div>}
      {tab === 'Examples' && <div className="reference-details"><h3>Example</h3>{command.examples.map((example) => <pre key={example}><code>{example}</code></pre>)}</div>}
      {tab === 'Related' && <div className="reference-details"><h3>Search aliases</h3><p>{command.aliases.join(', ') || command.category}</p><p>Use the library filters to find related commands.</p></div>}
      {error && <p className="terminal-error" role="alert">{error}</p>}
      {execution && <div className="execution-card inline-execution"><div className="execution-heading"><span className={`execution-status status-${execution.status}`}>{execution.status}</span><span>Exit: {execution.exitCode ?? '—'}</span>{execution.status === 'running' && <Button size="sm" variant="outline" onClick={() => void perform(async () => { unwrap(await window.devcommand.commands.cancel(execution.id)); await client.invalidateQueries({ queryKey: ['executions'] }) })}>Cancel</Button>}</div><pre className="execution-output">{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error}</pre></div>}
    </div>
    <div className="inspector-actions"><div className="command-risk"><span className={`risk-label risk-${command.risk}`}>{command.risk === 'safe' ? <Info /> : <TriangleAlert />}{command.risk}</span><small>{command.risk === 'safe' ? 'Read-only operation' : command.risk === 'dangerous' ? 'Review carefully. Data may be lost.' : 'Changes require your confirmation.'}</small></div><button className="execution-directory" title={preview.data?.cwd ?? 'Choose a repository'} onClick={() => navigate('/workspaces')}><Folder /><span>{workspaceId ? 'Repository root' : 'Home directory'}</span></button><Button variant="outline" disabled={!!command.unavailableReason || !current || !preview.data || preview.isError || sensitive || busy} onClick={() => void perform(async () => { const terminal = unwrap(await window.devcommand.library.insert(request)); session.setInserted(terminal); settings.mutate({ terminalVisible: true }); notify('Opened a terminal draft. Review it and press Enter to run.') })}><Terminal />Insert</Button><Button disabled={!!command.unavailableReason || !current || !preview.data || preview.isError || busy} onClick={run}><Play />Run Command</Button></div>
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="confirmation-title" onCancel={() => setConfirmation(null)}><h2 id="confirmation-title">Confirm {command.title}</h2><p>Review the operation and consequences before continuing.</p><p className="confirmation-target">Target directory: {confirmation?.preview.cwd}</p>{confirmation?.preview.consequences.map((text) => <p key={text}>{text}</p>)}<pre>{confirmation?.preview.display}</pre><div className="confirmation-actions"><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button disabled={busy} onClick={() => { if (confirmation) void perform(() => execute(confirmation.request, confirmation.preview.confirmationToken)) }}>Confirm & Run</Button></div>{error && <p role="alert" className="terminal-error">{error}</p>}</dialog>
  </section>
}
