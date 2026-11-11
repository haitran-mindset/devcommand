import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { unwrap } from './settings'
export function useWorkspaces() {
  return useQuery({ queryKey: ['workspaces'], queryFn: async () => unwrap(await window.devcommand.workspace.list()) })
}
export function useRepository(id: string | null | undefined) {
  return useQuery({ queryKey: ['repository', id], queryFn: async () => unwrap(await window.devcommand.workspace.status(id!)), enabled: !!id, retry: false, refetchInterval: 5000, refetchOnWindowFocus: true })
}
export function useExecutionRefresh() {
  const client = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = window.devcommand.commands.onExecutionEvent((event) => {
      if (event.type === 'status' && event.status !== 'running') {
        clearTimeout(timer)
        timer = setTimeout(() => {
          void client.invalidateQueries({ queryKey: ['repository'] })
          void client.invalidateQueries({ queryKey: ['git'] })
          void client.invalidateQueries({ queryKey: ['git-diff'] })
          void client.invalidateQueries({ queryKey: ['history'] })
          void client.invalidateQueries({ queryKey: ['executions'] })
          void client.invalidateQueries({ queryKey: ['preview'] })
        }, 60)
      }
    })
    const changed = window.devcommand.git.onChanged((workspaceId) => {
      void client.invalidateQueries({ queryKey: ['git', workspaceId] })
      void client.invalidateQueries({ queryKey: ['git-diff', workspaceId] })
      void client.invalidateQueries({ queryKey: ['repository', workspaceId] })
    })
    return () => { clearTimeout(timer); unsubscribe(); changed() }
  }, [client])
}
