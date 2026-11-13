import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, CircleAlert, Info, Trash2, X } from 'lucide-react'
import { Button } from './ui/button'
import { useNotifications } from '../lib/notifications'

const icons = { success: CheckCircle2, error: CircleAlert, warning: AlertTriangle, info: Info }
export function NotificationCenter() {
  const { entries, markAllRead, remove, clear } = useNotifications()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const unread = entries.filter(entry => !entry.read).length
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="notification-center" ref={root} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <Button ref={trigger} variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} title="Notifications" aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen(value => !value)}><Bell />{unread > 0 && <span className="notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</Button>
    {open && <section id="notification-panel" className="notification-panel" aria-label="Notification center"><header><div><h2>Notifications</h2><p>{unread ? `${unread} unread` : 'You’re all caught up'}</p></div><Button variant="ghost" size="icon-sm" aria-label="Mark all notifications read" title="Mark all read" disabled={!unread} onClick={markAllRead}><CheckCheck /></Button><Button variant="ghost" size="icon-sm" aria-label="Clear notifications" title="Clear" disabled={!entries.length} onClick={clear}><Trash2 /></Button><Button variant="ghost" size="icon-sm" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus() }}><X /></Button></header>
      {!entries.length ? <div className="notification-empty"><Bell /><strong>No notifications yet</strong><p>Command results, errors and warnings appear here.</p></div> : <ol className="notification-list">{entries.map(entry => { const Icon = icons[entry.kind]; return <li key={entry.id} className={`notification-item is-${entry.kind}${entry.read ? '' : ' is-unread'}`}><Icon aria-hidden="true" /><div><div className="notification-item-top"><h3><span className="sr-only">{entry.kind}: </span>{entry.title}</h3><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>{entry.message && <p>{entry.message}</p>}</div><Button variant="ghost" size="icon-xs" aria-label={`Dismiss ${entry.title}`} title="Dismiss" onClick={() => remove(entry.id)}><X /></Button></li> })}</ol>}
      <footer>Notifications stay in this app session.</footer>
    </section>}
  </div>
}
