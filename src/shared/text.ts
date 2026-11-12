/** Split transport messages without separating UTF-16 surrogate pairs. */
export function* textChunks(value: string, limit: number): Generator<string> {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Chunk limit must be an integer of at least two')
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + limit)
    const last = value.charCodeAt(end - 1)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--
    yield value.slice(offset, end)
    offset = end
  }
}
export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

// Keep user-facing commands concise while preserving shell quoting and arguments.
export function conciseCommandDisplay(display: string): string {
  const gitDisplay = display.replace(/^git --literal-pathspecs(?: -c '[^']*')+ /, 'git ')
  if (!gitDisplay.startsWith('ssh -F /dev/null -T ') && !gitDisplay.startsWith('ssh -F NUL -T ')) return gitDisplay
  // Parse only our POSIX-quoted display tokens, retaining raw spelling for every kept argument.
  const tokens: { raw: string; value: string }[] = []
  const token = /(?:[^\s'\\]+|'[^']*'|\\.)+/y
  let offset = 0
  while (offset < gitDisplay.length) {
    if (/\s/.test(gitDisplay[offset])) { offset++; continue }
    token.lastIndex = offset
    const match = token.exec(gitDisplay)
    if (!match) return gitDisplay
    const raw = match[0]
    tokens.push({ raw, value: raw.replace(/'([^']*)'|\\(.)/g, (_match, quoted: string | undefined, escaped: string | undefined) => quoted ?? escaped ?? '') })
    offset = token.lastIndex
  }
  const diagnosticOptions = new Set([
    'BatchMode=yes', 'StrictHostKeyChecking=yes', 'CheckHostIP=no', 'UpdateHostKeys=no',
    'VerifyHostKeyDNS=no', 'ConnectionAttempts=1', 'ConnectTimeout=10', 'ProxyCommand=none',
    'ProxyJump=none', 'PermitLocalCommand=no', 'RemoteCommand=none', 'ForwardAgent=no',
    'ClearAllForwardings=yes', 'ControlMaster=no', 'ControlPath=none', 'IdentitiesOnly=yes'
  ])
  const concise = ['ssh', '-T']
  for (let index = 4; index < tokens.length; index++) {
    const current = tokens[index], next = tokens[index + 1]
    if (current.value === '-o' && next && (diagnosticOptions.has(next.value) || /^UserKnownHostsFile="[^"\r\n]+"$/.test(next.value))) { index++; continue }
    concise.push(current.raw)
  }
  return concise.join(' ')
}
