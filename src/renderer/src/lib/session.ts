import type { CommandRequest } from '../../../shared/commands'
import type { TerminalSession } from '../../../shared/runtime'
import { create } from 'zustand'
interface SessionState {
  query: string
  setQuery: (query: string) => void
  selectedId: string
  select: (id: string) => void
  draft: CommandRequest | null
  setDraft: (request: CommandRequest | null) => void
  activeTerminalId: string | null
  setActiveTerminalId: (id: string | null) => void
  inserted: TerminalSession | null
  setInserted: (session: TerminalSession | null) => void
}
export const useSession = create<SessionState>((set) => ({
  activeTerminalId: null, setActiveTerminalId: (activeTerminalId) => set({ activeTerminalId }),
  query: '', setQuery: (query) => set({ query }),
  draft: null, setDraft: (draft) => set({ draft }),
  inserted: null, setInserted: (inserted) => set({ inserted }),
  selectedId: 'git.remote.set-url', select: (selectedId) => set({ selectedId, draft: null })
}))
