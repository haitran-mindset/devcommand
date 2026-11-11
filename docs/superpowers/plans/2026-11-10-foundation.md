# DevCommand Foundation Implementation Plan

**Goal:** Deliver Phase 1 of the supplied DevCommand specification, with the reference image guiding the shell.
**Architecture:** Sandboxed React renderer → allowlisted preload → sender-validated IPC → SQLite settings repository. No process execution or PTY in Phase 1.
**Tech Stack:** Electron, electron-vite, React, TypeScript, Tailwind, shadcn/ui, Zustand, TanStack Query, React Router, Zod, Drizzle, better-sqlite3, electron-log, Vitest.
**Spec:** `/Users/df/Downloads/DEVCOMMAND_AGENT_SPEC.md`, Phase 1 only; approved in chat.

## Constraints
- Local-first; no telemetry, accounts, secrets, arbitrary shell API or remote UI.
- No Git commits or subsequent phases without explicit authorization.
- macOS first; other platforms require separate validation.

## Tasks
- [x] Scaffold package/config files and secure main/preload entrypoints. Keep preload CommonJS for sandbox compatibility.
- [x] Define shared Zod settings schema and narrow API. Test strict payload validation and sender identity, frame and URL checks.
- [x] Add transactional SQLite migrations and Drizzle settings repository. Test defaults, malformed data, updates, migration idempotency and persistence after reopening.
- [x] Build shell, navigation, command reference inspector, settings, collapsible sidebar and resizable bottom placeholder. Persist route/theme/panel preferences; support keyboard focus and loading/error states.
- [x] Run lint, typecheck, tests, production build, package and Electron smoke checks where permitted. Document actual outcomes and platform limitations.

## Files
- `src/shared/contracts.ts`: runtime-neutral settings schemas and API types.
- `src/main/{index.ts,ipc/register.ts,security/sender.ts}`: window lifecycle and validated IPC.
- `src/main/infrastructure/database/{schema.ts,store.ts}`: migration and persistence.
- `src/preload/index.ts`: contextBridge allowlist.
- `src/renderer/src/{main.tsx,App.tsx,styles.css,lib/*,components/ui/*}`: providers, shell, controls.
- `tests/{settings,sender}.test.ts`: boundary and database checks.
- `README.md`: usage, scope, packaging and limitations.

## Verification
Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run pack`. Launch dev and packaged Electron with Playwright if GUI permission is available; verify isolation, navigation, persistence and settings IPC. Do not treat compilation as proof of launch.

## Verification record
- Unit/database tests: 6 passing. Lint and TypeScript checks pass.
- Development launch, Settings/light theme and CSS HMR checked with agent-browser.
- Electron smoke test passes for both built and packaged app, including isolated SQLite preferences and restart.
- macOS ARM64 `.app` packaging verified; no notarization or Windows/Linux validation.
- Runtime dependency audit: 0 advisories. Build-tool dependency advisories remain; no forced upgrades applied.
