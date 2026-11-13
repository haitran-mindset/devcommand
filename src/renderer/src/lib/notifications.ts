import { create } from 'zustand'

export type NotificationKind = 'success' | 'error' | 'warning' | 'info'
export interface AppNotification { id: string; kind: NotificationKind; title: string; message: string; createdAt: number; read: boolean }
interface NotificationsState {
  entries: AppNotification[]
  add: (kind: NotificationKind, title: string, message?: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clear: () => void
}
export const useNotifications = create<NotificationsState>(set => ({
  entries: [],
  add: (kind, title, message = '') => set(state => ({ entries: [{ id: crypto.randomUUID(), kind, title, message, createdAt: Date.now(), read: false }, ...state.entries].slice(0, 100) })),
  markAllRead: () => set(state => ({ entries: state.entries.map(entry => ({ ...entry, read: true })) })),
  remove: id => set(state => ({ entries: state.entries.filter(entry => entry.id !== id) })),
  clear: () => set({ entries: [] }),
}))
