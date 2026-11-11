export function redact(value: string): string {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED]')
    .replace(/\b((?:Bearer|Basic)\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b((?:password|token|api[_-]?key|secret)\s*[=:]\s*)[^\s]+/gi, '$1[REDACTED]')
}
// Hold incomplete lines across OS chunks so secrets split between chunks stay redacted.
// Oversized lines are entirely suppressed, rather than leaking arbitrary fragments.
export class LineRedactor {
  constructor(private secrets: string[] = []) {}
  private clean(value: string): string {
    for (const secret of this.secrets.filter(Boolean).sort((a, b) => b.length - a.length)) value = value.replaceAll(secret, '[REDACTED]')
    return redact(value)
  }
  private pending = ''
  private dropping = false
  push(data: string): string {
    let output = ''
    for (const part of data.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const complete = part.endsWith('\n')
      if (this.dropping) { if (complete) this.dropping = false; continue }
      if (this.pending.length + part.length > 8192) {
        this.pending = ''; this.dropping = !complete
        output += '[Oversized output line omitted]\n'
        continue
      }
      this.pending += part
      if (complete) { output += this.clean(this.pending); this.pending = '' }
    }
    return output
  }
  flush(): string { const output = this.clean(this.pending); this.pending = ''; this.dropping = false; this.secrets = []; return output }
}
