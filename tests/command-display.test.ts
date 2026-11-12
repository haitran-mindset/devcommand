import { describe, expect, it } from 'vitest'
import { conciseCommandDisplay } from '../src/shared/text'
import { displayCommand } from '../src/main/services/commands/registry'

describe('concise managed command display', () => {
  it('removes Git transport options while keeping quoted arguments', () => {
    expect(conciseCommandDisplay("git --literal-pathspecs -c 'core.hooksPath=/dev/null' -c 'core.pager=cat' status --short --branch")).toBe('git status --short --branch')
  })
  it('hides generated SSH diagnostics but retains target, identity and non-default port', () => {
    const args = ['-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ProxyCommand=none', '-o', 'UserKnownHostsFile="/fixture/known hosts"', '-p', '2222', '-l', 'git', '-o', 'IdentitiesOnly=yes', '-i', "/fixture/O'Brien/key with spaces", '--', 'github.com']
    const full = displayCommand('ssh', args)
    expect(conciseCommandDisplay(full)).toBe(displayCommand('ssh', ['-T', '-p', '2222', '-l', 'git', '-i', "/fixture/O'Brien/key with spaces", '--', 'github.com']))
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(full).toContain('UserKnownHostsFile')
  })
  it('keeps unknown SSH options, and leaves ordinary SSH and other commands unchanged', () => {
    const full = displayCommand('ssh', ['-F', 'NUL', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=45', '-o', 'ProxyJump=bastion', '--', 'example.com'])
    expect(conciseCommandDisplay(full)).toBe(displayCommand('ssh', ['-T', '-o', 'ConnectTimeout=45', '-o', 'ProxyJump=bastion', '--', 'example.com']))
    for (const command of ['ssh -T git@github.com', "ssh -F custom.conf -T -o 'BatchMode=yes' host", 'ssh-add -t 3600 /fixture/key', 'eval "$(ssh-agent -s)" && ssh-add /fixture/key']) expect(conciseCommandDisplay(command)).toBe(command)
  })
  it('leaves malformed quoted commands unchanged', () => {
    const command = "ssh -F /dev/null -T -o 'BatchMode=yes host"
    expect(conciseCommandDisplay(command)).toBe(command)
  })
})
