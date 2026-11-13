import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Hash, Pencil, Play, Save, Terminal, Trash2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { SavedCommand, SavedCommandRun, SaveSavedCommand } from '../../../../shared/saved-commands'
import { savedCommandSaveSchema, savedCommandTagSchema, savedCommandTitle } from '../../../../shared/saved-commands'
import { Button } from '../../components/ui/button'
import { SelectField } from '../../components/ui/select-field'
import { unwrap, useUpdateSettings } from '../../lib/settings'
import { useSession } from '../../lib/session'
import { useWorkspaces } from '../../lib/workspace'
import { copyText } from '../../lib/clipboard'

function Modal({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="saved-dialog" aria-labelledby="saved-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="saved-dialog-content"><header><div><Terminal /><h2 id="saved-dialog-title">{title}</h2></div><Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="Close dialog" onClick={onClose}><X /></Button></header>{children}</div>
  </dialog>
}
export function SavedCommandEditor({ entry, availableTags, onClose, onSave }: { entry: SavedCommand | null; availableTags: string[]; onClose: () => void; onSave: (input: SaveSavedCommand) => Promise<void> }) {
  const [title, setTitle] = useState(entry?.title ?? ''), [command, setCommand] = useState(entry?.command ?? '')
  const [description, setDescription] = useState(entry?.description ?? ''), [tags, setTags] = useState(entry?.tags.join(', ') ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const parts = tags.split(',').map(value => value.trim())
  const lastTag = (parts.at(-1) ?? '').toLowerCase()
  const selectedTags = parts.filter(Boolean).map(value => value.toLowerCase())
  const fragment = availableTags.includes(lastTag) ? '' : lastTag
  const suggestions = availableTags.filter(tag => !selectedTags.includes(tag) && tag.includes(fragment)).slice(0, 8)
  const chooseTag = (tag: string) => {
    const next = [...parts]
    if (lastTag && !availableTags.includes(lastTag)) next.pop()
    const values = [...new Set([...next.filter(Boolean).map(value => value.toLowerCase()), tag])]
    if (values.length > 12) { setError('A command can have at most 12 tags.'); return }
    setTags(values.join(', ') + ', '); setError('')
  }
  const saving = useRef(false)
  const save = async () => {
    if (saving.current) return
    const result = savedCommandSaveSchema.safeParse({ title, command, description, tags: tags.split(',').map(value => value.trim()).filter(Boolean), ...(entry ? { id: entry.id, revision: entry.revision } : {}) })
    if (!result.success) { setError(result.error.issues[0]?.message ?? 'Check your command fields.'); return }
    saving.current = true; setBusy(true); setError('')
    try { await onSave(result.data); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save command.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <Modal title={entry ? 'Edit saved command' : 'New saved command'} busy={busy} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); void save() }} className="saved-form saved-editor-form">
      <label><span>Title <span className="saved-optional">optional</span></span><input aria-label="Title" autoFocus maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="Start local server" disabled={busy} /></label>
      <label>Command<textarea aria-label="Command" aria-describedby="saved-command-help" required rows={4} maxLength={8192} value={command} onChange={event => setCommand(event.target.value)} placeholder="npm run dev" spellCheck={false} autoCapitalize="off" autoComplete="off" disabled={busy} /><small id="saved-command-help">Supports multiple lines. Keep credentials out.</small></label>
      <label><span>Description <span className="saved-optional">optional</span></span><input aria-label="Description" maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder="When to use this command" disabled={busy} /></label>
      <label>Tags<input aria-label="Tags" aria-describedby="saved-tags-help" maxLength={500} value={tags} onChange={event => setTags(event.target.value)} placeholder="Choose below or type a new tag" disabled={busy} /><small id="saved-tags-help">Choose an existing tag or enter comma-separated tags · up to 12.</small></label>
      {availableTags.length > 0 && <div className="saved-tag-suggestions" role="group" aria-label="Existing tag suggestions">{suggestions.map(tag => <button type="button" key={tag} disabled={busy} aria-label={`Add tag ${tag}`} onClick={() => chooseTag(tag)}><Hash />{tag}</button>)}{!suggestions.length && <span>{fragment ? 'No matching existing tags. You can save this as a new tag.' : 'All matching tags are already selected.'}</span>}</div>}
      {error && <p role="alert" className="terminal-error">{error}</p>}
      <footer><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}><Save />{busy ? 'Saving…' : 'Save'}</Button></footer>
    </form>
  </Modal>
}
export function RenameSavedTag({ tag, availableTags, count, onClose, onRename }: { tag: string; availableTags: string[]; count: number; onClose: () => void; onRename: (name: string) => Promise<void> }) {
  const [name, setName] = useState(tag), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const saving = useRef(false)
  const normalized = name.trim().toLowerCase()
  const merge = normalized !== tag && availableTags.includes(normalized)
  return <Modal title="Rename tag" busy={busy} onClose={onClose}><form className="saved-form saved-rename-form" onSubmit={event => {
    event.preventDefault()
    if (saving.current) return
    const result = savedCommandTagSchema.safeParse(name)
    if (!result.success) { setError('Use 1–40 characters without commas or control characters.'); return }
    saving.current = true; setBusy(true); setError('')
    void onRename(result.data).then(onClose).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Unable to rename tag.')).finally(() => { saving.current = false; setBusy(false) })
  }}><p>Rename <strong>#{tag}</strong> on {count} {count === 1 ? 'command' : 'commands'}.</p><label>Tag name<input autoFocus required maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>{merge && <p className="saved-tag-merge" role="status">#{normalized} already exists. The tags will be merged without duplicates.</p>}{error && <p className="terminal-error" role="alert">{error}</p>}<footer><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !normalized || normalized === tag}><Pencil />{busy ? 'Renaming…' : 'Rename'}</Button></footer></form></Modal>
}
export function DeleteSavedCommand({ entry, onClose, onDelete }: { entry: SavedCommand; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const deleting = useRef(false)
  return <Modal title="Delete saved command" busy={busy} onClose={onClose}><div className="saved-form"><p>Delete <strong>{savedCommandTitle(entry)}</strong> from your library? This does not stop running terminal sessions.</p><pre>{entry.command}</pre>{error && <p role="alert" className="terminal-error">{error}</p>}<footer><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { if (deleting.current) return; deleting.current = true; setBusy(true); void onDelete().then(onClose).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Unable to delete command.')).finally(() => { deleting.current = false; setBusy(false) }) }}><Trash2 />{busy ? 'Deleting…' : 'Delete command'}</Button></footer></div></Modal>
}
export function ClearSavedCommands({ entries, onClose, onDelete }: { entries: SavedCommand[]; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const deleting = useRef(false)
  return <Modal title="Delete all saved commands" busy={busy} onClose={onClose}><div className="saved-form">
    <p>Delete all <strong>{entries.length}</strong> saved commands and their tags? This cannot be undone. Running terminal sessions will continue.</p>
    {error && <p role="alert" className="terminal-error">{error}</p>}
    <footer><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => {
      if (deleting.current) return
      deleting.current = true; setBusy(true); setError('')
      void onDelete().then(onClose).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Unable to delete commands.')).finally(() => { deleting.current = false; setBusy(false) })
    }}><Trash2 />{busy ? 'Deleting…' : 'Delete all'}</Button></footer>
  </div></Modal>
}
export function RunSavedCommand({ entry, onClose, notify }: { entry: SavedCommand; onClose: () => void; notify: (message: string) => void }) {
  const workspaces = useWorkspaces()
  const settings = useUpdateSettings()
  const activeTerminalId = useSession(state => state.activeTerminalId)
  const [target, setTarget] = useState(activeTerminalId ? 'terminal' : 'home')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false)
  const missingTerminal = target === 'terminal' && !activeTerminalId
  const request: SavedCommandRun = { id: entry.id, revision: entry.revision, workspaceId: target.startsWith('workspace:') ? target.slice(10) : null, terminalId: target === 'terminal' ? activeTerminalId : null }
  const preview = useQuery({ queryKey: ['saved-command-preview', request], queryFn: async () => unwrap(await window.devcommand.savedCommands.preview(request)), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false, enabled: !missingTerminal })
  const run = async () => {
    if (missingTerminal || running.current || !preview.data || preview.isFetching || preview.isError) return
    running.current = true; setBusy(true); setError('')
    try {
      const session = unwrap(await window.devcommand.savedCommands.run({ ...request, token: preview.data.token }))
      useSession.getState().setInserted(session)
      settings.mutate({ terminalVisible: true })
      notify('Saved command opened in a new terminal tab.'); onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to run command.'); void preview.refetch() }
    finally { running.current = false; setBusy(false) }
  }
  return <Modal title={`Run ${savedCommandTitle(entry)}`} busy={busy} onClose={onClose}><div className="saved-form">
    <label>Run in<SelectField label="Run in" value={target} onValueChange={value => { setTarget(value); setError('') }} disabled={busy || workspaces.isPending} options={[...(activeTerminalId || target === 'terminal' ? [{ value: 'terminal', label: 'Active terminal directory', disabled: !activeTerminalId }] : []), { value: 'home', label: 'Home directory' }, ...(workspaces.data?.entries ?? []).map(value => ({ value: `workspace:${value.id}`, label: value.name }))]} className="w-full" /></label>
    {missingTerminal && <p role="alert" className="terminal-error">The active terminal closed. Choose Home or a repository.</p>}{preview.isPending && !missingTerminal && <p role="status">Preparing command preview…</p>}
    {preview.isError && <p role="alert" className="terminal-error">{preview.error.message}</p>}
    {preview.data && !preview.isError && <><div className="saved-run-target"><span>Directory</span><code>{preview.data.cwd}</code><span>Shell</span><code>{preview.data.shell}</code></div><pre className="saved-run-code">{preview.data.command}</pre></>}
    <p className="saved-run-note">Runs your shell code with your user permissions in a new terminal tab. Review the full command and directory. Terminal output stays in memory; the shell remains open after the command finishes.</p>
    {error && <p role="alert" className="terminal-error">{error}</p>}
    <footer><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="outline" disabled={busy} onClick={() => { void copyText(entry.command).then(() => notify('Command copied.')).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Unable to copy command.')) }}><Copy />Copy</Button><Button disabled={busy || !preview.data || preview.isFetching || preview.isError || (target === 'terminal' && !activeTerminalId)} onClick={() => void run()}><Play />{busy ? 'Opening…' : 'Confirm & Run'}</Button></footer>
  </div></Modal>
}
