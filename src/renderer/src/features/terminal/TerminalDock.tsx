import { SelectField } from '../../components/ui/select-field'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Keyboard, Maximize2, Plus, OctagonX, Terminal, X } from 'lucide-react'
import type { TerminalSession } from '../../../../shared/runtime'
import { useSession } from '../../lib/session'
import { unwrap } from '../../lib/settings'
import { Button } from '../../components/ui/button'
import { TerminalView } from './TerminalView'

export function TerminalDock({ height, visible, saveHeight, hide }: { height: number; visible: boolean; saveHeight: (height: number) => void; hide: () => void }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeId, setActiveId] = useState('')
  const [shellId, setShellId] = useState('')
  const [busy, setBusy] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const [error, setError] = useState('')
  const [localHeight, setLocalHeight] = useState<number | null>(null)
  const drag = useRef<{ y: number; height: number } | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const environment = useQuery({ queryKey: ['terminal-environment'], queryFn: async () => unwrap(await window.devcommand.terminal.environment()), retry: false })
  const value = localHeight ?? height
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      tabsRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, visible])
  useEffect(() => useSession.subscribe((state) => {
    const inserted = state.inserted
    if (!inserted) return
    setSessions((current) => current.some((entry) => entry.id === inserted.id) ? current : [...current, inserted]); setActiveId(inserted.id); state.setInserted(null)
  }), [])
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.devcommand.terminal.onExit((event) => {
      setSessions((current) => current.map((session) => session.id === event.sessionId ? { ...session, status: 'exited', exitCode: event.exitCode } : session))
    })
    return () => { mounted.current = false; unsubscribe() }
  }, [])
  const create = async () => {
    if (!environment.data || busy || closingAll) return
    setBusy(true); setError('')
    try {
      const session = unwrap(await window.devcommand.terminal.create({ shellId: shellId || environment.data.defaultShellId, cols: 100, rows: 24 }))
      if (!mounted.current) { await window.devcommand.terminal.close(session.id); return }
      setSessions((current) => [...current, session]); setActiveId(session.id)
    } catch { if (mounted.current) setError('Unable to start a shell. Check the installed shell, available sessions and local permissions.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const closeSession = async (id: string) => {
    setError('')
    try {
      unwrap(await window.devcommand.terminal.close(id))
      if (!mounted.current) return
      setSessions((current) => current.filter((session) => session.id !== id))
      setActiveId((current) => current === id ? sessions.find((session) => session.id !== id)?.id ?? '' : current)
    } catch { if (mounted.current) setError('Unable to close terminal session. Try again.') }
  }
  const closeAllSessions = async () => {
    if (closingAll || !sessions.length) return
    setClosingAll(true); setError('')
    const targets = sessions.map((session) => session.id)
    try {
      const results = await Promise.allSettled(targets.map(async (id) => unwrap(await window.devcommand.terminal.close(id))))
      if (!mounted.current) return
      const closed = new Set(targets.filter((_, index) => results[index].status === 'fulfilled'))
      setSessions((current) => current.filter((session) => !closed.has(session.id)))
      setActiveId((current) => closed.has(current) ? sessions.find((session) => !closed.has(session.id))?.id ?? '' : current)
      if (closed.size !== targets.length) setError('Some terminal sessions could not be closed. Try again.')
    } finally { if (mounted.current) setClosingAll(false) }
  }

  const active = sessions.find((session) => session.id === activeId)
  return <section className="panel terminal-dock live-terminal" style={{ height: value }} hidden={!visible} aria-label="Integrated terminal">
    <div className="resize-handle" role="separator" aria-label="Resize terminal dock" aria-orientation="horizontal" aria-valuenow={value} aria-valuemin={140} aria-valuemax={440} tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); saveHeight(Math.min(440, Math.max(140, height + (event.key === 'ArrowUp' ? 20 : -20)))) }
    }} onPointerDown={(event) => { drag.current = { y: event.clientY, height: value }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { if (drag.current) setLocalHeight(Math.round(Math.min(440, Math.max(140, drag.current.height + drag.current.y - event.clientY)))) }} onPointerUp={() => { if (drag.current) { saveHeight(value); setLocalHeight(null); drag.current = null } }} onPointerCancel={() => { drag.current = null; setLocalHeight(null) }} />
    <div className="terminal-header">{sessions.length > 0 && <div className="terminal-tabbar"><div ref={tabsRef} className="terminal-tabs" role="tablist" aria-label="Terminal sessions">{sessions.map((session, index) => <div className="terminal-tab" key={session.id}><button role="tab" id={`terminal-tab-${session.id}`} aria-controls={`terminal-panel-${session.id}`} tabIndex={activeId === session.id ? 0 : -1} aria-selected={activeId === session.id} aria-label={`${session.shell} ${index + 1}${session.status === 'exited' ? ' exited' : ''}`} onClick={() => setActiveId(session.id)} onKeyDown={(event) => {
      let next: number | undefined
      if (event.key === 'ArrowRight') next = (index + 1) % sessions.length
      if (event.key === 'ArrowLeft') next = (index + sessions.length - 1) % sessions.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = sessions.length - 1
      if (next !== undefined) { event.preventDefault(); setActiveId(sessions[next].id); document.getElementById(`terminal-tab-${sessions[next].id}`)?.focus() }
    }}><Terminal />Terminal {index + 1}{session.status === 'exited' && <span> · exited</span>}</button><Button variant="ghost" size="icon" aria-label={`Close terminal ${index + 1}`} disabled={closingAll} onClick={() => void closeSession(session.id)}><X /></Button></div>)}</div>{sessions.length > 1 && <div className="terminal-tab-navigation"><Button variant="ghost" size="icon" aria-label="Scroll terminal tabs left" title="Scroll tabs left" onClick={() => tabsRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}><ChevronLeft /></Button><Button variant="ghost" size="icon" aria-label="Scroll terminal tabs right" title="Scroll tabs right" onClick={() => tabsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}><ChevronRight /></Button></div>}</div>}<div className="terminal-toolbar">{sessions.length === 0 && <div className="terminal-heading"><Terminal /><h2>Terminal</h2></div>}<span className="terminal-cwd" title={active?.cwd ?? environment.data?.cwd}>{active?.cwd ?? environment.data?.cwd}</span>
      {environment.data && <SelectField label="Terminal shell" value={shellId || environment.data.defaultShellId} onValueChange={setShellId} options={environment.data.shells.map((shell) => ({ value: shell.id, label: shell.label }))} size="sm" />}
      <Button variant="ghost" size="icon" aria-label="New terminal" title="New terminal" disabled={busy || closingAll || !environment.data || sessions.length >= 8} onClick={() => void create()}><Plus /></Button>
      <Button variant="ghost" size="icon" aria-label="Interrupt active terminal" title="Send Ctrl+C" disabled={active?.status !== 'running'} onClick={() => { if (active) void window.devcommand.terminal.write(active.id, '\x03').then((result) => { if (!result.ok) setError('Unable to interrupt this session.') }).catch(() => setError('Unable to interrupt this session.')) }}><Keyboard /></Button>
      <Button variant="ghost" size="icon" aria-label="Close all terminal sessions" title="Stop processes and close all terminal tabs" disabled={!sessions.length || closingAll} onClick={() => void closeAllSessions()}><OctagonX /></Button>
      <Button variant="ghost" size="icon" aria-label="Toggle terminal dock size" onClick={() => saveHeight(height === 440 ? 200 : 440)}><Maximize2 /></Button>
      <Button variant="ghost" size="icon" aria-label="Hide terminal dock" onClick={hide}><X /></Button>
    </div></div>

    {sessions.length === 0 && <div className="terminal-empty"><Terminal /><div><p>{environment.isPending ? 'Detecting local shells…' : 'Your terminal, right where you need it.'}</p><span>Open a shell to get started. Input and output stay in this session.</span></div><Button variant="outline" size="sm" disabled={busy || closingAll || !environment.data} onClick={() => void create()}>Open terminal</Button>{environment.isError && <Button variant="outline" onClick={() => void environment.refetch()}>Retry shell detection</Button>}</div>}
    <div className="terminal-views" hidden={sessions.length === 0}>{sessions.map((session) => <TerminalView key={session.id} session={session} active={session.id === activeId && visible} />)}</div>
    {(error || environment.isError) && <p className="terminal-error" role="alert">{error || 'Unable to detect a supported installed shell.'}</p>}
  </section>
}
