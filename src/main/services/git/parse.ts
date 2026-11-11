import type { GitFile } from '../../../shared/git'

export function parseStatus(raw: string): GitFile[] {
  const records = raw.split('\0'), files: GitFile[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record) continue
    const status = record.slice(0, 2), path = record.slice(3)
    if (record[2] !== ' ' || !path) throw new Error('Invalid Git status record')
    const renamed = /[RC]/.test(status)
    const originalPath = renamed ? records[++index] : undefined
    if (renamed && !originalPath) throw new Error('Missing rename source')
    files.push({ path, originalPath, indexStatus: status[0], worktreeStatus: status[1], untracked: status === '??', conflicted: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status) })
  }
  return files
}
/** Each fixed-width record ends in NUL; Git adds LF only between complete records. */
export function nulRecords(raw: string, width: number): string[][] {
  const fields = raw.split('\0'), result: string[][] = []
  for (let offset = 0; offset + width <= fields.length; offset += width) {
    const record = fields.slice(offset, offset + width)
    record[0] = record[0].replace(/^\n/, '')
    if (record[0]) result.push(record)
  }
  return result
}
