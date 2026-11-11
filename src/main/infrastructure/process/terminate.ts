import { spawn } from 'node:child_process'

export function descendants(root: number, listing: string): number[] {
  const children = new Map<number, number[]>()
  for (const line of listing.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (!match) continue
    const pid = Number(match[1]), parent = Number(match[2])
    if (pid <= 1 || pid === process.pid || pid === parent) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const result: number[] = [], visited = new Set([root])
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      if (visited.has(child)) continue
      visited.add(child); visit(child); result.push(child)
    }
  }
  visit(root)
  return result
}
function processListing(): Promise<string> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try { child = spawn('/bin/ps', ['-axo', 'pid=,ppid='], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { resolve(''); return }
    let output = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => { if (output.length < 1024 * 1024) output += chunk })
    child.on('error', () => { clearTimeout(timer); resolve('') })
    child.on('close', () => { clearTimeout(timer); resolve(output) })
  })
}
function signal(pid: number, value: NodeJS.Signals) { try { process.kill(pid, value) } catch { /* Already exited. */ } }
export async function terminateTree(pid: number, grouped = false): Promise<void> {
  if (pid <= 1 || pid === process.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => { child.kill(); resolve() }, 1500)
      child.on('error', () => { clearTimeout(timer); resolve() })
      child.on('close', () => { clearTimeout(timer); resolve() })
    })
    return
  }
  const targets = descendants(pid, await processListing())
  for (const target of targets) signal(target, 'SIGTERM')
  signal(grouped ? -pid : pid, 'SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 250))
  for (const target of targets) signal(target, 'SIGKILL')
  signal(grouped ? -pid : pid, 'SIGKILL')
}
