import { shellChecks, type ShellCheckId } from '../../../../shared/runtime'
import { conciseCommandDisplay } from '../../../../shared/text'
import { SelectField } from '../../components/ui/select-field'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Terminal, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { unwrap } from '../../lib/settings'

export function ManagedPanel() {
  const client = useQueryClient()
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), retry: false })
  const [commandId, setCommandId] = useState<ShellCheckId>('git.version')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = window.devcommand.commands.onExecutionEvent(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void client.invalidateQueries({ queryKey: ['executions'] }) }, 60)
    })
    return () => { mounted.current = false; unsubscribe(); clearTimeout(timer) }
  }, [client])
  const execute = async () => {
    setBusy(true); setError(''); setMessage('')
    try { unwrap(await window.devcommand.commands.execute({ commandId })); await client.invalidateQueries({ queryKey: ['executions'] }) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Unable to start this managed command. Try again.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const clearHistory = async () => {
    setClearing(true); setError(''); setMessage('')
    try {
      const count = unwrap(await window.devcommand.commands.clearFinished())
      await client.invalidateQueries({ queryKey: ['executions'] })
      if (mounted.current) setMessage(`Cleared ${count} finished run${count === 1 ? '' : 's'}.`)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Unable to clear finished runs.') }
    finally { if (mounted.current) setClearing(false) }
  }
  return <section className="panel managed-page"><div className="page-heading"><Terminal /><div><h1>Process Core</h1><p>Run a read-only CLI check and inspect streamed output.</p></div></div>
    <div className="managed-controls"><label htmlFor="managed-command">Managed command</label><SelectField id="managed-command" label="Managed command" value={commandId} disabled={busy || clearing} onValueChange={(value) => { const check = shellChecks.find((check) => check.id === value); if (check) { setCommandId(check.id); setError('') } }} options={shellChecks.map((check) => ({ value: check.id, label: check.command }))} /><Button disabled={busy || clearing} onClick={() => void execute()}><Play />Run check</Button><Button variant="outline" size="sm" disabled={busy || clearing || !executions.data?.some((execution) => !!execution.finishedAt)} title="Clear finished runs from this session. Running processes and saved Execution History are kept." onClick={() => void clearHistory()}><Trash2 />{clearing ? 'Clearing…' : 'Clear'}</Button></div>
    <p className="managed-note">{shellChecks.find((check) => check.id === commandId)?.description} Checks run from your home directory. Recent managed runs appear below.</p>
    {message && <p className="managed-note" role="status">{message}</p>}
    {(error || executions.isError) && <div role="alert" className="terminal-error">{error || 'Unable to load executions.'}<Button variant="outline" onClick={() => void executions.refetch()}>Retry</Button></div>}
    {executions.isPending && <p>Loading local executions…</p>}
    {executions.data?.length === 0 && <div className="managed-empty"><Terminal /><p>No recent runs to display.</p></div>}
    <div className="execution-list">{executions.data?.slice().reverse().map((execution) => <article className="execution-card" key={execution.id} aria-label={`Execution ${conciseCommandDisplay(execution.preview)}`}>
      <div className="execution-heading"><code>{conciseCommandDisplay(execution.preview)}</code><span className={`execution-status status-${execution.status}`}>{execution.status}</span>{execution.status === 'running' && <Button variant="outline" size="sm" aria-label={`Cancel ${conciseCommandDisplay(execution.preview)}`} onClick={() => { void window.devcommand.commands.cancel(execution.id).then((result) => { unwrap(result); return client.invalidateQueries({ queryKey: ['executions'] }) }).catch(() => setError('Unable to cancel execution.')) }}><Square />Cancel</Button>}</div>
      <div className="execution-meta">Exit code: {execution.exitCode ?? '—'} · {execution.finishedAt ? `${Math.max(0, Date.parse(execution.finishedAt) - Date.parse(execution.startedAt))} ms` : 'Running…'}{execution.signal && ` · ${execution.signal}`}</div>
      {execution.truncated && <p className="managed-note">Output was limited; only the most recent output is shown.</p>}
      <pre className="execution-output" data-status={execution.status} aria-label="Managed execution output">{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error && <span className="output-error">{execution.error}</span>}</pre>
    </article>)}</div>
  </section>
}
