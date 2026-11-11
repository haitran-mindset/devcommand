import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import { WorkspaceService, gitProbe } from '../workspace/service'

/** One selected repository at a time, with bounded/debounced renderer notifications. */
export class GitWatcher {
  private id: string | null = null
  private generation = 0
  private expectedCount = 0
  private watchers: FSWatcher[] = []
  private pending?: Promise<boolean>
  private timer?: ReturnType<typeof setTimeout>
  constructor(private workspace: WorkspaceService, private changed: (id: string) => void) {}
  private stop() { clearTimeout(this.timer); this.watchers.forEach((watcher) => watcher.close()); this.watchers = [] }
  watch(id: string): Promise<boolean> {
    if (this.id === id) return this.pending ?? Promise.resolve(this.expectedCount > 0 && this.watchers.length === this.expectedCount)
    this.stop(); this.id = id
    const generation = ++this.generation
    const pending = this.attach(id, generation)
    this.pending = pending
    void pending.finally(() => { if (generation === this.generation) this.pending = undefined })
    return pending
  }
  private async attach(id: string, generation: number): Promise<boolean> {
    try {
      const workspace = await this.workspace.resolve(id)
      const [gitDir, commonDir] = await Promise.all([gitProbe(workspace.rootPath, ['rev-parse', '--absolute-git-dir']), gitProbe(workspace.rootPath, ['rev-parse', '--git-common-dir'])])
      if (generation !== this.generation) return false
      const paths = [...new Set([workspace.rootPath, resolve(workspace.rootPath, gitDir), resolve(workspace.rootPath, commonDir)])]
      const notify = (path: string, filename: string | Buffer | null) => {
        if (generation !== this.generation) return
        const name = filename?.toString().replaceAll('\\', '/') ?? ''
        if (path === workspace.rootPath && /^(node_modules|\.git)(\/|$)/.test(name)) return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => { if (generation === this.generation) this.changed(id) }, 180)
      }
      this.expectedCount = paths.length
      for (const path of paths) {
        try {
          const watcher = watch(path, { recursive: process.platform === 'darwin' || process.platform === 'win32', persistent: false }, (_event, filename) => notify(path, filename))
          watcher.on('error', () => { watcher.close(); this.watchers = this.watchers.filter((entry) => entry !== watcher) })
          this.watchers.push(watcher)
        } catch { /* Snapshot polling and focus refresh remain available. */ }
      }
      return this.watchers.length === paths.length
    } catch { return false }
  }
  async clear() {
    ++this.generation; this.id = null; this.stop()
    const pending = this.pending; this.pending = undefined
    await pending
  }
}
