# Terminal & Process Core Implementation Plan

**Goal:** Implement Phase 2: real PTY terminal and a separate, safe managed process runner.
**Architecture:** Sandboxed renderer → typed preload → sender-validated IPC → per-window services. PTY sessions use installed shell allowlists and backend-selected home cwd. Managed execution accepts only read-only built-in command IDs, never executable paths, argv or shell strings from the renderer.
**Tech Stack:** Existing Electron/React/TypeScript stack, node-pty, @xterm/xterm, @xterm/addon-fit, Zod, Vitest, Playwright Electron.
**Spec:** `/Users/df/Downloads/DEVCOMMAND_AGENT_SPEC.md`, Phase 2; user authorized next phase in chat.

## Constraints
- No repository-management, mutating Git commands, secrets persistence or Phase 3 command builder in this change.
- PTY is a trusted local-user shell with ordinary OS permissions. No automatic keystroke/terminal-output persistence.
- Preserve Phase 1 settings schema and database. Shell cwd and process options remain backend-owned.
- Test macOS ARM64 packaging; document Windows/Linux limitations. No commits or publishing.

## Tasks
- [x] Extend shared contracts and preload with strict terminal/process payloads and unsubscribe-based event APIs.
- [x] Implement terminal service: installed shell selection, home cwd validation, bounded session count, chunked output with acknowledgement/backpressure, resize/input, close/exit lifecycle and per-window cleanup.
- [x] Implement managed process runner: fixed executable/argv commands, separate stdout/stderr with ordered IDs, bounded redacted output, timeout, cancellation/escalation and cleanup. Read-only Git/Node version UI verifies end-to-end behavior.
- [x] Replace placeholder with xterm views, tabs, creation, close, interrupt, resize and hide/show continuity. Keep subscriptions alive while dock is hidden; disconnect/terminate on renderer reload or window shutdown.
- [x] Add validation, lifecycle, process-streaming/limits/cancellation/timeout and native PTY tests. Update E2E to exercise shell input, multiple sessions, managed commands and packaged native dependencies.
- [x] Run lint, typecheck, tests, production build and packaged Electron smoke tests. Review changes and document verified outcomes.

## Files and interfaces
- `src/shared/runtime.ts`: strict schemas and typed session/execution event contracts; included by `contracts.ts`.
- `src/main/services/terminal/{environment,manager}.ts`: shell environment and TerminalManager.
- `src/main/services/execution/{redact,runner}.ts`: stream redaction and ManagedRunner.
- `src/main/infrastructure/process/terminate.ts`: OS process-tree cleanup adapter.
- `src/main/ipc/runtime.ts`: terminal/command IPC registration; initialized by existing window IPC.
- `src/preload/index.ts`: API allowlist and event subscriptions.
- `src/renderer/src/features/terminal/{TerminalDock,TerminalView}.tsx`: persistent tab views and xterm lifecycle.
- `src/renderer/src/features/execution/ManagedPanel.tsx`: read-only process-core validation UI.
- `tests/{runtime,execution,terminal}.test.ts`: boundary, actual spawned process and fake/native PTY lifecycle tests.
- `tests/e2e/{foundation,runtime}.mjs`: regression and real Electron/native packaging smoke tests.

## Verification record
- `npm run lint`, `npm run typecheck`, `npm run build`: pass.
- `npm test`: 18 tests pass across five files, including native PTY, stream ordering/redaction, timeout/cancellation, output limits and Unicode chunk regression.
- `npm run test:e2e`: source and packaged application both pass Phase 1 regressions.
- `npm run test:e2e:runtime`: source and packaged application both pass real shell pwd/git, multiple tabs, hide/show continuity, Ctrl+C, managed streaming and IPC allowlist checks.
- Child cleanup verified on tab close and simultaneous window-close/app-quit, including a child ignoring SIGTERM.
- `npm run pack`: macOS ARM64 app built with native node-pty unpacked and executable spawn-helper confirmed.
- Runtime dependency audit: zero advisories. Development-tool advisories were not force-upgraded.
- Review findings fixed: Unicode boundaries, quit/close cleanup races. An E2E synchronization race was fixed by waiting for the second tab before typing.
- Windows/Linux/Intel macOS, signing/notarization, split panes and subsequent phases remain outside verified scope.
