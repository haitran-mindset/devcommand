import { useId, type RefObject } from 'react'
import { CornerDownLeft, Folder, Keyboard, Search, SquareTerminal, X } from 'lucide-react'
import { Button } from './ui/button'

const shortcuts = [
  { title: 'Command palette', description: 'Search commands and aliases', icon: Search, key: 'K' },
  { title: 'Repositories', description: 'Browse your local projects', icon: Folder, key: 'P' },
  { title: 'Toggle terminal', description: 'Show or hide the terminal dock', icon: SquareTerminal, key: 'J' },
  { title: 'Review command', description: 'Run or confirm the configured command', icon: CornerDownLeft, key: 'Enter' }
]

export function KeyboardShortcuts({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const titleId = useId(), descriptionId = useId()
  const mac = navigator.platform.includes('Mac')
  const modifier = mac ? '⌘' : 'Ctrl'
  const modifierName = mac ? 'Command' : 'Control'
  const platform = mac ? 'macOS' : navigator.platform.includes('Win') ? 'Windows' : 'Linux'
  return <dialog ref={dialogRef} className="shortcuts-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={(event) => {
    if (event.metaKey || event.ctrlKey) {
      event.stopPropagation()
      if (event.key === 'Enter') event.preventDefault()
    }
  }} onClick={(event) => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close()
  }}>
    <header className="shortcuts-header"><span className="shortcuts-heading-icon"><Keyboard aria-hidden="true" /></span><div><h2 id={titleId}>Keyboard shortcuts</h2><p id={descriptionId}>Quick access to your workspace.</p></div><Button variant="ghost" size="icon-xs" className="shortcuts-close" aria-label="Close" title="Close keyboard shortcuts" onClick={() => dialogRef.current?.close()}><X aria-hidden="true" /></Button></header>
    <ul className="shortcuts-list">{shortcuts.map(({ title, description, icon: Icon, key }) => <li className="shortcuts-item" key={key}>
      <span className="shortcuts-item-icon"><Icon aria-hidden="true" /></span><div className="shortcuts-item-text"><strong>{title}</strong><span>{description}</span></div>
      <span className="shortcuts-keys" role="group" aria-label={`${modifierName} + ${key}`}><kbd aria-hidden="true">{modifier}</kbd><span aria-hidden="true">+</span><kbd aria-hidden="true">{key}</kbd></span>
    </li>)}</ul>
    <footer className="shortcuts-footer"><span><kbd>esc</kbd>to close</span><span>{platform} shortcuts</span></footer>
  </dialog>
}
