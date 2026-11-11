import { describe, expect, it } from 'vitest'
import { actionLabel, commandFamily, defaultCommand, groupCommands, sharedActionParams } from '../src/shared/command-groups'
import { registry } from '../src/main/services/commands/registry'
import type { CommandSummary } from '../src/shared/commands'
const catalog: CommandSummary[] = registry.map((entry) => ({ ...entry, favorite: false }))
const find = (id: string) => catalog.find((entry) => entry.id === id)!
describe('command families', () => {
  it('groups every command exactly once without dropping any action', () => {
    const groups = groupCommands(catalog)
    expect(groups.length).toBeLessThan(catalog.length / 2)
    expect(groups.flatMap((group) => group.commands.map((entry) => entry.id)).sort()).toEqual(catalog.map((entry) => entry.id).sort())
    for (const group of groups) expect(group.commands).toContain(defaultCommand(group))
  })
  it('shows one item per AI tool and keeps every available action', () => {
    const groups = groupCommands(catalog.filter((entry) => entry.category === 'AI Developer CLI'))
    expect(groups.map((group) => group.title)).toEqual(['Codex', 'Claude Code', 'Gemini CLI', 'Antigravity CLI'])
    expect(defaultCommand(groups[0]).id).toBe('ai.codex.start')
    expect(groups[0].commands.map(actionLabel)).toEqual(['Help', 'Version', 'Start session', 'Resume latest'])
    expect(groups[3].commands.map(actionLabel)).toEqual(['Help', 'Start session', 'Resume latest'])
  })
  it('keeps risk/search/favorite filtered groups limited to matching actions', () => {
    const safe = groupCommands(catalog.filter((entry) => entry.risk === 'safe'))
    expect(safe.flatMap((group) => group.commands).every((entry) => entry.risk === 'safe')).toBe(true)
    const single = groupCommands([find('git.remote.remove')])
    expect(single[0].title).toBe('Git Remotes')
    expect(defaultCommand(single[0]).id).toBe('git.remote.remove')
    expect(single[0].commands).toHaveLength(1)
  })
  it('keeps distinct permission and ACL families', () => {
    expect(groupCommands(catalog.filter((entry) => entry.category === 'Permissions')).map((group) => [group.title, group.commands.length])).toEqual([['File Permissions', 3], ['File ACL', 4]])
    expect(commandFamily(find('git.reset.hard')).id).toBe(commandFamily(find('git.log')).id)
  })
  it('preserves shared targets but does not carry sensitive or incompatible values', () => {
    expect(sharedActionParams(find('system.port'), find('system.port.stop'), { port: '4321' })).toEqual({ port: '4321' })
    expect(sharedActionParams(find('permissions.inspect'), find('permissions.chmod'), { target: 'a file.txt' })).toEqual({ target: 'a file.txt' })
    expect(sharedActionParams(find('git.config.set'), find('git.config.set'), { key: 'user.name', scope: 'local', value: 'private' })).toEqual({ key: 'user.name', scope: 'local' })
  })
})
