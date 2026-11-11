# Git Manager — Phase 4

**Goal:** Deliver Git overview/status, config, remotes, branches, commit history and basic stash screens backed by real local Git.
**Architecture:** Add narrow validated read APIs to the existing IPC boundary. Mutations continue through the trusted registry, Phase 3 preview/confirmation, managed execution and redacted history. Reuse application layout, workspace selection, theme and terminal.
**Spec:** `/Users/df/Downloads/DEVCOMMAND_AGENT_SPEC.md`, Phase 4. Next-phase implementation authorized in chat.

## Tasks
- [x] Shared Git snapshot/diff contracts and strict request schemas; parser tests for NUL-separated paths/renames and records.
- [x] Git reader service for status files, staged/unstaged diffs, local/global/effective allowlisted config with origin, remotes, branches/worktrees/merged state, paged commit log and stash metadata. Bound probes and disable external diff/textconv/hooks; no arbitrary process/path IPC.
- [x] Extend trusted registry with stage/unstage, branch rename, stash pop/drop; validate literal repository-relative changed paths, unborn unstage behavior, unmerged/current/linked-worktree branch checks, stash identity and contextual warnings. Preserve one-time request/state-bound confirmation and redaction.
- [x] Add Git Manager tabs, existing Config/Remote route compatibility, loading/empty/error/conflict/bare/unborn states, per-row actions and reusable confirmation/execution panel. Refresh after mutations and debounced filesystem changes, with focus/poll fallback.
- [x] Test temp repositories: stage/unstage, Unicode/space/magic paths, rename/unmerged branches, remote/config consistency, commit pagination, stash apply/pop/drop and stale stash confirmations. No mutation of the project repository.
- [x] Verify lint/typecheck/unit/integration/build and Electron E2E on source and packaged macOS ARM64, retaining Phase 1–3 regression suites; request code review and document limitations.

## Main files
- `src/shared/git.ts`: snapshot, diff, paging and config key contracts.
- `src/main/services/git/{parse,service}.ts`: parsing and Git queries.
- `src/main/services/commands/{registry,service}.ts`: new trusted commands and safety policy.
- `src/main/services/workspace/service.ts`: literal-path Git probes and repository fingerprint.
- `src/main/ipc/runtime.ts`, `src/preload/index.ts`: allowlisted Git read methods and refresh events.
- `src/renderer/src/features/git/{GitManager,GitAction}.tsx`: six tabs and managed mutation review/results.
- `tests/git.test.ts`, `tests/e2e/git.mjs`: isolated real-Git correctness and GUI/CLI parity.

## Boundaries
No commit creation, merge resolution editor, force deletion/push, rebase/cherry-pick, SSH management. Config edits stay on the existing safe key allowlist. Windows/Linux/Intel macOS are not claimed verified. No project commits, push or publishing.

## Verification record
- `npm run lint`, `npm run typecheck`, `npm run build`: pass.
- `npm test`: 40 tests across seven files cover the existing foundation/runtime/workspace suites and Git Manager real-repository fixtures.
- Git coverage includes NUL rename/status parsing, literal/magic/Unicode paths, no shell execution from filenames, stage/unstage before the first commit, both rename paths, config scope/origin, remote/branch parity, unmerged/linked-worktree guards, commit pagination, stash apply/pop/drop/conflicts, stale stash OIDs, trailing-whitespace fingerprints, shared worktree resource locks, and watcher debounce/cleanup.
- Code review findings fixed: stale stash row identities before preview, immutable stash diff targets, open-diff polling/focus/manual refresh. Explicit stash object IDs remain bound after preview as well.
- `npm run pack`: macOS ARM64 application packages with existing native PTY/SQLite support.
- All four Electron suites (`test:e2e`, `test:e2e:runtime`, `test:e2e:workspace`, `test:e2e:git`) pass against both source build and packaged `.app`.
- GUI/CLI parity verified for stage/unstage/diff, config local edits, remote add/rename/remove, branch create/switch/rename/delete, commit inspection, stash save/apply/pop/drop and a real conflict banner.
- No project repository was initialized or mutated; Git fixture commits/worktrees are isolated in temporary directories and cleaned up. No dependencies added, no publishing and no Phase 5 implementation.
- Tested macOS ARM64 with Git 2.55.0. Windows/Linux/Intel macOS, release signing/notarization, unusual Git versions and automatic conflict resolution remain unverified/outside scope.
