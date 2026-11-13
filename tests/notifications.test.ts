import { beforeEach, expect, it } from 'vitest'
import { useNotifications } from '../src/renderer/src/lib/notifications'
beforeEach(() => useNotifications.getState().clear())
it('bounds notifications, preserves ordering and unread state', () => {
  for (let index = 0; index < 105; index++) useNotifications.getState().add('info', `Notice ${index}`)
  expect(useNotifications.getState().entries).toHaveLength(100)
  expect(useNotifications.getState().entries[0].title).toBe('Notice 104')
  useNotifications.getState().markAllRead()
  expect(useNotifications.getState().entries.every(entry => entry.read)).toBe(true)
  useNotifications.getState().add('error', 'Failed')
  expect(useNotifications.getState().entries[0].read).toBe(false)
  expect(useNotifications.getState().entries[1].read).toBe(true)
})
it('dismisses only the selected notification and clears the center', () => {
  useNotifications.getState().add('success', 'Done')
  useNotifications.getState().add('warning', 'Warning', 'Details')
  const id = useNotifications.getState().entries[0].id
  useNotifications.getState().remove(id)
  expect(useNotifications.getState().entries.map(entry => entry.title)).toEqual(['Done'])
  useNotifications.getState().clear()
  expect(useNotifications.getState().entries).toEqual([])
})
