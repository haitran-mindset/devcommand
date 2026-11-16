import { copyText } from '../../lib/clipboard'
import { SelectField } from '../../components/ui/select-field'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, Copy, Folder, KeyRound, LogOut, Pencil, Plus, Radio, RefreshCw, Server, ShieldCheck, Terminal, Trash2, X } from 'lucide-react'
import { sshKeyTypes, type SshKeyType, type SshAction, type SshHost, type SshKey } from '../../../../shared/extended'
import { Button } from '../../components/ui/button'
import { unwrap } from '../../lib/settings'
import { ExtendedAction } from '../execution/ExtendedAction'

const blank: SshHost = { alias: '', hostName: '', user: '', port: 22, identityName: '', editable: true }

export function SshManager({ notify }: { notify: (message: string) => void }) {
  const client = useQueryClient()
  const snapshot = useQuery({ queryKey: ['ssh'], queryFn: async () => unwrap(await window.devcommand.ssh.snapshot()), retry: false })
  const [action, setAction] = useState<SshAction | null>(null)
  const [editingCommentKey, setEditingCommentKey] = useState<SshKey | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [editingHost, setEditingHost] = useState<SshHost | null>(null)
  const [deleteKeyName, setDeleteKeyName] = useState('')

  useEffect(() => window.devcommand.ssh.onChanged(() => { void client.invalidateQueries({ queryKey: ['ssh'] }) }), [client])

  const data = snapshot.data
  const selectedDeleteKey = data?.keys.find((k) => k.name === deleteKeyName)
  const isLoaded = (fingerprint: string) => data?.agent.identities.some((line) => line.split(/\s+/).includes(fingerprint)) ?? false

  return (
    <section className="panel ssh-manager">
      <header className="ssh-header">
        <span className="ssh-heading-icon"><KeyRound /></span>
        <div>
          <h1>SSH Manager</h1>
          <p>Your keys, agent and connections in one place.</p>
        </div>
        <Button variant="outline" size="sm" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>
          <RefreshCw className={snapshot.isFetching ? 'animate-spin' : undefined} />
          Refresh SSH
        </Button>
      </header>

      {snapshot.isPending && (
        <div className="ssh-empty" role="status">
          <KeyRound />
          <p>Reading public SSH metadata…</p>
        </div>
      )}
      {snapshot.isError && <p role="alert" className="ssh-feedback terminal-error">{snapshot.error.message}</p>}

      {data && (
        <>
          <div className="ssh-context">
            <span className="ssh-directory" title={data.directory}>
              <Folder />
              <code>{data.directory}</code>
            </span>
            <span className="ssh-context-label">
              <ShieldCheck />
              Local SSH configuration
            </span>
          </div>

          <div className="ssh-layout">
            <div className="ssh-main-column">
              <section className="ssh-section" aria-labelledby="ssh-keys-title">
                <header className="ssh-section-header">
                  <KeyRound />
                  <h2 id="ssh-keys-title">Public keys</h2>
                  <span className="ssh-count">{data.keys.length}</span>
                  <Button
                    size="sm"
                    className="ssh-header-action"
                    disabled={!data.writable || !data.tools['ssh-keygen']}
                    onClick={() => setShowGenerateModal(true)}
                  >
                    <Plus className="size-3.5" />
                    Generate key
                  </Button>
                </header>

                {!data.tools['ssh-keygen'] && <p className="ssh-section-note">ssh-keygen is unavailable. Install OpenSSH and refresh.</p>}

                {data.keys.length === 0 && (
                  <div className="ssh-empty">
                    <KeyRound />
                    <h3>No supported public keys found.</h3>
                    <p>Generate a key to get started, or add an existing public key to your SSH directory.</p>
                    <Button
                      size="sm"
                      disabled={!data.writable || !data.tools['ssh-keygen']}
                      onClick={() => setShowGenerateModal(true)}
                    >
                      <Plus className="size-3.5" />
                      Generate key
                    </Button>
                  </div>
                )}

                <div className="ssh-key-list">
                  {data.keys.map((key) => (
                    <article className="ssh-key-row" key={key.name}>
                      <span className="ssh-item-icon"><KeyRound /></span>
                      <div className="ssh-item-info">
                        <div className="ssh-item-title">
                          <strong title={key.name}>{key.name}</strong>
                          <span className="ssh-type">{key.type.replace('ssh-', '')}</span>
                          {isLoaded(key.fingerprint) && (
                            <span className="ssh-agent-badge" title="Loaded in SSH Agent">
                              <Check className="size-3" />
                              In agent
                            </span>
                          )}
                        </div>
                        <div className="ssh-key-comment-row">
                          {key.comment ? (
                            <p className="ssh-key-comment">{key.comment}</p>
                          ) : (
                            <p className="ssh-key-comment is-empty">No comment</p>
                          )}
                        </div>
                        <code className="ssh-fingerprint" title={key.fingerprint}>{key.fingerprint}</code>
                        {!key.privateAvailable && <small>Private key unavailable</small>}
                      </div>
                      <div className="ssh-row-actions">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label="Copy public key"
                          title="Copy public key"
                          onClick={() => {
                            void window.devcommand.ssh.publicKey(key.name)
                              .then(unwrap)
                              .then(copyText)
                              .then(() => notify('Public key copied.'))
                              .catch((failure: unknown) => notify(failure instanceof Error ? failure.message : 'Unable to copy public key.'))
                          }}
                        >
                          <Copy />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Change comment for ${key.name}`}
                          title={
                            !data.tools['ssh-keygen']
                              ? 'ssh-keygen is unavailable'
                              : !data.writable
                                ? 'SSH modification is unavailable on Windows'
                                : !key.privateAvailable
                                  ? 'A private key with safe permissions is required to change comment'
                                  : 'Change comment / email'
                          }
                          disabled={!data.tools['ssh-keygen'] || !data.writable || !key.privateAvailable}
                          onClick={() => setEditingCommentKey(key)}
                        >
                          <Pencil />
                        </Button>
                        {isLoaded(key.fingerprint) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ssh-unload-btn"
                            aria-label={`Remove ${key.name} from agent`}
                            title="Remove this key from SSH agent (ssh-add -d). Key files on disk remain safe."
                            disabled={!data.agent.available}
                            onClick={() => setAction({ kind: 'agent.remove', publicKeyName: key.name, fingerprint: key.fingerprint })}
                          >
                            <LogOut className="size-3.5" />
                            Remove from agent
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!data.tools['ssh-add'] || !data.agent.available || !key.privateAvailable}
                            title={
                              !key.privateAvailable
                                ? 'A private key with safe permissions is required.'
                                : !data.agent.available
                                  ? 'Start your OS SSH agent first.'
                                  : 'Add this key to agent'
                            }
                            onClick={() => setAction({ kind: 'agent.add', publicKeyName: key.name, fingerprint: key.fingerprint, lifetimeSeconds: 'unlimited' })}
                          >
                            <ArrowUpRight className="size-3.5" />
                            Add to agent
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="ssh-section ssh-agent" aria-labelledby="ssh-agent-title">
                <header className="ssh-section-header">
                  <Radio />
                  <h2 id="ssh-agent-title">SSH agent</h2>
                  <span className={`ssh-agent-status ${data.agent.available ? 'is-available' : ''}`}>
                    <i />
                    {data.agent.available ? 'Available' : 'Unavailable'}
                  </span>
                </header>
                <div className="ssh-agent-body">
                  <div className="ssh-agent-summary">
                    <div>
                      <p>{data.agent.message}</p>
                      <code>ssh-add -l -E sha256</code>
                    </div>
                    <Button size="sm" variant="outline" disabled={snapshot.isFetching} onClick={() => void snapshot.refetch()}>
                      <RefreshCw />
                      Refresh agent
                    </Button>
                  </div>
                  {data.agent.identities.length > 0 && (
                    <div className="ssh-identities">
                      {data.agent.identities.map((line, index) => <pre key={index}>{line}</pre>)}
                    </div>
                  )}
                  <p className="ssh-agent-scope">The agent is shared by your repositories. Identities loaded into the agent remain available across all projects.</p>
                </div>
              </section>

              <section className="ssh-section" aria-labelledby="ssh-hosts-title">
                <header className="ssh-section-header">
                  <Server />
                  <h2 id="ssh-hosts-title">Host aliases</h2>
                  <span className="ssh-count">{data.hosts.length}</span>
                  <Button
                    size="sm"
                    className="ssh-header-action"
                    disabled={!data.writable}
                    onClick={() => setEditingHost({ ...blank })}
                  >
                    <Plus className="size-3.5" />
                    Add host alias
                  </Button>
                </header>
                <p className="ssh-section-note">Named connections let each project use the right server and identity.</p>

                {data.hosts.length === 0 && (
                  <div className="ssh-empty">
                    <Server />
                    <h3>No Host aliases configured.</h3>
                    <p>Add an alias such as github-work to keep your accounts separate.</p>
                    <Button
                      size="sm"
                      disabled={!data.writable}
                      onClick={() => setEditingHost({ ...blank })}
                    >
                      <Plus className="size-3.5" />
                      Add host alias
                    </Button>
                  </div>
                )}

                {data.hosts.map((entry, index) => (
                  <article className="ssh-host-row" key={`${entry.alias}:${index}`}>
                    <span className="ssh-item-icon"><Server /></span>
                    <div className="ssh-item-info">
                      <strong title={entry.alias}>{entry.alias}</strong>
                      <p className="ssh-host-address">{entry.user}@{entry.hostName}:{entry.port}</p>
                      {entry.reason && <small>{entry.reason}</small>}
                    </div>
                    <div className="ssh-row-actions">
                      <Button size="sm" variant="outline" disabled={!data.tools.ssh} onClick={() => setAction({ kind: 'connection.test', alias: entry.alias, revision: data.revision })}>
                        <Terminal />
                        Test connection
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit host"
                        title={`Edit ${entry.alias}`}
                        disabled={!entry.editable || !data.writable}
                        onClick={() => setEditingHost({ ...entry })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        className="ssh-remove"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove host"
                        title={`Remove ${entry.alias}`}
                        disabled={!entry.editable || !data.writable}
                        onClick={() => setAction({ kind: 'host.remove', alias: entry.alias, revision: data.revision })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </article>
                ))}
              </section>

              <section className="ssh-section ssh-danger-section" aria-labelledby="ssh-danger-title">
                <header className="ssh-section-header">
                  <Trash2 />
                  <h2 id="ssh-danger-title">Delete SSH key</h2>
                </header>
                <p className="ssh-section-note">
                  Permanently remove both private and public key files from your SSH directory (~/.ssh). If loaded in the SSH Agent, the identity will also be unloaded.
                </p>
                <div className="ssh-delete-body">
                  <div className="ssh-delete-controls">
                    <label className="ssh-delete-label">
                      <span>Select SSH key to delete</span>
                      <SelectField
                        label="SSH key"
                        value={selectedDeleteKey?.name ?? ''}
                        onValueChange={setDeleteKeyName}
                        disabled={!data.keys.length || !data.writable}
                        options={[
                          { value: '', label: 'Select an SSH key…' },
                          ...data.keys.map((k) => ({
                            value: k.name,
                            label: `${k.name.replace(/\.pub$/, '')} (${k.type.replace('ssh-', '')}${k.comment ? ` · ${k.comment}` : ''})`
                          }))
                        ]}
                        className="w-full"
                      />
                    </label>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!data.writable || !selectedDeleteKey}
                      onClick={() => {
                        if (selectedDeleteKey) {
                          setAction({
                            kind: 'key.delete',
                            publicKeyName: selectedDeleteKey.name,
                            fingerprint: selectedDeleteKey.fingerprint
                          })
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      Delete SSH key
                    </Button>
                  </div>
                </div>
              </section>

              {data.notices.length > 0 && (
                <details className="ssh-notices">
                  <summary><ShieldCheck />Connection diagnostics</summary>
                  {data.notices.map((notice) => <p key={notice}>{notice}</p>)}
                </details>
              )}
            </div>
          </div>
        </>
      )}

      {showGenerateModal && data && (
        <GenerateKeyModal
          writable={data.writable}
          keygenAvailable={!!data.tools['ssh-keygen']}
          onCancel={() => setShowGenerateModal(false)}
          onSubmit={(keyType, keyName, comment) => {
            setAction({ kind: 'key.generate', keyType, name: keyName, comment })
            setShowGenerateModal(false)
          }}
        />
      )}

      {editingHost && data && (
        <HostConfigModal
          host={editingHost}
          keys={data.keys}
          writable={data.writable}
          onCancel={() => setEditingHost(null)}
          onSubmit={(updatedHost) => {
            const isEditing = Boolean(editingHost.alias && data.hosts.some((h) => h.alias === editingHost.alias))
            setAction({
              kind: isEditing ? 'host.update' : 'host.add',
              alias: updatedHost.alias,
              hostName: updatedHost.hostName,
              user: updatedHost.user,
              port: updatedHost.port,
              identityName: updatedHost.identityName,
              revision: data.revision
            })
            setEditingHost(null)
          }}
        />
      )}

      {editingCommentKey && (
        <KeyCommentModal
          sshKey={editingCommentKey}
          onCancel={() => setEditingCommentKey(null)}
          onSubmit={(newComment) => {
            setAction({ kind: 'key.comment', publicKeyName: editingCommentKey.name, fingerprint: editingCommentKey.fingerprint, comment: newComment })
            setEditingCommentKey(null)
          }}
        />
      )}

      {action && <ExtendedAction module="ssh" action={action} onClose={() => setAction(null)} />}
    </section>
  )
}

function KeyCommentModal({
  sshKey,
  onCancel,
  onSubmit
}: {
  sshKey: SshKey
  onCancel: () => void
  onSubmit: (newComment: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [newComment, setNewComment] = useState(sshKey.comment || '')

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    el.showModal()
    const onClose = () => onCancel()
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [onCancel])

  const handleBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    const rect = dialog.current?.getBoundingClientRect()
    if (!rect) return
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      dialog.current?.close()
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit(newComment.trim())
  }

  const baseName = sshKey.name.replace(/\.pub$/, '')

  return (
    <dialog ref={dialog} className="ssh-dialog" onClick={handleBackdrop}>
      <form className="ssh-dialog-form" onSubmit={handleSubmit} aria-label={`Change comment for ${sshKey.name}`}>
        <header className="ssh-dialog-header">
          <span className="ssh-dialog-header-icon"><Pencil /></span>
          <div className="ssh-dialog-header-text">
            <h2>Change Key Comment / Email</h2>
            <p>Update the comment in <code>{sshKey.name}</code> without regenerating keys.</p>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" className="ssh-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="ssh-dialog-body">
          <div className="ssh-dialog-key-card">
            <div className="ssh-dialog-key-meta">
              <span className="ssh-dialog-key-name"><KeyRound className="size-3.5" />{sshKey.name}</span>
              <span className="ssh-type">{sshKey.type.replace('ssh-', '')}</span>
            </div>
            <code className="ssh-fingerprint">{sshKey.fingerprint}</code>
          </div>

          <label className="ssh-dialog-field" htmlFor="ssh-comment-input">
            <span>New comment or email</span>
            <input
              id="ssh-comment-input"
              autoFocus
              maxLength={120}
              placeholder="e.g. you@example.com or work-laptop"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
          </label>

          <div className="ssh-dialog-note">
            <ShieldCheck />
            <span>
              Preserves your key pair and fingerprint. Updates both <code>{baseName}</code> and <code>{sshKey.name}</code>. Enter any passphrase in the terminal if prompted.
            </span>
          </div>
        </div>

        <div className="ssh-dialog-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Review change
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function GenerateKeyModal({
  writable,
  keygenAvailable,
  onCancel,
  onSubmit
}: {
  writable: boolean
  keygenAvailable: boolean
  onCancel: () => void
  onSubmit: (keyType: SshKeyType, keyName: string, comment: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [keyType, setKeyType] = useState<SshKeyType>('ed25519')
  const [keyName, setKeyName] = useState('id_ed25519_devcommand')
  const [comment, setComment] = useState('')

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    el.showModal()
    const onClose = () => onCancel()
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [onCancel])

  const handleBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    const rect = dialog.current?.getBoundingClientRect()
    if (!rect) return
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      dialog.current?.close()
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit(keyType, keyName.trim(), comment.trim())
  }

  return (
    <dialog ref={dialog} className="ssh-dialog" onClick={handleBackdrop}>
      <form className="ssh-dialog-form" onSubmit={handleSubmit} aria-label="Generate SSH key">
        <header className="ssh-dialog-header">
          <span className="ssh-dialog-header-icon"><Plus /></span>
          <div className="ssh-dialog-header-text">
            <h2>Generate SSH key</h2>
            <p>Create a new identity for a Git provider or remote server.</p>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" className="ssh-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="ssh-dialog-body">
          <label className="ssh-dialog-field">
            <span>Key type</span>
            <SelectField
              label="Key type"
              value={keyType}
              onValueChange={(value) => {
                const next = value as SshKeyType
                if (keyName === `id_${keyType}_devcommand`) setKeyName(`id_${next}_devcommand`)
                setKeyType(next)
              }}
              options={sshKeyTypes.map((value) => ({
                value,
                label: value === 'rsa' ? 'RSA · 4096-bit' : 'Ed25519'
              }))}
              className="w-full"
            />
          </label>

          <label className="ssh-dialog-field" htmlFor="ssh-generate-name">
            <span>Key basename</span>
            <input
              id="ssh-generate-name"
              required
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </label>

          <label className="ssh-dialog-field" htmlFor="ssh-generate-comment">
            <span>Public comment (optional)</span>
            <input
              id="ssh-generate-comment"
              maxLength={120}
              placeholder="you@example.com"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>

          <div className="ssh-dialog-note">
            <ShieldCheck />
            <span>The passphrase is entered in the terminal after confirmation. Passphrases are never saved.</span>
          </div>
        </div>

        <div className="ssh-dialog-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!writable || !keygenAvailable}>
            <CheckCircle2 className="size-3.5" />
            Review key generation
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function HostConfigModal({
  host,
  keys,
  writable,
  onCancel,
  onSubmit
}: {
  host: SshHost
  keys: SshKey[]
  writable: boolean
  onCancel: () => void
  onSubmit: (host: SshHost) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const isEditing = Boolean(host.alias && host.editable)
  const [formState, setFormState] = useState<SshHost>({ ...host })

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    el.showModal()
    const onClose = () => onCancel()
    el.addEventListener('close', onClose)
    return () => el.removeEventListener('close', onClose)
  }, [onCancel])

  useEffect(() => {
    if (isEditing) {
      dialog.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    }
  }, [isEditing])

  const handleBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    const rect = dialog.current?.getBoundingClientRect()
    if (!rect) return
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      dialog.current?.close()
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit(formState)
  }

  return (
    <dialog ref={dialog} className="ssh-dialog" onClick={handleBackdrop}>
      <form className="ssh-dialog-form" onSubmit={handleSubmit} aria-label={isEditing ? `Edit ${host.alias}` : 'Add host alias'}>
        <header className="ssh-dialog-header">
          <span className="ssh-dialog-header-icon">{isEditing ? <Pencil /> : <Server />}</span>
          <div className="ssh-dialog-header-text">
            <h2>{isEditing ? `Edit ${host.alias}` : 'Add host alias'}</h2>
            <p>Choose a short name, destination and SSH identity.</p>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" className="ssh-dialog-close" aria-label="Close" onClick={() => dialog.current?.close()}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="ssh-dialog-body">
          <div className="ssh-dialog-grid">
            <label className="ssh-dialog-field" htmlFor="ssh-host-alias">
              <span>Host alias</span>
              <input
                id="ssh-host-alias"
                required
                disabled={isEditing}
                placeholder="github-work"
                maxLength={64}
                value={formState.alias}
                onChange={(e) => setFormState({ ...formState, alias: e.target.value })}
              />
            </label>

            <label className="ssh-dialog-field" htmlFor="ssh-host-name">
              <span>Hostname</span>
              <input
                id="ssh-host-name"
                required
                placeholder="github.com"
                maxLength={253}
                value={formState.hostName}
                onChange={(e) => setFormState({ ...formState, hostName: e.target.value })}
              />
            </label>
          </div>

          <div className="ssh-dialog-grid">
            <label className="ssh-dialog-field" htmlFor="ssh-host-user">
              <span>SSH user</span>
              <input
                id="ssh-host-user"
                required
                placeholder="git"
                maxLength={64}
                value={formState.user}
                onChange={(e) => setFormState({ ...formState, user: e.target.value })}
              />
            </label>

            <label className="ssh-dialog-field" htmlFor="ssh-host-port">
              <span>SSH port</span>
              <input
                id="ssh-host-port"
                type="number"
                required
                min={1}
                max={65535}
                value={formState.port}
                onChange={(e) => setFormState({ ...formState, port: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="ssh-dialog-field">
            <span>Identity</span>
            <SelectField
              label="Identity"
              value={formState.identityName}
              onValueChange={(value) => setFormState({ ...formState, identityName: value })}
              options={[
                { value: '', label: 'Use OS default / agent' },
                ...keys.filter((key) => key.privateAvailable).map((key) => ({
                  value: key.name.slice(0, -4),
                  label: key.name.slice(0, -4)
                }))
              ]}
              className="w-full"
            />
          </label>

          <div className="ssh-dialog-note">
            <ShieldCheck />
            <span>Configures <code>~/.ssh/config</code>. A backup is created before saving changes.</span>
          </div>
        </div>

        <div className="ssh-dialog-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!writable}>
            <CheckCircle2 className="size-3.5" />
            Review host config
          </Button>
        </div>
      </form>
    </dialog>
  )
}
