import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { useSession } from '../../lib/session'
import { unwrap } from '../../lib/settings'
import { useWorkspaces } from '../../lib/workspace'

export function WorkspacesPage() {
  const workspaces = useWorkspaces()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); useSession.getState().setDraft(null); await client.invalidateQueries({ queryKey: ['workspaces'] }); await client.invalidateQueries({ queryKey: ['repository'] }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to update workspace.') }
    finally { setBusy(false) }
  }
  return <section className="panel workspace-page"><div className="page-heading"><Folder /><div><h1>Workspaces</h1><p>Add an existing Git directory. Removing an entry never deletes local files.</p></div><Button disabled={busy} onClick={() => void run(async () => unwrap(await window.devcommand.workspace.addDirectory()))}><Plus />Add repository</Button></div>
    {(error || workspaces.isError) && <p className="terminal-error" role="alert">{error || 'Unable to read workspaces.'}</p>}
    {workspaces.isPending && <p>Loading repositories…</p>}
    {workspaces.data?.entries.length === 0 && <div className="managed-empty"><Folder /><p>No repositories yet. Add a local Git directory to get started.</p></div>}
    <div className="workspace-entries">{workspaces.data?.entries.slice().sort((a, b) => Number(b.favorite) - Number(a.favorite)).map((entry) => <article key={entry.id} className="workspace-entry"><Folder /><div><h2>{entry.name}</h2><p>{entry.rootPath}</p></div><Button variant="ghost" size="icon" aria-label={`Favorite ${entry.name}`} aria-pressed={entry.favorite} disabled={busy} onClick={() => void run(async () => unwrap(await window.devcommand.workspace.favorite(entry.id, !entry.favorite)))}><Star fill={entry.favorite ? 'currentColor' : 'none'} /></Button><Button variant="outline" disabled={busy || entry.id === workspaces.data.selectedId} onClick={() => void run(async () => unwrap(await window.devcommand.workspace.select(entry.id)))}>{entry.id === workspaces.data.selectedId ? 'Selected' : 'Select'}</Button><Button variant="ghost" size="icon" aria-label={`Remove ${entry.name} from list`} disabled={busy} onClick={() => void run(async () => unwrap(await window.devcommand.workspace.remove(entry.id)))}><Trash2 /></Button></article>)}</div>
  </section>
}
