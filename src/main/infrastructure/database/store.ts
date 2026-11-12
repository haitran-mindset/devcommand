import { savedCommandSaveSchema, savedCommandSchema, savedCommandReferenceSchema, savedCommandTagUpdateSchema, savedCommandMoveSchema, savedCommandsClearSchema, type SavedCommandsClear, type SavedCommandMove, type SavedCommand, type SaveSavedCommand, type SavedCommandTagUpdate } from '../../../shared/saved-commands'
import { PublicError } from '../../security/errors'
import { z } from 'zod'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { HistoryEntry, Workspace } from '../../../shared/commands'
import { desc, eq } from 'drizzle-orm'
import { appSettings, workspaces, commandFavorites, executionHistory, savedCommands } from './schema'
import { defaultSettings, settingsPatchSchema, settingsSchema, type AppSettings, type AppSettingsPatch } from '../../../shared/contracts'

export function openSettingsStore(path: string) {
  const sqlite = new Database(path)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.transaction(() => {
      const version = sqlite.pragma('user_version', { simple: true }) as number
      if (version > 5) throw new Error('Database was created by a newer DevCommand version')
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
      // Clean up the removed experimental module without resetting other local data.
      if (version < 4) {
        sqlite.exec('DROP TABLE IF EXISTS workflow_runs; DROP TABLE IF EXISTS workflows;')
        const preferences = sqlite.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('preferences') as { value_json: string } | undefined
        if (preferences) {
          const value: unknown = JSON.parse(preferences.value_json)
          if (value && typeof value === 'object' && 'route' in value && value.route === 'workflows') {
            value.route = 'commands'
            sqlite.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?').run(JSON.stringify(value), 'preferences')
          }
        }
        sqlite.pragma('user_version = 4')
      }
      if (version < 5) {
        sqlite.exec('CREATE TABLE IF NOT EXISTS saved_commands (id TEXT PRIMARY KEY, title TEXT NOT NULL, command TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
        sqlite.pragma('user_version = 5')
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
    const favoriteOrder = (): string[] => {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'favorite-group-order')).get()
      if (!row) return []
      const value: unknown = JSON.parse(row.value)
      if (!Array.isArray(value) || value.length > 200 || !value.every((id) => typeof id === 'string' && id.length <= 80) || new Set(value).size !== value.length) throw new Error('Invalid saved favorite order')
      return value as string[]
    }
    const setFavoriteOrder = (ids: string[]) => {
      db.insert(appSettings).values({ key: 'favorite-group-order', value: JSON.stringify(ids) }).onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(ids) } }).run()
    }
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
    const decodeSavedCommand = (row: typeof savedCommands.$inferSelect): SavedCommand => savedCommandSchema.parse({ ...row, tags: JSON.parse(row.tags) })
    const savedCommandOrder = (): string[] => {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'saved-command-order')).get()
      return row ? z.array(z.uuid()).max(1000).refine(ids => new Set(ids).size === ids.length).parse(JSON.parse(row.value)) : []
    }
    const setSavedCommandOrder = (ids: string[]) => {
      const value = JSON.stringify(ids)
      db.insert(appSettings).values({ key: 'saved-command-order', value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
    }
    const listSavedCommands = (): SavedCommand[] => {
      const order = new Map(savedCommandOrder().map((id, index) => [id, index]))
      return db.select().from(savedCommands).orderBy(desc(savedCommands.createdAt), savedCommands.id).all().map(decodeSavedCommand)
        .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000))
    }
    const moveSavedCommand = (input: SavedCommandMove) => sqlite.transaction(() => {
      const { sourceId, targetId, placement } = savedCommandMoveSchema.parse(input)
      const current = listSavedCommands().map(entry => entry.id)
      if (!current.includes(sourceId) || !current.includes(targetId)) throw new PublicError('These saved commands changed. Refresh and try again.')
      if (sourceId === targetId) return
      const next = current.filter(id => id !== sourceId), target = next.indexOf(targetId)
      next.splice(target + (placement === 'after' ? 1 : 0), 0, sourceId)
      setSavedCommandOrder(next)
    })()
    const requireSavedCommand = (id: string, revision: string): SavedCommand => {
      const row = db.select().from(savedCommands).where(eq(savedCommands.id, id)).get()
      if (!row) throw new PublicError('This saved command was removed. Refresh the list.')
      if (row.revision !== revision) throw new PublicError('This saved command changed. Refresh before editing or running it.')
      return decodeSavedCommand(row)
    }
    const saveSavedCommand = (input: SaveSavedCommand): SavedCommand => sqlite.transaction(() => {
      const { id, revision, ...fields } = savedCommandSaveSchema.parse(input)
      const previous = id && revision ? requireSavedCommand(id, revision) : undefined
      const currentOrder = listSavedCommands().map(entry => entry.id)
      if (!previous && currentOrder.length >= 1000) throw new PublicError('Saved command limit reached (1000). Remove an entry first.')
      const now = new Date().toISOString()
      const record = { ...fields, id: previous?.id ?? randomUUID(), revision: randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now }
      const row = { ...record, tags: JSON.stringify(record.tags) }
      db.insert(savedCommands).values(row).onConflictDoUpdate({ target: savedCommands.id, set: row }).run()
      if (!previous) setSavedCommandOrder([record.id, ...currentOrder])
      return record
    })()
    const removeSavedCommand = (input: Pick<SavedCommand, 'id' | 'revision'>) => sqlite.transaction(() => {
      const ref = savedCommandReferenceSchema.parse(input)
      requireSavedCommand(ref.id, ref.revision)
      db.delete(savedCommands).where(eq(savedCommands.id, ref.id)).run()
      setSavedCommandOrder(listSavedCommands().map(entry => entry.id))
    })()
    const clearSavedCommands = (input: SavedCommandsClear) => sqlite.transaction(() => {
      const { entries } = savedCommandsClearSchema.parse(input)
      const expected = new Map(entries.map(entry => [entry.id, entry.revision]))
      const current = listSavedCommands()
      if (current.length !== entries.length || current.some(entry => expected.get(entry.id) !== entry.revision)) throw new PublicError('Saved commands changed. Close this dialog and review deletion again.')
      db.delete(savedCommands).run()
      db.delete(appSettings).where(eq(appSettings.key, 'saved-command-order')).run()
    })()
    const tagSavedCommands = (input: SavedCommandTagUpdate) => sqlite.transaction(() => {
      const { ids, tag, operation } = savedCommandTagUpdateSchema.parse(input)
      for (const id of ids) {
        const row = db.select().from(savedCommands).where(eq(savedCommands.id, id)).get()
        if (!row) throw new PublicError('A selected command was removed. Refresh the list.')
        const record = decodeSavedCommand(row)
        const tags = operation === 'add' ? [...new Set([...record.tags, tag])] : record.tags.filter(value => value !== tag)
        if (tags.length > 12) throw new PublicError('A command can have at most 12 tags. Remove a tag first.')
        db.update(savedCommands).set({ tags: JSON.stringify(tags), revision: randomUUID(), updatedAt: new Date().toISOString() }).where(eq(savedCommands.id, id)).run()
      }
    })()
    // Recover interrupted runs after a crash without pretending they completed.
    for (const entry of history()) if (entry.execution.status === 'running') saveHistory({ ...entry, execution: { ...entry.execution, status: 'cancelled', finishedAt: new Date().toISOString(), error: 'Application closed before completion.' } })
    return { clearSavedCommands, moveSavedCommand, listSavedCommands, saveSavedCommand, removeSavedCommand, tagSavedCommands, requireSavedCommand, get, update, listWorkspaces, selectedWorkspace, selectWorkspace, addWorkspace, removeWorkspace, favoriteWorkspace, favorites, favoriteOrder, setFavoriteOrder, favoriteCommand, history, clearHistory, saveHistory, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
export type SettingsStore = ReturnType<typeof openSettingsStore>
