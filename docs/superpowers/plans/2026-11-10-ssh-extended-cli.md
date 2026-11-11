# SSH & Extended CLI — Phase 5

**Goal:** Implement SSH public metadata/key generation/config/connection diagnostics, Node/Flutter/system packs.
**Architecture:** Narrow validated IPC, backend-owned paths/argv and bounded CLI probes. SSH filesystem actions use explicit one-time state-bound confirmation; passphrase operations use direct-program PTYs.
**Spec:** `/Users/df/Downloads/DEVCOMMAND_AGENT_SPEC.md`, Phase 5; continuation authorized in chat.

## Constraints
- Never open SSH private-key content in application code; discover regular public `.pub` files and use public fingerprint CLI only. Never put passphrases in argv/logs/database.
- No automatic key overwrite, private-key deletion, host-key trust bypass or unknown host acceptance. Connection tests use explicit fields, strict checking and batch authentication; custom proxy/local commands are not executed by diagnostics.
- SSH config backup and conservative atomic updates preserve comments/unknown directives. Complex Include/Match/multi-pattern/duplicate-identity blocks remain read-only rather than guessing semantics.
- No real user SSH changes, agent changes or external connections during automated tests. Fixtures use explicit constructor dependencies and a test-only Electron preload for an isolated home lookup, never a shipped runtime override or HOME environment reassignment.
- No new dependencies, project commits/push, publishing.

## Tasks
- [x] Shared schemas/API for SSH snapshots/actions; CLI discovery with unavailable reasons and safe absolute executable lookup.
- [x] Bounded/cancellable probe infrastructure and direct trusted-program PTY lifecycle support, preserving shell behavior.
- [x] SSH public key fingerprints/public copy, interactive ed25519 generation, agent identities/load, literal host config add/update/remove with backup/state checks, strict SSH connection diagnostics.
- [x] Expand trusted registry and filters with Node/Flutter/system packs and prerequisites, without arbitrary shell/script parameters or implicit dependency installation.
- [x] Build SSH UI using existing styles and a shared managed-action review/result dialog; clear loading/empty/error/unavailable states and refresh/cancel behavior.
- [x] Unit/native fixture tests for SSH parsing/backup/no-private-reads, passphrase-free argv, strict checking, unavailable tools.
- [x] Run lint/typecheck/tests/build, request review and execute all Electron regression suites plus isolated Phase 5 source/packaged tests. Document actual platform/live-daemon validation limits.

## Files
- `src/shared/extended.ts`: DTOs, strict SSH action schemas.
- `src/main/services/cli/`: absolute executable discovery and bounded tracked CLI probes.
- `src/main/services/ssh/`: safe public/config filesystem operations, parser, confirmations and direct-program requests.
- `src/main/services/commands/{registry,service}.ts`: extended packs/prerequisites/provider bindings.
- `src/main/services/terminal/manager.ts`: internal direct-program PTY factory with exit cleanup.
- `src/main/ipc/extended.ts`, runtime/preload: allowlisted APIs, notifications and cleanup.
- `src/renderer/src/features/{ssh,execution}/`: pages and reused operation review/results.
- `tests/extended.test.ts`, `tests/e2e/extended.mjs`: fixture-only verification; real SSH keygen where available, fake SSH network/agent clearly distinguished.

## Verification and implementation notes
- 57 unit/native tests pass; lint, typecheck, build and macOS ARM64 pack pass. All five Electron journeys pass against both build output and packaged `.app`.
- Reviewer findings fixed: simultaneous same-name key generation, known_hosts paths with spaces, endpoint credentials, Windows wrapper availability. Review found no remaining P1/P2 in inspected changes.
- External SSH authentication, real OS agent changes and Flutter/device probes were not exercised. See README for platform and signing limits.
