import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Clock3, SquareTerminal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { unwrap } from '../../lib/settings'

export function RunningTasks() {
  const navigate = useNavigate()
  const executions = useQuery({ queryKey: ['executions'], queryFn: async () => unwrap(await window.devcommand.commands.listExecutions()), refetchInterval: (query) => query.state.data?.some((entry) => entry.status === 'running') ? 500 : false })
  const tasks = [...(executions.data ?? [])].reverse().slice(0, 3)
  return <section className="panel running-tasks" aria-label="Running tasks"><div className="tasks-heading"><h2>Running Tasks</h2><button onClick={() => navigate('/shell')}>View all</button></div>
    {executions.isPending && <p>Loading tasks…</p>}{executions.isError && <p role="alert">Unable to load running tasks.</p>}
    {!executions.isPending && !executions.isError && tasks.length === 0 && <div className="tasks-empty"><SquareTerminal /><strong>Ready when you are</strong><p>Run a command to follow its progress here.</p></div>}
    {tasks.map((task) => <button className="task-row" key={task.id} onClick={() => navigate('/shell')} title={task.preview}><span className={`task-icon status-${task.status}`}>{task.status === 'succeeded' ? <CheckCircle2 /> : task.status === 'running' ? <Clock3 /> : <CircleAlert />}</span><span><strong>{task.commandId.replaceAll('.', ' ')}</strong><small>{task.finishedAt ? `${task.status} in ${Math.max(0, Date.parse(task.finishedAt) - Date.parse(task.startedAt))} ms` : 'Running…'}</small></span><SquareTerminal /></button>)}
  </section>
}
