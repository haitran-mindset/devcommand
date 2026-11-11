# Command Explorer & Workspace — Phase 3

**Goal:** Select a real local Git repository, discover/configure trusted commands, preview/copy/insert/run them, and retain redacted history and favorites.
**Architecture:** Existing sandboxed renderer → strict typed IPC → workspace service / command policy → Phase 2 runner → SQLite repository. Paths come from a native directory picker and persisted IDs; executable/argv never come from the renderer.
**Spec:** `/Users/df/Downloads/DEVCOMMAND_AGENT_SPEC.md`, Phase 3; next-phase implementation authorized in chat.

## Deliverables
- [x] Version 2 database migration preserving settings; workspaces, command favorites, bounded redacted managed history and active workspace.
- [x] Native Git directory picker; list/select/favorite/remove entries without deleting files. Detect canonical root, branch, clean/dirty, detached/unborn/bare and remotes. Refresh after execution and on window focus/poll.
- [x] Trusted declarative Git/general registry, strict dynamic parameter schemas, search aliases, category/risk/platform filters, keyboard command palette and prerequisites.
- [x] Backend preview with exact argv display, old/new remote context and contextual consequences. One-time short-lived request+repository-state-bound confirmation for all mutating commands; revalidate immediately before execution. No dangerous operation without tests.
- [x] Replace reference explorer with real forms, details/examples, copy, safe insert without Enter and managed execution output/cancellation. Terminal insertion starts a fresh shell in the selected repository and clears input before a bracketed paste.
- [x] Favorites and persistent History with status filtering and rerun through fresh preview/validation. Avoid storing secret parameters; reject credential-bearing URLs. Record only redacted output with bounded retention.
- [x] Unit/temp-Git integration tests for policies/tokens/injection/migrations, IPC and actual Electron E2E including remote URL journey. Run lint/typecheck/tests/build/macOS packaging and regression suites.

## Scope boundaries
No Phase 4 Git Manager pages, SSH command pack, clone UI, external editor launching or arbitrary user-authored command definitions. Existing PTY/Process Core and Phase 1 preferences remain functional. macOS ARM64 is primary; document unverified platforms.

## Files
- `src/shared/commands.ts`: public command/workspace/preview/history types and strict IPC schemas.
- `src/main/services/workspace/service.ts`: bounded Git probe, canonical repository identity, context snapshots.
- `src/main/services/commands/{registry,service}.ts`: declarative templates, constraints and confirmation/execution policy.
- `src/main/infrastructure/database/{schema,store}.ts`: transactional migration and bounded data repositories.
- `src/main/ipc/{workspace,runtime}.ts`: native picker, command/favorites/history and terminal insert endpoints.
- `src/renderer/src/features/{commands,workspace,history}/`: actual UI backed by TanStack Query.
- `tests/commands.test.ts`, `tests/workspace.test.ts`, `tests/e2e/workspace.mjs`: meaningful native boundary/journey verification.

## Validation approach
Use temporary repositories only for mutations. Test stale/reused/expired/mismatched confirmations, command option/shell injection, dirty/unborn/detached/bare repositories, missing tools/paths, output/history redaction, favorite/selection persistence, terminal insert without execution, and regression of Phases 1–2. No Git commits in the project itself; temporary fixture commits are explicitly isolated test setup.

## Verification record
- `npm run lint`, `npm run typecheck`, `npm run build`: pass.
- `npm test`: 30 tests pass across six files, including migration, canonical Git roots, clean/dirty/detached/unborn/bare state, credential/option injection, token expiry/reuse/mismatch/stale index, sensitive values and history write failure.
- Dangerous remote removal, merged-branch deletion, restore, mixed/hard reset were tested only inside isolated temporary repositories with explicit confirmations.
- Reviewer finding fixed: fingerprint now includes the index, complete porcelain data and binary diffs; a staged-to-unstaged regression proves stale confirmations are refused.
- History rerun selects the original workspace before opening the builder; confirmation shows the target directory explicitly.
- `npm run pack`: macOS ARM64 `.app` builds successfully, retaining Phase 2 native PTY packaging.
- All three Electron suites (`test:e2e`, `test:e2e:runtime`, `test:e2e:workspace`) pass against both source build and packaged `.app`.
- Workspace E2E stubs only the native picker result in privileged test code; actual IPC, filesystem/Git operations, persistence, confirmation and terminal insertion remain real.
- Corrected the installed Playwright asynchronous-predicate wait issue using explicit awaited IPC polling; reran Phase 1–2 regressions using the helper.
- No new dependencies, no project Git commit/push, no Phase 4 work. Windows/Linux/Intel macOS and release signing remain unverified.
