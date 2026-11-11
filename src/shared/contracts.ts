import { z } from 'zod'
import type { GitAPI } from './git'
import type { WorkspaceAPI } from './commands'
import type { RuntimeAPI } from './runtime'
import type { ExtendedAPI } from './extended'

export const routes = ['dashboard', 'git', 'commands', 'git-config', 'git-remote', 'ssh', 'docker', 'shell', 'my-commands', 'workflows', 'history', 'workspaces', 'settings'] as const
export const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  route: z.enum(routes),
  sidebarCollapsed: z.boolean(),
  terminalVisible: z.boolean(),
  terminalHeight: z.number().int().min(140).max(440)
}).strict()
export const settingsPatchSchema = settingsSchema.partial().strict()
export type AppSettings = z.infer<typeof settingsSchema>
export type AppSettingsPatch = z.infer<typeof settingsPatchSchema>
export type AppRoute = AppSettings['route']
export const defaultSettings: AppSettings = {
  theme: 'dark', route: 'commands', sidebarCollapsed: false,
  terminalVisible: true, terminalHeight: 200
}
export const windowActionSchema = z.enum(['minimize', 'maximize', 'close'])
export type WindowAction = z.infer<typeof windowActionSchema>
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }
export interface DevCommandAPI extends RuntimeAPI, WorkspaceAPI, GitAPI, ExtendedAPI {
  clipboard: { writeText(text: string): Promise<ApiResult<null>> }
  settings: {
    get(): Promise<ApiResult<AppSettings>>
    update(patch: AppSettingsPatch): Promise<ApiResult<AppSettings>>
  }
  window: { control(action: WindowAction): Promise<ApiResult<null>> }
}
