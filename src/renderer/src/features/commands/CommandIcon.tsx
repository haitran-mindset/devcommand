import { Container, Files, Folder, Search, Archive, Cloud, Bot, KeyRound, ShieldCheck, CirclePlus, Code2, FileDiff, GitBranch, GitCommitHorizontal, List, RefreshCw, Settings, SquarePen, Terminal, Trash2 } from 'lucide-react'

export function CommandIcon({ id }: { id: string }) {
  const Icon = id.startsWith('compare.') ? FileDiff
    : id.includes('mkdir') || id.includes('rmdir') || id.includes('.dir.') || id === 'find.directory' ? Folder
    : id.startsWith('files.') ? Files
    : id.startsWith('find.') ? Search
    : id.startsWith('zsh.') ? Terminal
    : id.startsWith('cloudflared.') || id.startsWith('ngrok.') ? Cloud
    : id.startsWith('ssh.') ? KeyRound
    : id.startsWith('permissions.') || id.startsWith('gitleaks.') ? ShieldCheck
    : id.startsWith('docker.') ? Container
    : id.startsWith('ai.') ? Bot
    : id.includes('remove') || id.includes('delete') || id.includes('drop') ? Trash2
    : id.includes('set-url') || id.includes('fetch') ? RefreshCw
    : id.includes('.add') || id.includes('.create') ? CirclePlus
    : id.includes('rename') ? SquarePen
    : id.includes('config') ? Settings
    : id.includes('stash') ? Archive
    : id.includes('diff') ? FileDiff
    : id === 'git.log' || id === 'git.checkout.commit' ? GitCommitHorizontal
    : id.includes('.list') ? List
    : id.startsWith('git.') ? GitBranch
    : id.startsWith('node.') || id.startsWith('npm.') ? Code2 : Terminal
  return <Icon aria-hidden="true" />
}
