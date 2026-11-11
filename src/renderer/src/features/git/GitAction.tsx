import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommandRequest } from '../../../../shared/commands'
import { Button } from '../../components/ui/button'
import { unwrap } from '../../lib/settings'

export function GitAction({ request, title, onClose }: { request: CommandRequest; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [executionId, setExecutionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const preview = useQuery({ queryKey: ['git-action-preview', request], queryFn: async () => unwrap(await window.devcommand.library.preview(request)), retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 })
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), refetchInterval: (query) => executionId && !query.state.data?.some((entry) => entry.id === executionId && entry.finishedAt) ? 150 : false })
  const execution = executions.data?.find((entry) => entry.id === executionId)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    if (!execution?.finishedAt) return
    void client.invalidateQueries({ queryKey: ['git', request.workspaceId] })
    void client.invalidateQueries({ queryKey: ['repository', request.workspaceId] })
    void client.invalidateQueries({ queryKey: ['history'] })
  }, [execution?.finishedAt, client, request.workspaceId])
  const run = async () => {
    if (!preview.data || busy) return
    setBusy(true); setError('')
    try {
      const result = unwrap(await window.devcommand.library.execute(request, preview.data.confirmationToken))
      setExecutionId(result.executionId)
      await client.invalidateQueries({ queryKey: ['executions'] })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to execute this operation.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="confirmation-dialog git-action-dialog" aria-labelledby="git-action-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose() }}><h2 id="git-action-title">{execution ? title : `Confirm ${title}`}</h2>
    {preview.isPending && <p>Validating repository state and parameters…</p>}
    {preview.isError && <p className="terminal-error" role="alert">{preview.error.message}</p>}
    {preview.data && <><p className="confirmation-target">Target directory: {preview.data.cwd}</p>{preview.data.consequences.map((text) => <p key={text}>{text}</p>)}<pre>{preview.data.display}</pre></>}
    {error && <p className="terminal-error" role="alert">{error}</p>}
    {execution && <section aria-label="Git operation result"><p role="status">{execution.status} · Exit code: {execution.exitCode ?? '—'}{execution.finishedAt && ` · ${Math.max(0, Date.parse(execution.finishedAt) - Date.parse(execution.startedAt))} ms`}</p><pre className="execution-output">{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error}</pre>{execution.truncated && <p>Output is limited.</p>}</section>}
    {executions.isError && executionId && <p role="alert" className="terminal-error">Unable to refresh execution output. View History to check its final status.</p>}
    <div className="confirmation-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>{execution?.status === 'running' && <Button variant="outline" onClick={() => { void window.devcommand.commands.cancel(execution.id).then((result) => { unwrap(result); return client.invalidateQueries({ queryKey: ['executions'] }) }).catch(() => setError('Unable to cancel this operation.')) }}>Cancel execution</Button>}{!executionId && <><Button variant="outline" disabled={busy || preview.isFetching} onClick={() => { setError(''); void preview.refetch() }}>Refresh preview</Button><Button disabled={busy || !preview.data || preview.isFetching || preview.isError || !!error} onClick={() => void run()}>Confirm & Run</Button></>}</div>
    {execution?.status === 'running' && <p>Closing this dialog leaves the operation running. Use Cancel execution to stop it.</p>}
  </dialog>
}
