import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DockerAction, SshAction, SshPreview } from '../../../../shared/extended'
import { Button } from '../../components/ui/button'
import { unwrap, useUpdateSettings } from '../../lib/settings'
import { useSession } from '../../lib/session'

export function ExtendedAction({ action, module, onClose }: { action: SshAction | DockerAction; module: 'ssh' | 'docker'; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), client = useQueryClient(), settings = useUpdateSettings()
  const session = useSession()
  const [executionId, setExecutionId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('')
  const preview = useQuery<SshPreview>({ queryKey: ['extended-preview', module, action], queryFn: async () => unwrap(await (module === 'ssh' ? window.devcommand.ssh.preview(action as SshAction) : window.devcommand.docker.preview(action as DockerAction))), retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 })
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), refetchInterval: (query) => executionId && !query.state.data?.find((item) => item.id === executionId)?.finishedAt ? 150 : false })
  const execution = executions.data?.find((item) => item.id === executionId)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { if (execution?.finishedAt) void client.invalidateQueries({ queryKey: [module] }) }, [client, module, execution?.finishedAt])
  const run = async () => {
    if (!preview.data || busy) return
    setBusy(true); setError('')
    try {
      const result = unwrap(await (module === 'ssh' ? window.devcommand.ssh.execute(action as SshAction, preview.data.token) : window.devcommand.docker.execute(action as DockerAction, preview.data.token)))
      if (result.kind === 'terminal') { session.setInserted(result.session); settings.mutate({ terminalVisible: true }); onClose() }
      else if (result.kind === 'config') setDone(result.backupPath ? `Config saved. Backup: ${result.backupPath}` : 'Config saved.')
      else { setExecutionId(result.executionId); await client.invalidateQueries({ queryKey: ['executions'] }) }
      await client.invalidateQueries({ queryKey: [module] })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to perform this action.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="confirmation-dialog git-action-dialog" aria-labelledby="extended-action-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose() }}>
    <h2 id="extended-action-title">Review {action.kind}</h2>
    {preview.isPending && <p>Validating target and current state…</p>}{preview.isError && <p role="alert">{preview.error.message}</p>}
    {preview.data && <>{preview.data.consequences.map((text) => <p key={text}>{text}</p>)}<pre>{preview.data.display}</pre></>}
    {error && <p role="alert" className="terminal-error">{error}</p>}{done && <p role="status">{done}</p>}
    {execution && <section aria-label="Operation result"><p role="status">{execution.status} · Exit code: {execution.exitCode ?? '—'}</p><pre className="execution-output">{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error}</pre>{execution.truncated && <p>Output is limited.</p>}</section>}
    {executions.isError && executionId && <p role="alert">Unable to refresh execution output.</p>}
    <div className="confirmation-actions"><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>{execution?.status === 'running' && <Button variant="outline" onClick={() => { void window.devcommand.commands.cancel(execution.id).then(unwrap).then(() => client.invalidateQueries({ queryKey: ['executions'] })).catch(() => setError('Unable to cancel this operation.')) }}>Cancel execution</Button>}{!executionId && !done && <><Button variant="outline" disabled={busy || preview.isFetching} onClick={() => { setError(''); void preview.refetch() }}>Refresh preview</Button><Button disabled={busy || !preview.data || preview.isError || preview.isFetching || !!error} onClick={() => void run()}>Confirm & Run</Button></>}</div>
    {execution?.status === 'running' && <p>Closing this dialog leaves the operation running. Use Cancel execution to stop it.</p>}
  </dialog>
}
