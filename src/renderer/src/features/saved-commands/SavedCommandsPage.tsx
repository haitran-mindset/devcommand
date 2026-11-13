import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Copy, GripVertical, Hash, Pencil, Play, Plus, Search, Tag, Terminal, Trash2, X } from 'lucide-react'
import type { SavedCommand, SaveSavedCommand } from '../../../../shared/saved-commands'
import { savedCommandTagSchema, savedCommandTitle } from '../../../../shared/saved-commands'
import { Button } from '../../components/ui/button'
import { SelectField } from '../../components/ui/select-field'
import { unwrap } from '../../lib/settings'
import { copyText } from '../../lib/clipboard'
import { cn } from '../../lib/utils'
import { SavedCommandEditor, DeleteSavedCommand, ClearSavedCommands, RenameSavedTag, RunSavedCommand } from './SavedCommandDialogs'

export function SavedCommandsPage({ notify }: { notify: (message: string) => void }) {
  const client = useQueryClient()
  const commands = useQuery({ queryKey: ['saved-commands'], queryFn: async () => unwrap(await window.devcommand.savedCommands.list()) })
  const [search, setSearch] = useState(''), [tagFilter, setTagFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [bulkTag, setBulkTag] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const changing = useRef(false)
  const focusAfterMove = useRef<string | null>(null)
  const [draggedId, setDraggedId] = useState('')
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: 'before' | 'after' } | null>(null)
  const [orderNotice, setOrderNotice] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'edit'; entry: SavedCommand | null } | { kind: 'delete' | 'run'; entry: SavedCommand } | { kind: 'clear'; entries: SavedCommand[] } | { kind: 'rename-tag'; tag: string } | null>(null)
  useEffect(() => {
    if (busy || !focusAfterMove.current) return
    const handle = document.getElementById(`saved-grip-${focusAfterMove.current}`)
    if (handle instanceof HTMLButtonElement && !handle.disabled) { handle.focus(); focusAfterMove.current = null }
  }, [busy, commands.data])
  const entries = commands.data ?? []
  const tags = [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b))
  const selectedEntries = entries.filter(entry => selected.includes(entry.id))
  const removableTags = [...new Set(selectedEntries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b))
  const query = search.trim().toLowerCase()
  const filtered = entries.filter(entry => (tagFilter === null || (tagFilter === '' ? !entry.tags.length : entry.tags.includes(tagFilter))) && [entry.title, entry.command, entry.description, ...entry.tags].join(' ').toLowerCase().includes(query))
  const filter = (tag: string | null) => { setTagFilter(tag); setSelected([]) }
  const refresh = () => client.invalidateQueries({ queryKey: ['saved-commands'] })
  const save = async (input: SaveSavedCommand) => { unwrap(await window.devcommand.savedCommands.save(input)); await refresh(); notify('Command saved.') }
  const applyTag = async (operation: 'add' | 'remove', value = bulkTag) => {
    if (changing.current) return
    const tag = savedCommandTagSchema.safeParse(value)
    if (!tag.success) { setError('Enter a tag of 1–40 characters without control characters or commas.'); return }
    const ids = selectedEntries.filter(entry => operation === 'add' ? !entry.tags.includes(tag.data) : entry.tags.includes(tag.data)).map(entry => entry.id)
    if (!ids.length) { notify('No commands need this tag change.'); return }
    changing.current = true; setBusy(true); setError('')
    try {
      unwrap(await window.devcommand.savedCommands.tag({ ids, tag: tag.data, operation }))
      await refresh(); setSelected([]); setBulkTag(''); notify(operation === 'add' ? 'Tag added to selected commands.' : `Tag removed from ${ids.length} ${ids.length === 1 ? 'command' : 'commands'}.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to update tags.') }
    finally { changing.current = false; setBusy(false) }
  }
  const copy = async (entry: SavedCommand) => {
    try { await copyText(entry.command); notify('Command copied.') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to copy command.') }
  }
  const move = async (sourceId: string, targetId: string, placement: 'before' | 'after', keyboard = false) => {
    if (changing.current || sourceId === targetId) return
    changing.current = true; setBusy(true); setError(''); setOrderNotice('')
    try {
      unwrap(await window.devcommand.savedCommands.move({ sourceId, targetId, placement }))
      await refresh(); setOrderNotice('Command order saved.')
      if (keyboard) focusAfterMove.current = sourceId
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to reorder commands.'); await refresh() }
    finally { changing.current = false; setBusy(false); setDraggedId(''); setDropTarget(null) }
  }
  const allSelected = filtered.length > 0 && filtered.every(entry => selected.includes(entry.id))
  return <section className="saved-page" aria-label="Saved commands">
    <header className="saved-page-heading"><span className="saved-heading-icon"><Bookmark /></span><div><h1>Saved commands <span className="saved-heading-count" aria-hidden="true">{entries.length}</span></h1></div><Button size="sm" variant="outline" disabled={busy || !entries.length || commands.isPending || commands.isError} onClick={() => setDialog({ kind: 'clear', entries })}><Trash2 />Delete all</Button><Button size="sm" onClick={() => setDialog({ kind: 'edit', entry: null })} disabled={busy}><Plus />New command</Button></header>
    <span className="sr-only" role="status">{orderNotice}</span><span className="sr-only" id="saved-reorder-hint">Drag to reorder, or use Alt plus Up or Down arrow.</span>
    <div className="saved-layout"><section className="panel saved-command-panel" aria-label="Personal command library">
      <div className="saved-toolbar">
        {entries.length > 0 && <label className="saved-select-all" title="Select visible commands"><input type="checkbox" checked={allSelected} ref={node => { if (node) node.indeterminate = !allSelected && filtered.some(entry => selected.includes(entry.id)) }} disabled={busy || !filtered.length} onChange={() => setSelected(allSelected ? [] : filtered.map(entry => entry.id))} /><span className="sr-only">Select visible</span></label>}
        <label className="saved-search"><Search /><input type="search" aria-label="Search saved commands" value={search} maxLength={200} placeholder="Search commands…" onChange={event => { setSearch(event.target.value); setSelected([]) }} />{search && <Button variant="ghost" size="icon-sm" aria-label="Clear saved command search" onClick={() => { setSearch(''); setSelected([]) }}><X /></Button>}</label>
      </div>
      <nav className="saved-filterbar" aria-label="Command tags">
        <button className={cn('saved-tag-filter', tagFilter === null && 'selected')} aria-pressed={tagFilter === null} onClick={() => filter(null)}>All commands<span>{entries.length}</span></button>
        <button className={cn('saved-tag-filter', tagFilter === '' && 'selected')} aria-pressed={tagFilter === ''} onClick={() => filter('')}>Untagged<span>{entries.filter(entry => !entry.tags.length).length}</span></button>
        {tags.map(tag => <div className="saved-tag-control" key={tag}><button className={cn('saved-tag-filter', tagFilter === tag && 'selected')} title={tag} aria-pressed={tagFilter === tag} onClick={() => filter(tag)}><Hash /><span className="saved-tag-name">{tag}</span><span>{entries.filter(entry => entry.tags.includes(tag)).length}</span></button><Button variant="ghost" size="icon-xs" disabled={busy} className="saved-tag-edit" title={`Rename ${tag}`} aria-label={`Rename tag ${tag}`} onClick={() => setDialog({ kind: 'rename-tag', tag })}><Pencil className="size-3" /></Button></div>)}
      </nav>
      {selected.length > 0 && <div className="saved-selection"><span>{selected.length} selected</span><input aria-label="Tag selected commands" placeholder="Tag name" maxLength={40} value={bulkTag} disabled={busy} onChange={event => setBulkTag(event.target.value)} /><Button variant="outline" size="sm" disabled={busy || !bulkTag.trim()} onClick={() => void applyTag('add')}><Tag />Add tag</Button><SelectField label="Remove tag from selected commands" value="" disabled={busy || !removableTags.length} options={[{ value: '', label: 'Remove tag', disabled: true }, ...removableTags.map(tag => ({ value: tag, label: `${tag} (${selectedEntries.filter(entry => entry.tags.includes(tag)).length})` }))]} onValueChange={tag => void applyTag('remove', tag)} /><Button variant="ghost" size="icon-sm" aria-label="Clear command selection" disabled={busy} onClick={() => setSelected([])}><X /></Button></div>}
      {(error || commands.isError) && <div role="alert" className="saved-error"><span>{error || 'Unable to load saved commands.'}</span><Button variant="outline" size="sm" onClick={() => { setError(''); void commands.refetch() }}>Refresh</Button></div>}
      {commands.isPending ? <div className="saved-empty" role="status"><Terminal /><p>Loading saved commands…</p></div> : !entries.length && !commands.isError ? <div className="saved-empty"><span><Terminal /></span><h2>A home for the commands you keep reaching for</h2><p>Save a command once. Copy it, run it, and organize it with tags.</p><Button onClick={() => setDialog({ kind: 'edit', entry: null })}><Plus />Create your first command</Button></div> : !filtered.length && !commands.isError ? <div className="saved-empty"><Search /><h2>No matching commands</h2><p>Try another search or select a different tag.</p></div> : <div className="saved-command-list">{filtered.map((entry, index) => <article className={cn('saved-command-row', selected.includes(entry.id) && 'is-selected', draggedId === entry.id && 'is-dragging', dropTarget?.id === entry.id && `drop-${dropTarget.placement}`)} key={entry.id} onDragOver={event => {
        if (!draggedId || draggedId === entry.id || busy) return
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'
        const bounds = event.currentTarget.getBoundingClientRect()
        setDropTarget({ id: entry.id, placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' })
        const scroll = event.currentTarget.closest<HTMLElement>('.page-content')
        if (scroll) { const area = scroll.getBoundingClientRect(); if (event.clientY < area.top + 28) scroll.scrollTop -= 12; else if (event.clientY > area.bottom - 28) scroll.scrollTop += 12 }
      }} onDrop={event => {
        if (!draggedId || draggedId === entry.id || busy) return
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        void move(draggedId, entry.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')
      }}>
        <button type="button" id={`saved-grip-${entry.id}`} className="saved-drag-handle" aria-label={`Reorder ${savedCommandTitle(entry)}`} aria-describedby="saved-reorder-hint" title="Drag to reorder · Alt+↑/↓" draggable={!busy && filtered.length > 1} disabled={busy || filtered.length < 2} onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-devcommand-saved-command', entry.id); const row = event.currentTarget.closest('.saved-command-row'); if (row) event.dataTransfer.setDragImage(row, 16, 16); setDraggedId(entry.id) }} onDragEnd={() => { setDraggedId(''); setDropTarget(null) }} onKeyDown={event => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const target = filtered[index + (event.key === 'ArrowUp' ? -1 : 1)]
          if (target) void move(entry.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after', true)
        }}><GripVertical aria-hidden="true" /></button>
        <input type="checkbox" aria-label={`Select ${savedCommandTitle(entry)}`} checked={selected.includes(entry.id)} disabled={busy} onChange={() => setSelected(previous => previous.includes(entry.id) ? previous.filter(id => id !== entry.id) : [...previous, entry.id])} />
        <div className="saved-command-body"><div className="saved-command-title"><h2>{savedCommandTitle(entry)}</h2>{entry.tags.length > 0 && <div className="saved-command-tags">{entry.tags.map(tag => <button key={tag} title={`Filter by ${tag}`} onClick={() => filter(tag)}>{tag}</button>)}</div>}</div>{entry.description && <p title={entry.description}>{entry.description}</p>}<pre title={entry.command}><span className="saved-command-prompt" aria-hidden="true">$ </span><code>{entry.command.replace(/\r?\n/g, ' ↵ ')}</code></pre></div>
        <div className="saved-row-actions"><Button variant="ghost" size="icon-xs" aria-label={`Copy ${savedCommandTitle(entry)}`} title="Copy command" onClick={() => void copy(entry)}><Copy /></Button><Button variant="ghost" size="icon-xs" aria-label={`Edit ${savedCommandTitle(entry)}`} title="Edit command" disabled={busy} onClick={() => setDialog({ kind: 'edit', entry })}><Pencil /></Button><Button variant="ghost" size="icon-xs" aria-label={`Delete ${savedCommandTitle(entry)}`} title="Delete command" disabled={busy} onClick={() => setDialog({ kind: 'delete', entry })}><Trash2 /></Button><Button size="icon-xs" disabled={busy} title={`Run ${savedCommandTitle(entry)}`} onClick={() => setDialog({ kind: 'run', entry })} aria-label={`Run ${savedCommandTitle(entry)}`}><Play /></Button></div>
      </article>)}</div>}
    </section></div>
    {dialog?.kind === 'edit' && <SavedCommandEditor entry={dialog.entry} availableTags={tags} onClose={() => setDialog(null)} onSave={save} />}
    {dialog?.kind === 'delete' && <DeleteSavedCommand entry={dialog.entry} onClose={() => setDialog(null)} onDelete={async () => { unwrap(await window.devcommand.savedCommands.remove({ id: dialog.entry.id, revision: dialog.entry.revision })); await refresh(); setSelected(previous => previous.filter(id => id !== dialog.entry.id)); notify('Command deleted.') }} />}
    {dialog?.kind === 'clear' && <ClearSavedCommands entries={dialog.entries} onClose={() => setDialog(null)} onDelete={async () => {
      try { unwrap(await window.devcommand.savedCommands.clear({ entries: dialog.entries.map(entry => ({ id: entry.id, revision: entry.revision })) })) }
      finally { await refresh() }
      setSelected([]); setTagFilter(null); setSearch(''); setBulkTag(''); setOrderNotice(''); notify('All saved commands deleted.')
    }} />}
    {dialog?.kind === 'rename-tag' && <RenameSavedTag tag={dialog.tag} availableTags={tags} count={entries.filter(entry => entry.tags.includes(dialog.tag)).length} onClose={() => setDialog(null)} onRename={async name => {
      let count: number
      try { count = unwrap(await window.devcommand.savedCommands.renameTag({ from: dialog.tag, to: name })) }
      finally { await refresh() }
      if (tagFilter === dialog.tag) setTagFilter(name)
      if (bulkTag.trim().toLowerCase() === dialog.tag) setBulkTag(name)
      notify(`Tag renamed on ${count} ${count === 1 ? 'command' : 'commands'}.`)
    }} />}
    {dialog?.kind === 'run' && <RunSavedCommand entry={dialog.entry} onClose={() => setDialog(null)} notify={notify} />}
  </section>
}
