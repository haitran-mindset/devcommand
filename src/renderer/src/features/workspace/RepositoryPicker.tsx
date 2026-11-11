import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Folder } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../components/ui/select'
import { useWorkspaces } from '../../lib/workspace'
import { useSession } from '../../lib/session'
import { unwrap } from '../../lib/settings'

export function RepositoryPicker({ notify }: { notify: (message: string) => void }) {
  const workspaces = useWorkspaces()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const selected = workspaces.data?.entries.find((entry) => entry.id === workspaces.data.selectedId)

  const select = async (value: string) => {
    if (value === 'manage-repositories') { navigate('/workspaces'); return }
    if (busy || value === selected?.id) return
    setBusy(true)
    try {
      if (value === 'add-repository') {
        const added = unwrap(await window.devcommand.workspace.addDirectory())
        if (!added) return
      } else {
        unwrap(await window.devcommand.workspace.select(value))
      }
      useSession.getState().setDraft(null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['workspaces'] }),
        client.invalidateQueries({ queryKey: ['repository'] }),
        client.invalidateQueries({ queryKey: ['git'] }),
      ])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to switch repository.')
    } finally { setBusy(false) }
  }

  return <Select value={selected?.id ?? ''} onValueChange={(value) => void select(value)} disabled={busy || workspaces.isPending}>
    <SelectTrigger className="workspace-picker" aria-label="Switch repository" aria-busy={busy}>
      <Folder /><SelectValue placeholder="Select a repository"><span className="repository-label"><strong>{selected?.name ?? 'Select a repository'}</strong><small title={selected?.rootPath}>{selected?.rootPath ?? 'Connect your local workspace'}</small></span></SelectValue>
    </SelectTrigger>
    <SelectContent position="popper" align="start" className="max-w-[min(360px,calc(100vw-24px))]">
      <SelectGroup>{workspaces.data?.entries.map((entry) => <SelectItem key={entry.id} value={entry.id} textValue={entry.name}><span className="repository-option"><strong>{entry.name}</strong><small title={entry.rootPath}>{entry.rootPath}</small></span></SelectItem>)}</SelectGroup>
      {!!workspaces.data?.entries.length && <SelectSeparator />}
      <SelectGroup><SelectItem value="add-repository">Add repository…</SelectItem><SelectItem value="manage-repositories">Manage repositories</SelectItem></SelectGroup>
    </SelectContent>
  </Select>
}
