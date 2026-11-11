import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiResult, AppSettings, AppSettingsPatch } from '../../../shared/contracts'

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: async () => {
    if (!window.devcommand) throw new Error('Open DevCommand in the desktop application to load local settings.')
    return unwrap(await window.devcommand.settings.get())
  }, retry: false })
}
export function useUpdateSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['settings:update'], scope: { id: 'settings' },
    mutationFn: async (patch: AppSettingsPatch) => unwrap(await window.devcommand.settings.update(patch)),
    onSuccess: (data: AppSettings) => client.setQueryData(['settings'], data)
  })
}
