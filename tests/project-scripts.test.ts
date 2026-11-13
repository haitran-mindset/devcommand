import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectScriptsService, parseMakeTargets } from '../src/main/services/project-scripts/service'
import type { WorkspaceService } from '../src/main/services/workspace/service'
import type { TerminalManager } from '../src/main/services/terminal/manager'
vi.mock('../src/main/services/cli/probe', () => ({ findExecutable: (name: string) => `/fixture/bin/${name}` }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'devcommand-project-scripts-')); roots.push(root)
  const repo = join(root, 'project with spaces'); await mkdir(repo)
  const startProgram = vi.fn((program: { argv: string[]; cwd: string }) => ({ id: randomUUID(), shell: 'fixture', cwd: program.cwd, status: 'running' as const }))
  const service = new ProjectScriptsService({ resolve: vi.fn(async () => ({ rootPath: repo })) } as unknown as WorkspaceService, { startProgram } as unknown as TerminalManager)
  return { root, repo, service, startProgram, workspaceId: randomUUID() }
}
it('parses static Makefile rules without executing or expanding make expressions', () => {
  expect(parseMakeTargets(`.PHONY: dev\ndev build: deps\n\tbad: ignored\n%.o: %.c\n$(TARGET): x\nconfig: FOO=bar\ndefine rule\ninside: nope\nendef\nclean:: ; echo ok\n`)).toEqual(['dev', 'build', 'clean'])
})
it('discovers package scripts and make targets with runner selection and no execution', async () => {
  const f = await fixture()
  await writeFile(join(f.repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { dev: 'next dev', test: 'vitest', '--bad': 'echo no' } }))
  await writeFile(join(f.repo, 'Makefile'), 'dev build:\n\techo hi\n')
  const data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts.map(script => script.command)).toEqual(['pnpm run dev', 'pnpm run test', 'make -f Makefile -- dev', 'make -f Makefile -- build'])
  expect(data.warnings.length).toBeGreaterThan(0)
  expect(f.startProgram).not.toHaveBeenCalled()
})
it('rejects changed files and one-use token replay; runs exact argv in repository', async () => {
  const f = await fixture(), manifest = join(f.repo, 'package.json')
  await writeFile(manifest, JSON.stringify({ scripts: { dev: 'echo hello' } }))
  const data = await f.service.list({ workspaceId: f.workspaceId }), request = { workspaceId: f.workspaceId, id: 'package:dev', revision: data.revision }
  const preview = await f.service.preview(request)
  await f.service.run(request, preview.token)
  expect(f.startProgram).toHaveBeenCalledWith({ executable: '/fixture/bin/npm', argv: ['run', '--', 'dev'], cwd: data.cwd, label: 'dev', keepShell: true })
  await expect(f.service.run(request, preview.token)).rejects.toThrow(/Confirmation/)
  const next = await f.service.preview(request)
  await writeFile(manifest, JSON.stringify({ scripts: { dev: 'echo changed' } }))
  await expect(f.service.run(request, next.token)).rejects.toThrow(/changed/)
  expect(f.startProgram).toHaveBeenCalledTimes(1)
})
it('honors make filename precedence and invalidates previews after session reset', async () => {
  const f = await fixture()
  await writeFile(join(f.repo, 'GNUmakefile'), 'first:\n\ttrue\n')
  await writeFile(join(f.repo, 'Makefile'), 'second:\n\ttrue\n')
  const data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts.map(script => script.name)).toEqual(['first'])
  const request = { workspaceId: f.workspaceId, id: 'make:first', revision: data.revision }
  const preview = await f.service.preview(request); f.service.clear()
  await expect(f.service.run(request, preview.token)).rejects.toThrow(/Confirmation/)
  const fresh = await f.service.preview(request); await f.service.run(request, fresh.token)
  expect(f.startProgram.mock.calls[0][0].argv).toEqual(['-f', 'GNUmakefile', '--', 'first'])
})
it('handles missing/malformed files and refuses files outside repository or oversized input', async () => {
  const f = await fixture()
  expect((await f.service.list({ workspaceId: f.workspaceId })).scripts).toEqual([])
  await writeFile(join(f.repo, 'package.json'), 'invalid')
  expect((await f.service.list({ workspaceId: f.workspaceId })).warnings.join(' ')).toMatch(/parse/)
  await rm(join(f.repo, 'package.json'))
  await writeFile(join(f.root, 'outside.json'), '{"scripts":{"secret":"echo no"}}')
  await symlink(join(f.root, 'outside.json'), join(f.repo, 'package.json'))
  expect((await f.service.list({ workspaceId: f.workspaceId })).scripts).toEqual([])
  await writeFile(join(f.repo, 'Makefile'), 'a'.repeat(1_048_577))
  expect((await f.service.list({ workspaceId: f.workspaceId })).warnings.join(' ')).toMatch(/1 MB/)
})

it('copy/preview pins the chosen make file even if a higher precedence file is unreadable', async () => {
  const f = await fixture()
  await writeFile(join(f.repo, 'GNUmakefile'), 'x'.repeat(1_048_577))
  await writeFile(join(f.repo, 'Makefile'), 'hello:\n\ttrue\n')
  const data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts[0].sourceFile).toBe('Makefile')
  expect(data.scripts[0].command).toBe('make -f Makefile -- hello')
  expect(data.scripts[0].args).toEqual(['-f', 'Makefile', '--', 'hello'])
})
it('discovers only direct regular shell files, preserves shell choice/options and hashes script changes', async () => {
  const f = await fixture()
  await mkdir(join(f.repo, 'scripts'))
  await mkdir(join(f.repo, 'scripts', 'nested'))
  await writeFile(join(f.repo, 'deploy.sh'), '#!/bin/bash -eu\n# Deploy locally\necho safe\n')
  await writeFile(join(f.repo, 'scripts', 'build app.sh'), '#!/usr/bin/env zsh\necho build\n')
  await writeFile(join(f.repo, 'scripts', 'nested', 'ignored.sh'), 'echo no\n')
  await writeFile(join(f.repo, 'unsupported.sh'), '#!/usr/bin/python3\nprint(1)\n')
  await symlink(join(f.repo, 'deploy.sh'), join(f.repo, 'alias.sh'))
  const data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts.map(script => script.sourceFile)).toEqual(['deploy.sh', 'scripts/build app.sh'])
  expect(data.scripts[0].args).toEqual(['-eu', './deploy.sh'])
  expect(data.scripts[1].command).toBe("zsh './scripts/build app.sh'")
  expect(f.startProgram).not.toHaveBeenCalled()
  const request = { workspaceId: f.workspaceId, id: 'shell:deploy.sh', revision: data.revision }
  const preview = await f.service.preview(request)
  await writeFile(join(f.repo, 'deploy.sh'), '#!/bin/bash -eu\necho changed\n')
  await expect(f.service.run(request, preview.token)).rejects.toThrow(/changed/)
})
it('does not discover scripts from a directory symlink outside the repository', async () => {
  const f = await fixture(), outside = join(f.root, 'outside')
  await mkdir(outside); await writeFile(join(outside, 'outside.sh'), 'echo no\n')
  await symlink(outside, join(f.repo, 'scripts'))
  const data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts).toEqual([])
  expect(data.warnings.join(' ')).toMatch(/outside/)
})
it('bounds rejected candidates as well as total script bytes', async () => {
  const f = await fixture()
  await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(join(f.repo, `${String(index).padStart(3, '0')}.sh`), '#!/usr/bin/python3\nprint(1)\n')))
  let data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts).toEqual([])
  expect(data.warnings.join(' ')).toMatch(/200 shell script candidates/)
  await Promise.all(Array.from({ length: 201 }, (_, index) => rm(join(f.repo, `${String(index).padStart(3, '0')}.sh`))))
  const content = '#!/bin/sh\n# ' + 'x'.repeat(1_048_564)
  await Promise.all(Array.from({ length: 10 }, (_, index) => writeFile(join(f.repo, `${index}.sh`), content)))
  data = await f.service.list({ workspaceId: f.workspaceId })
  expect(data.scripts).toHaveLength(8)
  expect(data.warnings.join(' ')).toMatch(/8 MB/)
})
