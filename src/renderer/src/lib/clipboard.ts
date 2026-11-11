import { unwrap } from './settings'

export async function copyText(text: string): Promise<void> {
  if (typeof window.devcommand?.clipboard?.writeText !== 'function') {
    throw new Error('Clipboard support is out of date. Fully quit and restart DevCommand. In development, stop and restart npm run dev.')
  }
  unwrap(await window.devcommand.clipboard.writeText(text))
}
