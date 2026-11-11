import { SelectField } from '../../components/ui/select-field'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock, FileTerminal, RotateCcw, ShieldCheck, Terminal, Trash2, X, XCircle } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { unwrap } from '../../lib/settings'
import { useSession } from '../../lib/session'
import { conciseCommandDisplay } from '../../../../shared/text'

export function HistoryPage() {
  const history = useQuery({ queryKey: ['history'], queryFn: async () => unwrap(await window.devcommand.library.history()) })
  const client = useQueryClient()
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState('')
  const clearHistory = async () => {
    if (clearing) return
    setClearing(true); setError(''); setMessage('')
    try {
      if (typeof window.devcommand.library.clearHistory !== 'function') throw new Error('Restart DevCommand to enable clearing history.')
      unwrap(await window.devcommand.library.clearHistory())
      await client.invalidateQueries({ queryKey: ['history'] })
      setMessage('History cleared.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to clear history.') }
    finally { setClearing(false) }
  }
  const [status, setStatus] = useState('all')
  const navigate = useNavigate()
  const { select, setDraft } = useSession()
  const review = async (request: import('../../../../shared/commands').CommandRequest) => {
    setError('')
    try {
      if (request.workspaceId) { unwrap(await window.devcommand.workspace.select(request.workspaceId)); await client.invalidateQueries({ queryKey: ['workspaces'] }) }
      select(request.commandId); setDraft(request); navigate('/commands')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Repository is unavailable.') }
  }
  const entries = history.data ?? []
  const filtered = entries.filter((entry) => status === 'all' || entry.execution.status === status)
  return <section className="panel history-page">
    <header className="history-header"><span className="history-heading-icon"><Clock /></span><div><h1>Execution History</h1><p>Review your recent commands and pick up where you left off.</p></div><Button variant="outline" size="sm" className="history-clear" disabled={clearing || !entries.length} onClick={() => void clearHistory()}><Trash2 />{clearing ? 'Clearing…' : 'Clear history'}</Button></header>
    <div className="history-toolbar"><div className="history-list-label"><FileTerminal /><strong>Recent runs</strong><span>{entries.length}</span></div><label className="history-status-filter">Status<SelectField label="Status" value={status} onValueChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'running', label: 'Running' }, { value: 'succeeded', label: 'Succeeded' }, { value: 'failed', label: 'Failed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'timed-out', label: 'Timed out' }]} /></label></div>
    {message && <div role="status" className="history-feedback"><CheckCircle2 /><span>{message}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss history notification" onClick={() => setMessage('')}><X /></Button></div>}
    {(error || history.isError) && <div role="alert" className="history-feedback history-error"><XCircle /><span>{error || 'Unable to load saved history.'}</span>{history.isError && <Button variant="ghost" size="sm" onClick={() => void history.refetch()}>Retry</Button>}</div>}
    {history.isPending && <div className="history-empty" role="status"><Clock /><p>Loading saved history…</p></div>}
    {!history.isPending && !history.isError && !filtered.length && <div className="history-empty"><div className="history-empty-symbol"><Terminal /><span><Clock /></span></div><h2>{entries.length ? 'No runs with this status.' : 'No managed executions yet.'}</h2><p>{entries.length ? 'Choose another status to see more of your recent activity.' : 'Commands you run from the app appear here, ready to review or run again.'}</p>{entries.length ? <Button size="sm" variant="outline" onClick={() => setStatus('all')}>Show all statuses</Button> : <Button size="sm" variant="outline" onClick={() => navigate('/commands')}>Browse commands<ArrowRight /></Button>}</div>}
    {!!filtered.length && <div className="execution-list history-entries">{filtered.map(({ request, execution, rerunnable }) => {
      const StatusIcon = execution.status === 'succeeded' ? CheckCircle2 : execution.status === 'running' ? Clock : XCircle
      return <article className="execution-card history-entry" key={execution.id}>
        <div className="history-entry-main"><span className={`history-run-icon status-${execution.status}`}><StatusIcon /></span><div className="history-entry-description"><code title={execution.preview}>{conciseCommandDisplay(execution.preview)}</code><div className="history-entry-meta"><time dateTime={execution.startedAt}>{new Date(execution.startedAt).toLocaleString()}</time><span>Exit code: {execution.exitCode ?? '—'}</span>{execution.truncated && <span>Output limited</span>}</div></div><span className={`execution-status status-${execution.status}`}>{execution.status}</span><Button variant="outline" size="sm" onClick={() => void review(request)}><RotateCcw />{rerunnable ? 'Review & rerun' : 'Re-enter parameters'}</Button></div>
        <details className="history-output"><summary>View output</summary><pre className="execution-output">{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error}{!execution.output.length && !execution.error && 'This command produced no output.'}</pre></details>
      </article>
    })}</div>}
    <footer className="history-privacy"><ShieldCheck /><span>Latest 100 runs saved locally. Interactive terminal sessions stay private.</span></footer>
  </section>
}
