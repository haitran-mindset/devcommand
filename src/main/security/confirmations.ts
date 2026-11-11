import { createHash, randomUUID } from 'node:crypto'
import { PublicError } from './errors'
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export class Confirmations {
  private entries = new Map<string, { request: string; state: string; expires: number }>()
  constructor(private now = () => Date.now()) {}
  issue(request: unknown, state: string) {
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(id)
    while (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!)
    const token = randomUUID(), expires = this.now() + 60000
    this.entries.set(token, { request: hash(JSON.stringify(request)), state, expires })
    return { token, expiresAt: new Date(expires).toISOString() }
  }
  take(token: string, request: unknown): string {
    const entry = this.entries.get(token); this.entries.delete(token)
    if (!entry || entry.expires <= this.now() || entry.request !== hash(JSON.stringify(request))) throw new PublicError('Confirmation is missing, expired or mismatched. Review a fresh preview.')
    return entry.state
  }
  clear() { this.entries.clear() }
}
