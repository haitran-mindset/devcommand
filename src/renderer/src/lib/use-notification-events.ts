import { useEffect } from 'react'
import { useNotifications } from './notifications'

/** Observe completion, never output: stderr also contains successful Git diagnostics. */
export function useNotificationEvents() {
  useEffect(() => {
    let active = true
    const seen = new Set<string>()
    const unsubscribe = window.devcommand.commands.onExecutionEvent(event => {
      if (event.type !== 'status' || event.status === 'running' || seen.has(event.executionId)) return
      seen.add(event.executionId)
      if (seen.size > 200) seen.delete(seen.values().next().value!)
      const kind = event.status === 'succeeded' ? 'success' : event.status === 'failed' ? 'error' : 'warning'
      const title = { succeeded: 'Command completed', failed: 'Command failed', cancelled: 'Command cancelled', 'timed-out': 'Command timed out' }[event.status]
      void window.devcommand.commands.listExecutions().then(result => {
        if (!active) return
        const execution = result.ok ? result.data.find(entry => entry.id === event.executionId) : undefined
        useNotifications.getState().add(kind, title, execution ? `${execution.commandId}${execution.exitCode === null ? '' : ` · Exit ${execution.exitCode}`}` : '')
      }).catch(() => { if (active) useNotifications.getState().add(kind, title) })
    })
    const history = window.devcommand.library.onHistoryError(message => useNotifications.getState().add('warning', 'History could not be saved', message))
    return () => { active = false; unsubscribe(); history() }
  }, [])
}
