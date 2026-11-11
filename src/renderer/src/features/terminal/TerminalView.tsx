import { copyText } from '../../lib/clipboard'
import { textChunks } from '../../../../shared/text'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalSession } from '../../../../shared/runtime'
import { unwrap } from '../../lib/settings'
import '@xterm/xterm/css/xterm.css'

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!host.current) return
    let disposed = false
    let running = true
    let writing = Promise.resolve()
    let queued = 0
    let frame = 0
    const terminal = new Terminal({
      cursorBlink: true, fontFamily: 'SFMono-Regular, Consolas, monospace', fontSize: 12,
      scrollback: 3000, allowProposedApi: false, screenReaderMode: true, convertEol: false
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    instance.current = { terminal, fit }
    const theme = () => {
      const style = getComputedStyle(document.documentElement)
      terminal.options.theme = {
        background: style.getPropertyValue('--code').trim(), foreground: style.getPropertyValue('--foreground').trim(),
        cursor: style.getPropertyValue('--purple').trim(), selectionBackground: '#8865ce66'
      }
    }
    theme()
    const observer = new MutationObserver(theme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const onData = window.devcommand.terminal.onData((event) => {
      if (event.sessionId !== session.id || disposed) return
      terminal.write(event.data, () => {
        if (!disposed) void window.devcommand.terminal.acknowledge(session.id, event.sequence).catch(() => {})
      })
    })
    const onExit = window.devcommand.terminal.onExit((event) => {
      if (event.sessionId !== session.id || disposed) return
      running = false
      terminal.options.disableStdin = true
      terminal.write(`\r\n[Session exited · code ${event.exitCode}]\r\n`)
    })
    const input = terminal.onData((data) => {
      if (queued + data.length > 65536) { setError('Input is too large. Paste smaller blocks (maximum 64 KiB pending).'); return }
      queued += data.length
      writing = writing.then(async () => {
        try {
          if (disposed) return
          for (const chunk of textChunks(data, 16384)) unwrap(await window.devcommand.terminal.write(session.id, chunk))
        } catch { if (!disposed) setError('Unable to write to this session. Close the tab and open a new terminal.') }
        finally { queued -= data.length }
      })
    })
    // Preserve shell control keys; app shortcuts are ignored while terminal input owns focus.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === 'c') {
        if (terminal.hasSelection()) { void copyText(terminal.getSelection()).catch(() => setError('Unable to copy selection.')); return false }
      }
      return true
    })
    const fitTerminal = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (disposed || !running || !host.current?.offsetWidth || !host.current.offsetHeight) return
        fit.fit()
        void window.devcommand.terminal.resize(session.id, Math.min(500, terminal.cols), Math.min(200, terminal.rows))
          .then((result) => { if (!result.ok && !disposed) setError('Session is no longer running. Close this tab and open another.') })
          .catch(() => { if (!disposed) setError('Unable to resize terminal.') })
      })
    }
    const resize = new ResizeObserver(fitTerminal)
    resize.observe(host.current)
    fitTerminal()
    return () => {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect()
      onData(); onExit(); input.dispose(); instance.current = null; terminal.dispose()
    }
  }, [session.id])
  useEffect(() => {
    if (!active || !instance.current) return
    const { terminal, fit } = instance.current
    const frame = requestAnimationFrame(() => { fit.fit(); terminal.focus() })
    return () => cancelAnimationFrame(frame)
  }, [active])
  return <div className="terminal-view" id={`terminal-panel-${session.id}`} aria-labelledby={`terminal-tab-${session.id}`} hidden={!active} role="tabpanel" aria-label={`${session.shell} terminal`}>
    <div ref={host} className="xterm-host" />
    {error && <p className="terminal-error" role="alert">{error}</p>}
  </div>
}
