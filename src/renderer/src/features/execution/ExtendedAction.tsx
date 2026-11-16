import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DockerAction, SshAction, SshPreview } from '../../../../shared/extended'
import { sshAgentLifetimes, sshAgentLifetimeLabels, type SshAgentLifetime } from '../../../../shared/extended'
import { Button } from '../../components/ui/button'
import { SelectField } from '../../components/ui/select-field'
import { conciseCommandDisplay } from '../../../../shared/text'
import { unwrap, useUpdateSettings } from '../../lib/settings'
import { useSession } from '../../lib/session'

export function ExtendedAction({ action, module, onClose }: { action: SshAction | DockerAction; module: 'ssh' | 'docker'; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), client = useQueryClient(), settings = useUpdateSettings()
  const session = useSession()
  const [lifetime, setLifetime] = useState<SshAgentLifetime>(action.kind === 'agent.add' ? (action.lifetimeSeconds ?? 'unlimited') : 'unlimited')
  const [executionId, setExecutionId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('')

  const effectiveAction = useMemo(() => {
    if (action.kind === 'agent.add') {
      return { ...action, lifetimeSeconds: lifetime }
    }
    return action
  }, [action, lifetime])

  const preview = useQuery<SshPreview>({
    queryKey: ['extended-preview', module, effectiveAction],
    queryFn: async () => unwrap(await (module === 'ssh' ? window.devcommand.ssh.preview(effectiveAction as SshAction) : window.devcommand.docker.preview(effectiveAction as DockerAction))),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0
  })
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), refetchInterval: (query) => executionId && !query.state.data?.find((item) => item.id === executionId)?.finishedAt ? 150 : false })
  const execution = executions.data?.find((item) => item.id === executionId)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { if (execution?.finishedAt) void client.invalidateQueries({ queryKey: [module] }) }, [client, module, execution?.finishedAt])
  const run = async () => {
    if (!preview.data || busy) return
    setBusy(true); setError('')
    try {
      const result = unwrap(await (module === 'ssh' ? window.devcommand.ssh.execute(effectiveAction as SshAction, preview.data.token) : window.devcommand.docker.execute(effectiveAction as DockerAction, preview.data.token)))
      if (result.kind === 'terminal') {
        session.setInserted(result.session)
        settings.mutate({ terminalVisible: true })
        onClose()
        setTimeout(() => void client.invalidateQueries({ queryKey: [module] }), 1500)
        setTimeout(() => void client.invalidateQueries({ queryKey: [module] }), 4000)
      }
      else if (result.kind === 'config') setDone(result.backupPath ? `Config saved. Backup: ${result.backupPath}` : 'Config saved.')
      else if (result.kind === 'deleted') onClose()
      else { setExecutionId(result.executionId); await client.invalidateQueries({ queryKey: ['executions'] }) }
      await client.invalidateQueries({ queryKey: [module] })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to perform this action.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="confirmation-dialog git-action-dialog" aria-labelledby="extended-action-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose() }}>
    <h2 id="extended-action-title">
      {effectiveAction.kind === 'agent.add'
        ? `Add ${(effectiveAction as Extract<SshAction, { kind: 'agent.add' }>).publicKeyName.replace(/\.pub$/, '')} to agent`
        : effectiveAction.kind === 'agent.remove'
          ? `Remove ${(effectiveAction as Extract<SshAction, { kind: 'agent.remove' }>).publicKeyName.replace(/\.pub$/, '')} from agent`
          : effectiveAction.kind === 'key.delete'
            ? `Delete ${(effectiveAction as Extract<SshAction, { kind: 'key.delete' }>).publicKeyName.replace(/\.pub$/, '')} SSH key`
            : `Review ${effectiveAction.kind}`}
    </h2>
    {action.kind === 'agent.add' && (
      <div className="extended-field-group">
        <label htmlFor="agent-key-lifetime" className="extended-field-label">
          <span>Lifetime</span>
          <SelectField
            id="agent-key-lifetime"
            label="Key lifetime"
            value={lifetime}
            onValueChange={(val) => setLifetime(val as SshAgentLifetime)}
            options={sshAgentLifetimes.map((value) => ({ value, label: sshAgentLifetimeLabels[value] }))}
            className="w-full"
          />
        </label>
      </div>
    )}
    {preview.isPending && <p>Validating target and current state…</p>}{preview.isError && <p role="alert">{preview.error.message}</p>}
    {preview.data && <>{preview.data.consequences.map((text) => <p key={text}>{text}</p>)}<pre>{conciseCommandDisplay(preview.data.display)}</pre>{conciseCommandDisplay(preview.data.display) !== preview.data.display && <details className="execution-options"><summary>Managed execution options</summary><pre>{preview.data.display}</pre></details>}</>}
    {error && <p role="alert" className="terminal-error">{error}</p>}{done && <p role="status">{done}</p>}
    {execution && <section aria-label="Operation result"><p role="status">{execution.status} · Exit code: {execution.exitCode ?? '—'}</p><pre className="execution-output" data-status={execution.status}>{execution.output.map((chunk) => <span key={chunk.sequence} className={chunk.stream === 'stderr' ? 'output-stderr' : undefined}>{chunk.data}</span>)}{execution.error && <span className="output-error">{execution.error}</span>}</pre>{execution.truncated && <p>Output is limited.</p>}</section>}
    {executions.isError && executionId && <p role="alert">Unable to refresh execution output.</p>}
    <div className="confirmation-actions">
      <Button variant="outline" disabled={busy} onClick={onClose}>Close</Button>
      {execution?.status === 'running' && <Button variant="outline" onClick={() => { void window.devcommand.commands.cancel(execution.id).then(unwrap).then(() => client.invalidateQueries({ queryKey: ['executions'] })).catch(() => setError('Unable to cancel this operation.')) }}>Cancel execution</Button>}
      {!executionId && !done && (
        <Button
          variant={effectiveAction.kind === 'key.delete' ? 'destructive' : 'default'}
          disabled={busy || !preview.data || preview.isError || preview.isFetching || !!error}
          onClick={() => void run()}
        >
          {effectiveAction.kind === 'key.delete'
            ? 'Confirm & Delete'
            : effectiveAction.kind === 'agent.remove'
              ? 'Remove from agent'
              : 'Confirm & Run'}
        </Button>
      )}
    </div>
    {execution?.status === 'running' && <p>Closing this dialog leaves the operation running. Use Cancel execution to stop it.</p>}
  </dialog>
}
