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
  return display.replace(/^git --literal-pathspecs(?: -c '[^']*')+ /, 'git ')
}
