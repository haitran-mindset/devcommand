import { Archive, Bot, ShieldCheck, CirclePlus, Code2, FileDiff, GitBranch, GitCommitHorizontal, List, RefreshCw, Settings, SquarePen, Terminal, Trash2 } from 'lucide-react'

export function CommandIcon({ id }: { id: string }) {
  const Icon = id.startsWith('permissions.') ? ShieldCheck : id.startsWith('ai.') ? Bot : id.includes('remove') || id.includes('delete') || id.includes('drop') ? Trash2
    : id.includes('set-url') || id.includes('fetch') ? RefreshCw
    : id.includes('.add') || id.includes('.create') ? CirclePlus
    : id.includes('rename') ? SquarePen
    : id.includes('config') ? Settings
    : id.includes('stash') ? Archive
    : id.includes('diff') ? FileDiff
    : id === 'git.log' ? GitCommitHorizontal
    : id.includes('.list') ? List
    : id.startsWith('git.') ? GitBranch
    : id.startsWith('node.') || id.startsWith('npm.') ? Code2 : Terminal
  return <Icon aria-hidden="true" />
}
