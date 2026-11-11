import type { SshHost } from '../../../shared/extended'
import { PublicError } from '../../security/errors'

interface Line { raw: string; key?: string; values: string[]; comment: string; indent: string; ending: string }
export interface HostBlock { start: number; end: number; host: SshHost }
export interface ParsedConfig { lines: Line[]; blocks: HostBlock[]; complex: boolean }
export function parseConfig(text: string, identityName: (value: string) => string | undefined): ParsedConfig {
  const lines: Line[] = (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((raw) => {
    const ending = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : ''
    const body = raw.slice(0, raw.length - ending.length)
    const match = body.match(/^(\s*)([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*)$/)
    if (!match) return { raw, values: [], comment: '', indent: '', ending }
    const values: string[] = []
    let token = '', quote = '', escaped = false, comment = ''
    for (let index = 0; index < match[3].length; index++) {
      const char = match[3][index]
      if (escaped) { token += char; escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (quote) { if (char === quote) quote = ''; else token += char; continue }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '#') { comment = match[3].slice(index); break }
      if (/\s/.test(char)) { if (token) { values.push(token); token = '' } } else token += char
    }
    if (token) values.push(token)
    return { raw, key: match[2].toLowerCase(), values, comment, indent: match[1], ending }
  })
  const complex = lines.some((line) => line.key === 'include' || line.key === 'match')
  const starts = lines.flatMap((line, index) => line.key === 'host' ? [index] : [])
  const blocks = starts.map((start, index): HostBlock => {
    const end = starts[index + 1] ?? lines.length, alias = lines[start].values.join(' ')
    const fields = lines.slice(start + 1, end)
    const value = (key: string) => fields.find((line) => line.key === key)?.values.join(' ') ?? ''
    const identity = value('identityfile'), resolvedIdentity = identity ? identityName(identity) : ''
    const duplicate = ['hostname', 'user', 'port', 'identityfile', 'identitiesonly'].some((key) => fields.filter((line) => line.key === key).length > 1)
    const simpleAlias = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(alias)
    const port = value('port') ? Number(value('port')) : 22
    const reason = complex ? 'Include/Match config requires manual editing.' : !simpleAlias ? 'Multi-pattern or wildcard hosts are read-only.' : duplicate ? 'Duplicate identity/host directives require manual editing.' : identity && resolvedIdentity === undefined ? 'IdentityFile outside this SSH directory requires manual editing.' : !Number.isInteger(port) || port < 1 || port > 65535 ? 'Invalid declared port.' : undefined
    return { start, end, host: { alias, hostName: value('hostname') || alias, user: value('user'), port, identityName: resolvedIdentity ?? '', editable: !reason, reason } }
  })
  for (const block of blocks) if (blocks.filter((entry) => entry.host.alias.toLowerCase() === block.host.alias.toLowerCase()).length > 1) { block.host.editable = false; block.host.reason = 'Duplicate Host blocks require manual editing.' }
  return { lines, blocks, complex }
}
export function updateConfig(text: string, parsed: ParsedConfig, action: { kind: 'host.add' | 'host.update' | 'host.remove'; alias: string; hostName?: string; user?: string; port?: number; identityName?: string }, sshDirectory: string): string {
  if (parsed.complex) throw new PublicError('Include/Match config is read-only. Edit it manually to preserve its semantics.')
  const block = parsed.blocks.find((entry) => entry.host.alias.toLowerCase() === action.alias.toLowerCase())
  if (action.kind === 'host.add' && block) throw new PublicError('This Host alias already exists.')
  if (action.kind !== 'host.add' && (!block || !block.host.editable)) throw new PublicError(block?.host.reason ?? 'The selected Host alias no longer exists.')
  if (action.kind === 'host.remove') return parsed.lines.map((line, index) => index >= block!.start && index < block!.end ? (line.key ? '' : line.raw) : line.raw).join('')
  const values: Record<string, string> = { hostname: action.hostName!, user: action.user!, port: String(action.port), identityfile: action.identityName ? `"${sshDirectory.replaceAll('\\', '/').replaceAll('"', '\\"')}/${action.identityName}"` : '', identitiesonly: action.identityName ? 'yes' : '' }
  const names: Record<string, string> = { hostname: 'HostName', user: 'User', port: 'Port', identityfile: 'IdentityFile', identitiesonly: 'IdentitiesOnly' }
  const ending = text.includes('\r\n') ? '\r\n' : '\n'
  if (action.kind === 'host.add') return text + (text && !text.endsWith('\n') ? ending : '') + `${ending}Host ${action.alias}${ending}` + Object.entries(values).filter(([, value]) => value).map(([key, value]) => `  ${names[key]} ${value}${ending}`).join('')
  const seen = new Set<string>()
  const body = parsed.lines.slice(block!.start + 1, block!.end).map((line) => {
    if (!line.key || !(line.key in values)) return line.raw
    seen.add(line.key)
    if (!values[line.key]) return line.comment ? `${line.indent}${line.comment}${line.ending || ending}` : ''
    return `${line.indent || '  '}${names[line.key]} ${values[line.key]}${line.comment ? ' ' + line.comment : ''}${line.ending || ending}`
  }).join('')
  const appended = Object.entries(values).filter(([key, value]) => value && !seen.has(key)).map(([key, value]) => `  ${names[key]} ${value}${ending}`).join('')
  return parsed.lines.slice(0, block!.start + 1).map((line) => line.raw.endsWith('\n') ? line.raw : line.raw + ending).join('') + body + (body && !body.endsWith('\n') ? ending : '') + appended + parsed.lines.slice(block!.end).map((line) => line.raw).join('')
}
