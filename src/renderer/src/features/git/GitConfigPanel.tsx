import { GitBranch, Pencil, ShieldCheck, UserRound } from 'lucide-react'
import type { ConfigValue, GitConfig } from '../../../../shared/git'
import { Button } from '../../components/ui/button'

const labels: Record<GitConfig['key'], string> = {
  'user.name': 'Author name',
  'user.email': 'Author email',
  'core.autocrlf': 'Line endings',
  'pull.rebase': 'Pull strategy',
  'init.defaultBranch': 'Default branch',
}
const groups = [
  { title: 'Commit identity', description: 'The name and email used for your commits.', icon: UserRound, keys: ['user.name', 'user.email'] },
  { title: 'Git behavior', description: 'Preferences for line endings, pulls and new repositories.', icon: GitBranch, keys: ['core.autocrlf', 'pull.rebase', 'init.defaultBranch'] },
]

export function GitConfigPanel({ entries, onEdit }: { entries: GitConfig[]; onEdit: (key: GitConfig['key'], scope: 'local' | 'global') => void }) {
  return <div className="git-config-panel">
    <div className="git-config-intro"><div><h2>Git configuration</h2><p>Compare repository settings with your global defaults.</p></div><div className="git-config-scope-guide"><span><i />Local <small>This repository</small></span><span><i />Global <small>All repositories</small></span></div></div>
    {groups.map(({ title, description, icon: Icon, keys }) => <section className="git-config-group" key={title} aria-label={title}>
      <header><Icon /><div><h3>{title}</h3><p>{description}</p></div></header>
      <div className="git-config-table-wrap"><table className="git-config-table"><caption className="sr-only">{title}: local, global and effective values</caption><thead><tr><th scope="col">Setting</th><th scope="col">Local</th><th scope="col">Global</th><th scope="col">Effective value</th></tr></thead><tbody>{entries.filter((entry) => keys.includes(entry.key)).map((entry) => <tr key={entry.key}>
        <th scope="row"><strong>{labels[entry.key]}</strong><code>{entry.key}</code></th>
        <td><EditableValue value={entry.local} label={`Edit local ${entry.key}`} onEdit={() => onEdit(entry.key, 'local')} /></td>
        <td><EditableValue value={entry.global} label={`Edit global ${entry.key}`} onEdit={() => onEdit(entry.key, 'global')} /></td>
        <td><span className={`git-config-effective${entry.effective ? '' : ' is-unset'}`} title={entry.effective?.value}>{entry.effective ? entry.effective.value || 'Empty value' : 'Not set'}</span>{entry.effective && <div className="git-config-source"><span>{entry.effective.scope}</span><code title={entry.effective.origin}>{entry.effective.origin}</code></div>}</td>
      </tr>)}</tbody></table></div>
    </section>)}
    <p className="git-config-privacy"><ShieldCheck />Supported settings only. Config values are omitted from execution history.</p>
  </div>
}

function EditableValue({ value, label, onEdit }: { value?: ConfigValue; label: string; onEdit: () => void }) {
  return <div className="git-config-editable"><span className={value ? undefined : 'is-unset'} title={value?.value}>{value ? value.value || 'Empty value' : 'Not set'}</span><Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onEdit}><Pencil /></Button></div>
}
