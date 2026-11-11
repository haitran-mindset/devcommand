import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { HistoryEntry, Workspace } from '../../../shared/commands'
import { desc, eq } from 'drizzle-orm'
import { appSettings, workspaces, commandFavorites, executionHistory } from './schema'
import { defaultSettings, settingsPatchSchema, settingsSchema, type AppSettings, type AppSettingsPatch } from '../../../shared/contracts'

export function openSettingsStore(path: string) {
  const sqlite = new Database(path)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.transaction(() => {
      const version = sqlite.pragma('user_version', { simple: true }) as number
      if (version > 2) throw new Error('Database was created by a newer DevCommand version')
      if (version < 1) {
        sqlite.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)')
        sqlite.pragma('user_version = 1')
      }
      if (version < 2) {
        sqlite.exec(`CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, favorite TEXT NOT NULL, last_opened_at TEXT NOT NULL);
          CREATE TABLE command_favorites (command_id TEXT PRIMARY KEY);
          CREATE TABLE executions (id TEXT PRIMARY KEY, record_json TEXT NOT NULL, started_at TEXT NOT NULL);`)
        sqlite.pragma('user_version = 2')
      }
    })()
    const db = drizzle(sqlite)
    const get = (): AppSettings => {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'preferences')).get()
      return row ? settingsSchema.parse(JSON.parse(row.value)) : { ...defaultSettings }
    }
    const update = (input: AppSettingsPatch): AppSettings => sqlite.transaction(() => {
      const next = settingsSchema.parse({ ...get(), ...settingsPatchSchema.parse(input) })
      db.insert(appSettings).values({ key: 'preferences', value: JSON.stringify(next) })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(next) } }).run()
      return next
    })()
    const listWorkspaces = (): Workspace[] => db.select().from(workspaces).orderBy(desc(workspaces.lastOpenedAt)).all().map((row) => ({ ...row, favorite: row.favorite === 'true' }))
    const selectedWorkspace = (): string | null => db.select().from(appSettings).where(eq(appSettings.key, 'active-workspace')).get()?.value ?? null
    const selectWorkspace = (id: string) => {
      if (!listWorkspaces().some((workspace) => workspace.id === id)) throw new Error('Unknown workspace')
      db.insert(appSettings).values({ key: 'active-workspace', value: id }).onConflictDoUpdate({ target: appSettings.key, set: { value: id } }).run()
      db.update(workspaces).set({ lastOpenedAt: new Date().toISOString() }).where(eq(workspaces.id, id)).run()
    }
    const addWorkspace = (rootPath: string): Workspace => {
      const existing = listWorkspaces().find((workspace) => workspace.rootPath === rootPath)
      if (existing) { selectWorkspace(existing.id); return existing }
      if (listWorkspaces().length >= 100) throw new Error('Workspace limit reached (100). Remove an entry first.')
      const row = { id: randomUUID(), name: basename(rootPath), rootPath, favorite: 'false', lastOpenedAt: new Date().toISOString() }
      sqlite.transaction(() => { db.insert(workspaces).values(row).run(); selectWorkspace(row.id) })()
      return { ...row, favorite: false }
    }
    const removeWorkspace = (id: string) => sqlite.transaction(() => {
      db.delete(workspaces).where(eq(workspaces.id, id)).run()
      if (selectedWorkspace() === id) db.delete(appSettings).where(eq(appSettings.key, 'active-workspace')).run()
    })()
    const favoriteWorkspace = (id: string, favorite: boolean) => db.update(workspaces).set({ favorite: String(favorite) }).where(eq(workspaces.id, id)).run()
    const favorites = (): string[] => db.select().from(commandFavorites).all().map((row) => row.commandId)
    const favoriteCommand = (commandId: string, favorite: boolean) => {
      if (favorite) db.insert(commandFavorites).values({ commandId }).onConflictDoNothing().run()
      else db.delete(commandFavorites).where(eq(commandFavorites.commandId, commandId)).run()
    }
    const clearHistory = () => { db.delete(executionHistory).run() }
    const history = (): HistoryEntry[] => db.select().from(executionHistory).orderBy(desc(executionHistory.startedAt)).limit(100).all().map((row) => JSON.parse(row.record) as HistoryEntry)
    const saveHistory = (entry: HistoryEntry) => sqlite.transaction(() => {
      const record = JSON.stringify(entry)
      db.insert(executionHistory).values({ id: entry.execution.id, record, startedAt: entry.execution.startedAt }).onConflictDoUpdate({ target: executionHistory.id, set: { record } }).run()
      sqlite.exec('DELETE FROM executions WHERE id NOT IN (SELECT id FROM executions ORDER BY started_at DESC LIMIT 100)')
    })()
    // Recover interrupted runs after a crash without pretending they completed.
    for (const entry of history()) if (entry.execution.status === 'running') saveHistory({ ...entry, execution: { ...entry.execution, status: 'cancelled', finishedAt: new Date().toISOString(), error: 'Application closed before completion.' } })
    return { get, update, listWorkspaces, selectedWorkspace, selectWorkspace, addWorkspace, removeWorkspace, favoriteWorkspace, favorites, favoriteCommand, history, clearHistory, saveHistory, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
export type SettingsStore = ReturnType<typeof openSettingsStore>
