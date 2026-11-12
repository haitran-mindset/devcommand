import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(), value: text('value_json').notNull()
})
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), name: text('name').notNull(), rootPath: text('root_path').notNull().unique(),
  favorite: text('favorite').notNull(), lastOpenedAt: text('last_opened_at').notNull()
})
export const commandFavorites = sqliteTable('command_favorites', { commandId: text('command_id').primaryKey() })
export const executionHistory = sqliteTable('executions', { id: text('id').primaryKey(), record: text('record_json').notNull(), startedAt: text('started_at').notNull() })

export const savedCommands = sqliteTable('saved_commands', {
  id: text('id').primaryKey(), title: text('title').notNull(), command: text('command').notNull(), description: text('description').notNull(),
  tags: text('tags_json').notNull(), revision: text('revision').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
})
