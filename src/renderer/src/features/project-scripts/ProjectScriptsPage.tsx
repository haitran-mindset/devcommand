import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, FileCode2, Play, RefreshCw, Search, Terminal, X } from 'lucide-react'
import type { ProjectScript, ProjectScriptRequest } from '../../../../shared/project-scripts'
import { SelectField } from '../../components/ui/select-field'
import { Button } from '../../components/ui/button'
import { unwrap, useUpdateSettings } from '../../lib/settings'
import { useWorkspaces } from '../../lib/workspace'
import { useSession } from '../../lib/session'
import { useNotifications } from '../../lib/notifications'
import { copyText } from '../../lib/clipboard'

export function ProjectScriptsPage() {
  const workspaces = useWorkspaces()
  const workspaceId = workspaces.data?.selectedId
  return workspaceId ? <ProjectScripts key={workspaceId} workspaceId={workspaceId} /> : <section className="panel module-page"><FileCode2 /><h1>Project Scripts</h1><p>{workspaces.isPending ? 'Loading repositories…' : workspaces.isError ? 'Unable to load repositories.' : 'Choose a repository in the header to discover its scripts.'}</p>{workspaces.isError && <Button onClick={() => void workspaces.refetch()}>Retry</Button>}</section>
}
function ProjectScripts({ workspaceId }: { workspaceId: string }) {
  const scripts = useQuery({ queryKey: ['project-scripts', workspaceId], queryFn: async () => unwrap(await window.devcommand.projectScripts.list({ workspaceId })), retry: false })
  const [search, setSearch] = useState(''), [source, setSource] = useState('all')
  const [selected, setSelected] = useState<{ script: ProjectScript; revision: string } | null>(null)
  const entries = scripts.data?.scripts ?? []
  const sources = [...new Set(entries.map(entry => entry.sourceFile))]
  const activeSource = source === 'all' || sources.includes(source) ? source : 'all'
  const filtered = entries.filter(entry => (activeSource === 'all' || activeSource === entry.sourceFile) && `${entry.name} ${entry.definition}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="panel project-scripts-page" aria-label="Project Scripts"><header className="project-scripts-heading"><span><FileCode2 /></span><div><h1>Project Scripts</h1><p>Run scripts defined in your repository.</p></div><Button size="sm" variant="outline" disabled={scripts.isFetching} onClick={() => void scripts.refetch()}><RefreshCw className="size-3.5" />Refresh</Button></header>
    <div className="project-scripts-controls"><label><Search /><input type="search" aria-label="Search project scripts" placeholder="Search scripts…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label><div aria-label="Script source">{sources.length > 4 ? <SelectField label="Script source" value={activeSource} onValueChange={setSource} options={[{ value: 'all', label: 'All scripts' }, ...sources.map(value => ({ value, label: value }))]} /> : ['all', ...sources].map(value => <Button key={value} title={value} size="sm" variant={activeSource === value ? 'secondary' : 'ghost'} aria-pressed={activeSource === value} onClick={() => setSource(value)}>{value === 'all' ? 'All scripts' : value}</Button>)}</div></div>
    {scripts.isPending && <p className="git-empty" role="status">Discovering project scripts…</p>}{scripts.isError && <p role="alert" className="terminal-error">{scripts.error.message}</p>}
    {scripts.data?.warnings.map(warning => <p className="project-scripts-warning" key={warning}>{warning}</p>)}
    {!scripts.isPending && !scripts.isError && (!filtered.length ? <div className="git-clean-state"><Terminal /><strong>{entries.length ? 'No matching scripts' : 'No project scripts found'}</strong><p>{entries.length ? 'Try another search or source.' : 'Add package scripts, Makefile targets, or .sh files at the root or in scripts/, then refresh.'}</p></div> : <div className="project-scripts-list">{filtered.map(entry => <article className="project-script-row" key={entry.id}><FileCode2 className="size-4" aria-hidden="true" /><div><div className="project-script-title"><h2>{entry.name}</h2><span>{entry.sourceFile}</span></div><code>{entry.command}</code><p title={entry.definition}>{entry.definition}</p></div><Button size="icon-sm" variant="ghost" title="Copy command" aria-label={`Copy ${entry.name} from ${entry.sourceFile}`} onClick={() => { void copyText(entry.command).then(() => useNotifications.getState().add('info', 'Command copied')).catch(() => useNotifications.getState().add('error', 'Unable to copy command')) }}><Copy className="size-3.5" /></Button><Button size="icon-sm" title="Run script" aria-label={`Run ${entry.name} from ${entry.sourceFile}`} disabled={scripts.isFetching} onClick={() => setSelected({ script: entry, revision: scripts.data!.revision })}><Play className="size-3.5" /></Button></article>)}</div>)}
    <p className="project-scripts-footnote">Discovers root manifests and .sh files at the root or directly inside scripts/. Scripts run with your user permissions in a new terminal tab.</p>
    {selected && <RunProjectScript request={{ workspaceId, id: selected.script.id, revision: selected.revision }} name={selected.script.name} onClose={() => setSelected(null)} onRefresh={() => { setSelected(null); void scripts.refetch() }} />}
  </section>
}
function RunProjectScript({ request, name, onClose, onRefresh }: { request: ProjectScriptRequest; name: string; onClose: () => void; onRefresh: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), running = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const settings = useUpdateSettings()
  const preview = useQuery({ queryKey: ['project-script-preview', request], queryFn: async () => unwrap(await window.devcommand.projectScripts.preview(request)), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false })
  useEffect(() => { dialog.current?.showModal() }, [])
  const run = async () => {
    if (running.current || !preview.data || preview.isFetching || preview.isError) return
    running.current = true; setBusy(true); setError('')
    try {
      const session = unwrap(await window.devcommand.projectScripts.run({ ...request, token: preview.data.token }))
      useSession.getState().setInserted(session); settings.mutate({ terminalVisible: true })
      useNotifications.getState().add('info', 'Project script started', name); onClose()
    } catch (failure) { const message = failure instanceof Error ? failure.message : 'Unable to run script.'; setError(message); useNotifications.getState().add('error', 'Project script could not start', message) }
    finally { running.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="saved-dialog" aria-label={`Run ${name}`} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}><div className="saved-dialog-content"><header><div><Terminal /><h2>Run {name}</h2></div><Button variant="ghost" size="icon-sm" aria-label="Close dialog" disabled={busy} onClick={onClose}><X /></Button></header><div className="saved-form">{preview.isPending && <p role="status">Preparing script…</p>}{preview.isError && <p role="alert" className="terminal-error">{preview.error.message}</p>}{preview.data && <><div className="saved-run-target"><span>Directory</span><code>{preview.data.cwd}</code></div><pre className="saved-run-code">{preview.data.command}</pre><p className="project-script-definition">{preview.data.definition}</p></>}<p className="saved-run-note">Project scripts can change files and run other commands, including lifecycle hooks, Makefile recipes or shell scripts. Runs in the selected repository; the shell stays open afterward.</p>{error && <p role="alert" className="terminal-error">{error}</p>}<footer><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="outline" disabled={busy} onClick={onRefresh}>Refresh scripts</Button><Button disabled={busy || !preview.data || preview.isFetching || preview.isError || !!error} onClick={() => void run()}><Play />{busy ? 'Opening…' : 'Confirm & Run'}</Button></footer></div></div></dialog>
}
