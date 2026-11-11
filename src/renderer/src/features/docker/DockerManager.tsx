import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box } from 'lucide-react'
import type { DockerAction } from '../../../../shared/extended'
import { Button } from '../../components/ui/button'
import { unwrap } from '../../lib/settings'
import { useWorkspaces } from '../../lib/workspace'
import { ExtendedAction } from '../execution/ExtendedAction'

export function DockerManager() {
  const snapshot = useQuery({ queryKey: ['docker'], queryFn: async () => unwrap(await window.devcommand.docker.snapshot()), retry: false })
  const [action, setAction] = useState<DockerAction | null>(null), workspaces = useWorkspaces()
  const data = snapshot.data
  const button = (kind: DockerAction['kind'], target: string, label: string) => <Button key={kind} size="sm" variant="outline" onClick={() => setAction({ kind, target })}>{label}</Button>
  return <section className="panel extended-manager"><div className="page-heading"><Box /><div><h1>Docker Manager</h1><p>Local engine overview and controlled operations</p></div><Button variant="outline" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>Refresh Docker</Button></div>
    {snapshot.isPending && <p>Checking Docker CLI and daemon…</p>}{snapshot.isError && <p role="alert">{snapshot.error.message}</p>}{data && !data.daemonAvailable && <div role="status"><h2>{data.cliAvailable ? 'Docker daemon unavailable' : 'Docker CLI unavailable'}</h2><p>{data.reason}</p></div>}
    {data?.daemonAvailable && <><p>Context: {data.context} · Engine {data.version}</p><p className="preview-cwd">{data.endpoint} · {data.daemonId}</p><h2>Containers</h2>{data.containers.length === 0 && <p>No containers.</p>}{data.containers.map((entry) => <article className="extended-row" key={entry.id}><div><strong>{entry.name}</strong><small>{entry.image} · {entry.state} · {entry.status}</small><small>{entry.ports}</small></div>{entry.state === 'running' ? <>{button('container.stop', entry.id, 'Stop')}{button('container.restart', entry.id, 'Restart')}</> : button('container.start', entry.id, 'Start')}{button('container.logs', entry.id, 'Logs')}{button('container.follow', entry.id, 'Follow logs')}{entry.state !== 'running' && button('container.remove', entry.id, 'Remove container')}</article>)}
      <h2>Images</h2>{data.images.length === 0 && <p>No images.</p>}{data.images.map((entry, index) => <article className="extended-row" key={`${entry.id}:${index}`}><div><strong>{entry.repository}:{entry.tag}</strong><small>{entry.id} · {entry.size}</small></div>{button('image.remove', entry.id, 'Remove image')}</article>)}
      <h2>Volumes</h2>{data.volumes.length === 0 && <p>No volumes.</p>}{data.volumes.map((entry) => <article className="extended-row" key={entry.name}><div><strong>{entry.name}</strong><small>{entry.driver}</small></div>{button('volume.remove', entry.name, 'Delete volume data')}</article>)}
      <h2>Networks</h2>{data.networks.length === 0 && <p>No networks.</p>}{data.networks.map((entry) => <article className="extended-row" key={entry.id}><div><strong>{entry.name}</strong><small>{entry.driver}</small></div>{!['bridge', 'host', 'none'].includes(entry.name) && button('network.remove', entry.id, 'Remove network')}</article>)}
      <h2>Compose</h2><p>Selected workspace: {workspaces.data?.entries.find((entry) => entry.id === workspaces.data.selectedId)?.rootPath ?? 'None'}</p><p>Review trusted repository configuration before starting services. Builds and image pulls are disabled.</p><div className="welcome-actions">{(['compose.up', 'compose.down'] as const).map((kind) => <Button key={kind} variant="outline" disabled={!workspaces.data?.selectedId} onClick={() => setAction({ kind, target: 'workspace', workspaceId: workspaces.data!.selectedId! })}>Review {kind}</Button>)}</div>
    </>}{action && <ExtendedAction module="docker" action={action} onClose={() => setAction(null)} />}
  </section>
}
