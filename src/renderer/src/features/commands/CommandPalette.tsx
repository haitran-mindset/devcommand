import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CornerDownLeft, Search, X } from 'lucide-react'
import type { CommandSummary } from '../../../../shared/commands'
import { Button } from '../../components/ui/button'
import { CommandIcon } from './CommandIcon'

interface CommandPaletteProps {
  query: string
  entries: CommandSummary[]
  loading: boolean
  failed: boolean
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
  onClose: () => void
  onRetry: () => void
}

export function CommandPalette({ query, entries, loading, failed, onQueryChange, onSelect, onClose, onRetry }: CommandPaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const selectedOption = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const titleId = useId()
  const descriptionId = useId()
  const [activeId, setActiveId] = useState('')
  const index = Math.max(0, entries.findIndex((entry) => entry.id === activeId))
  const selected = !loading && !failed ? entries[index] : undefined
  const optionId = (id: string) => `${listId}-${id}`
  useEffect(() => {
    const node = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node.showModal()
    input.current?.focus()
    input.current?.select()
    return () => { node.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => { selectedOption.current?.scrollIntoView({ block: 'nearest' }) }, [selected?.id])
  const changeQuery = (value: string) => { setActiveId(''); onQueryChange(value) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !selected) return
    let next: number
    if (event.key === 'ArrowDown') next = (index + 1) % entries.length
    else if (event.key === 'ArrowUp') next = (index - 1 + entries.length) % entries.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = entries.length - 1
    else if (event.key === 'Enter') { event.preventDefault(); onSelect(selected.id); return }
    else return
    event.preventDefault()
    setActiveId(entries[next].id)
  }
  return <dialog ref={dialog} className="command-palette" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }}>
    <h2 id={titleId} className="sr-only">Command palette</h2>
    <p id={descriptionId} className="sr-only">Search commands and aliases. Use the arrow keys to navigate and Enter to open configuration. Escape closes this dialog.</p>
    <div className="palette-search-bar"><Search aria-hidden="true" /><input ref={input} role="combobox" aria-label="Search command palette" aria-autocomplete="list" aria-controls={listId} aria-expanded="true" aria-activedescendant={selected ? optionId(selected.id) : undefined} maxLength={200} value={query} placeholder="Search commands, tools or aliases…" onChange={(event) => changeQuery(event.target.value)} onKeyDown={onKeyDown} />
      {query && <Button variant="ghost" size="icon-xs" aria-label="Clear search" title="Clear search" onClick={() => { changeQuery(''); input.current?.focus() }}><X aria-hidden="true" /></Button>}
      <button type="button" className="palette-dismiss" aria-label="Close command palette" title="Close command palette" onClick={onClose}><kbd>esc</kbd></button>
    </div>
    <div className="palette-section-heading"><span>{query.trim() ? 'Search results' : 'All commands'}</span><span className="palette-count" role="status">{loading ? 'Searching…' : failed ? 'Unavailable' : `${entries.length} command${entries.length === 1 ? '' : 's'}`}</span></div>
    <div id={listId} className="palette-results" role="listbox" aria-label="Commands" aria-busy={loading}>
      {loading ? <div className="palette-state"><Search aria-hidden="true" /><p>Finding your commands…</p></div> : failed ? <div className="palette-state"><Search aria-hidden="true" /><h3>Unable to load commands</h3><p role="alert">Try loading the command library again.</p><Button variant="outline" size="sm" onClick={onRetry}>Try again</Button></div> : !entries.length ? <div className="palette-state"><Search aria-hidden="true" /><h3>No matching commands</h3><p>Try a tool name or an alias, such as “git remote”.</p><Button variant="ghost" size="sm" onClick={() => { changeQuery(''); input.current?.focus() }}>Clear search</Button></div> : entries.map((entry) => <button key={entry.id} id={optionId(entry.id)} ref={selected?.id === entry.id ? selectedOption : undefined} type="button" role="option" aria-label={entry.title} aria-describedby={`${optionId(entry.id)}-description ${optionId(entry.id)}-meta`} aria-selected={selected?.id === entry.id} tabIndex={-1} className="palette-option" onPointerMove={() => setActiveId(entry.id)} onPointerDown={(event) => event.preventDefault()} onClick={() => onSelect(entry.id)}>
        <span className="palette-command-icon"><CommandIcon id={entry.id} /></span><span className="palette-command-text"><strong>{entry.title}</strong><span id={`${optionId(entry.id)}-description`}>{entry.unavailableReason ?? entry.description}</span></span>
        <span className="palette-command-meta" id={`${optionId(entry.id)}-meta`}><span className="palette-category">{entry.category}</span><span className="palette-risk" data-risk={entry.risk}>{entry.risk}</span></span><CornerDownLeft className="palette-enter-icon" aria-hidden="true" />
      </button>)}
    </div>
    <footer className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd>Navigate</span><span><kbd>↵</kbd>Configure</span><span className="palette-footer-note">Review before running</span></footer>
  </dialog>
}
