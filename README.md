# DevCommand

Local-first Electron developer command center. Phases 1–4 implement the application foundation, terminal/process core, workspace management, trusted command execution and Git Manager, following the supplied DevCommand specification and visual reference.

## Run

Requires Node.js 24+ and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

The install workflow rebuilds Electron native dependencies and prepares node-pty's spawn helper. If your host explicitly sets `ELECTRON_RUN_AS_NODE`, unset it when launching desktop tools (`env -u ELECTRON_RUN_AS_NODE npm run dev` on macOS/Linux).

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:e2e:runtime
npm run pack
```

`npm run pack` creates `release/mac-arm64/DevCommand.app` on an Apple Silicon Mac. Certificate signing is disabled for local builds; the app is not notarized or ready for public distribution. Installers from `npm run dist` have not been validated. The default Electron app icon is retained.

Run both smoke suites against the packaged application:

```sh
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:runtime
```

E2E uses temporary user-data profiles. It covers isolation, IPC validation, navigation, theme/sidebar/dock persistence, real PTY input, multiple tabs, hide/show continuity, Ctrl+C, managed streaming and process cleanup. Screenshots are local ignored artifacts because shell prompts can contain machine/user metadata. Runtime tests need permission to spawn PTYs, enumerate descendant process IDs and terminate their own test children.

## Use the terminal

Click **+ / New terminal** in the bottom dock. Select an installed shell from the menu before creating a new tab. Sessions begin in the OS home directory; `cd` works normally inside the shell. Each tab owns its shell, ANSI output, input, selection, paste and bounded scrollback. Drag the dock edge or focus it and use arrow keys to resize.

- Hide/show preserves sessions. Closing a tab terminates its shell and descendant processes.
- The square button sends Ctrl+C to the active terminal. Keyboard Ctrl+C continues to reach the shell.
- Cmd+C on macOS, or Ctrl+Shift+C, copies a terminal selection. Standard paste is handled by xterm.
- App search/settings shortcuts do not intercept terminal keyboard input. Outside the terminal, Cmd/Ctrl+K searches, Cmd/Ctrl+J toggles the dock, and Cmd/Ctrl+, opens settings.
- Reloading the renderer, closing the window or quitting terminates sessions. Sessions are not restored after restart.

The terminal is a trusted local-user shell with your OS permissions. Commands entered there are not constrained by managed-command safety rules. DevCommand does not log keystrokes, persist terminal output or save terminal command history. Your shell may maintain its normal history and startup behavior independently.

## Managed process core

Open **Shell Tools → Process Core** and run `git --version` or `node --version`. These read-only checks use fixed backend command definitions with `spawn`, argument arrays and `shell: false`. The renderer cannot provide executable paths, arguments, cwd or environment variables. Missing CLIs produce a failed result with a useful message.

Output is streamed separately for stdout/stderr with execution IDs and monotonic sequence numbers. The panel shows status, duration, exit code/signal, limited output and cancellation while running. CLI checks have a 10-second timeout. The core retains at most 12 executions in memory, caps retained output at 128 Ki characters / 512 chunks per execution, and stops a process after 1 MiB received output. Known token/credential patterns are redacted across stream chunks; oversized lines are omitted. Phase 3 persists redacted managed history as described below.

The Git Command Explorer is now executable through the Phase 3 library described below. The Shell Tools process checks remain available as a compact diagnostic surface. Dedicated Git/SSH/Docker/workflow manager routes identify later phases.

## Architecture and security

```text
src/main/                         Electron lifecycle, IPC and security
src/main/services/terminal/       Shell allowlist and PTY sessions
src/main/services/execution/      Managed runner and redaction
src/main/infrastructure/process/  OS process-tree termination adapter
src/main/infrastructure/database/ SQLite migration and Drizzle settings
src/preload/                      Allowlisted contextBridge API
src/shared/                       Zod contracts and Unicode-safe transport
src/renderer/src/features/        Terminal and managed-process UI
scripts/                          Native helper preparation and packaging hook
tests/                            Unit, native integration and Electron E2E
```

Renderer Node integration is disabled; context isolation and sandbox are enabled. IPC checks window identity, main frame, exact renderer URL and strict payload schemas. Event subscriptions strip Electron event objects and return unsubscribe functions. Runtime services are scoped to the owning window. Popups, navigation, webviews and permissions are denied. Production CSP blocks external connections; development permits only the local Vite WebSocket.

PTY output uses acknowledgements and native pause/resume backpressure. There are at most 8 live sessions per window and 3,000 scrollback lines per terminal. Transport chunks preserve Unicode surrogate pairs. Closing/quit waits for process cleanup, including TERM-to-KILL escalation; Unix process-tree enumeration handles foreground/background shell jobs. Processes that deliberately detach/reparent themselves can escape best-effort tree cleanup; this is not an OS process sandbox.

Settings remain in `app.getPath('userData')/devcommand.sqlite`. `--user-data-dir` overrides that location for isolated tests. Corrupt settings produce an error without a silent reset. Back up the database before manual recovery. Logging is bounded and excludes input, environment, terminal output and raw exceptions.

Native `.node` libraries and node-pty resources are unpacked from ASAR. The packaging hook ensures `spawn-helper` is executable; this addresses the missing execute bit in node-pty 1.1.0 prebuilds without patching vendor source.

## Validation limits

macOS ARM64 is the primary tested platform. Windows has a shell/ConPTY and taskkill adapter, and Linux uses the Unix adapter, but neither is verified. Intel macOS, release signing/notarization and installers need separate validation. Split panes, configurable default cwd, database backup/export UI and Phase 6 workflows are not included.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [node-pty](https://github.com/microsoft/node-pty), [xterm.js](https://xtermjs.org/docs/).

## Phase 3 — Workspaces & command execution

**Workspaces** adds existing repositories through the native folder picker. Entries support selection, favorites and removal from the list without deleting local files. Git context detects canonical roots, clean/dirty state, detached/unborn branches, bare repositories, conflicts, upstream and fetch/push URLs. It refreshes after managed executions, on focus and every five seconds while active. Missing or replaced paths require adding the repository again.

The **Command Library** contains 35 trusted Git/general commands with dynamic forms, category/risk/platform filters, aliases, favorites, keyboard command palette and backend-validated previews. Cmd/Ctrl+K opens the palette; Cmd/Ctrl+P opens workspaces; Cmd/Ctrl+Enter requests execution in the command builder. Terminal input retains its control keys.

Every mutating managed command requires a fresh explicit confirmation, including caution operations. Tokens are one-time, expire after 60 seconds and bind the request, workspace, refs, local config, porcelain state, index diff, worktree binary diff and relevant global setting. State is checked before/after preview and immediately before execution. Per-workspace operations and global config updates are serialized. Concurrent external tools can still change files after the final check; DevCommand is not a filesystem transaction or process sandbox.

Preview includes the actual Git safety arguments: hooks, fsmonitor, interactive paging and external/file transports are disabled. Remote URLs accept credential-free HTTPS/SSH only. Config changes support a limited allowlist of settings, preventing arbitrary Git command hooks or credential-helper configuration through the form. Config values are treated as sensitive: previews redact them, copy/insert is disabled for them, and config output/values are omitted from persistent history. Network operations require confirmation and use a 60-second timeout; SSH host key verification is retained.

**Insert** opens a fresh repository shell and inserts a POSIX-quoted draft using bracketed paste after the prompt enables it. It clears the fresh input line and never sends Enter. This currently requires an installed zsh/bash with bracketed paste enabled; Windows insertion is explicitly unavailable. Review the draft, then press Enter yourself. Interactive execution is not recorded as a managed run.

**History** stores at most 100 managed runs, retaining bounded redacted output, exit status and request metadata. Rerun selects the original workspace and opens a new preview/confirmation; it never executes saved argv. Sensitive parameters must be re-entered. Interrupted runs are marked cancelled when the database reopens. A history write failure is reported without losing track of an already started process.

SQLite migration version 2 preserves existing preferences and adds workspace/favorite/history storage. Workspace paths and non-sensitive request metadata are local user data; the application does not transmit them to new services. General commands run in the selected repository or home directory. SHA/branch and remote names use conservative validation; arbitrary custom commands, local-file remotes, external editors and clone UI are not included.

Run the Phase 3 Electron journey against source or packaged builds:

```sh
npm run test:e2e:workspace
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:workspace
```

The test uses temporary Git repositories and stubs only the native picker's selected path from privileged test code. It verifies the real renderer/preload/IPC/services/database chain for remote URL changes, confirmation, persistence, rerun and insert-without-Enter. Unit/integration tests cover expired/reused/mismatched/stale tokens, staged-to-unstaged transitions, each destructive built-in, injection/credential rejection and migration. No project Git state is mutated by those tests.

The installed Playwright build's `waitForFunction` does not poll asynchronous predicates correctly; the E2E IPC wait helper therefore awaits repeated evaluations explicitly.

**Limits:** Repository probes and confirmation diffs have a 512 Ki-character / five-second bound; unusually large/slow repositories can be refused for safety. External process races, unusual shell startup scripts, credential helpers, network authentication and Windows/Linux/Intel macOS need separate validation. Phase 4 Git Manager and Phase 5 SSH/Docker packs are implemented below; Phase 6 workflows remain future work.

## Phase 4 — Git Manager

Open **Git Manager** in the sidebar. Existing **Git Config** and **Git Remote** links open the corresponding manager tabs, preserving saved navigation. The six keyboard-accessible tabs share the currently selected workspace:

- **Overview:** file-level index/worktree status, rename sources, conflicts, staged/unstaged diffs and confirmed Stage/Unstage actions. Staging does not create a commit. Unstage preserves working-tree content, including before the first commit and for both halves of a staged rename.
- **Config:** local/global/effective values and source/scope for the five supported config keys. Edits use the existing safe key allowlist, sensitive-value policy and confirmation. Boolean/rebase/default-branch values have contextual validation.
- **Remotes:** fetch/push URLs, add, rename, change fetch URL and remove. Explicit push URLs remain unchanged when updating the fetch URL. Removing a remote does not delete the server repository.
- **Branches:** local branches, current branch, upstream, merged state and linked-worktree paths. Create/switch/rename and merged-only deletion use managed confirmations. Current, unmerged or checked-out-in-another-worktree branches are protected; force deletion is unavailable.
- **Commits:** 50 commits per page, up to offset 10,000, with author/date/subject and immutable-OID commit inspection. No commit creation, rebase or cherry-pick is implemented.
- **Stash:** inspect, save tracked changes, apply, pop and drop. Apply/Pop require a clean working tree. Pop drops only after success; on conflict Git retains the stash. Drop is destructive and requires explicit confirmation. The list shows the latest 50 entries.

All writes reuse Phase 3 preview, one-time expiring tokens, process output/cancellation and redacted history. Stash row actions include the displayed OID; a positional stash reference that changed before preview is refused. Token state also includes the selected stash OID to detect older-entry shifts that do not change `refs/stash`. Linked worktrees sharing a common Git directory share the managed-operation resource lock.

File operations accept only changed repository-relative paths. Git's global `--literal-pathspecs` prevents names such as `:(glob)*` from becoming wildcard instructions. Paths with traversal, control characters or backslashes are refused for managed file operations. Untracked file bodies are not read directly for previews; stage first to inspect the indexed diff. Path metadata binds untracked-file staging confirmations. Raw diff/index output preserves trailing whitespace when computing state fingerprints.

Diff readers disable external drivers, text conversion, signatures and color. Read responses are local UI data, not execution-history records; they use existing known-pattern redaction. Large/slow reads retain the 512 Ki-character / five-second probe limit and display an error instead of a partial result. Bare/unborn/detached/missing-path and conflict states have explicit UI messages.

While the manager is used, filesystem notifications are debounced by 180 ms and watchers are cleaned up on reload/window shutdown. macOS/Windows use recursive watching; other platforms use root/metadata watches plus five-second polling and focus refresh. Open diffs have their own polling/focus refresh, and **Refresh Git** refreshes both snapshots and diffs. Watcher failures fall back to polling. No OS-level transaction is claimed against concurrent external Git commands.

```sh
npm run test:e2e:git
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:git
```

The Git Manager test uses only temporary repositories and fixture commits. It checks GUI/CLI parity for stage/unstage/diff/config/remotes/branches/commits/stash, cancel-before-confirm, explicit dangerous warnings, refresh and real conflict UI. Native picker selection is stubbed only in privileged test code. Unit/integration coverage includes literal Unicode/magic paths, unborn staging, unmerged/linked-worktree protection, rename unstage, commit paging, stale stash identity, whitespace-sensitive fingerprints and watcher debounce/cleanup.

**Verified target:** macOS ARM64 with Git 2.55.0. Windows/Linux/Intel macOS, unusual Git versions and release signing/notarization remain unverified. Merge resolution is manual; Stage marks a conflicted file resolved in the index and does not remove conflict markers. Phase 5 SSH/Docker management is described below; Phase 6 workflows remain future work.


## Phase 5 — SSH & Extended CLI

**SSH Manager** lists regular public `.pub` files, fingerprints, public comments and OS agent identities. Public copy excludes private key content. Application code opens only public keys and SSH config; private key availability is checked using filesystem metadata. Public discovery is limited to 100 keys, 16 KiB per key and a 256 KiB config. Symlinked metadata, unsafe directories and unsupported key formats are refused.

Ed25519 generation and one-hour agent loading run the installed `ssh-keygen`/`ssh-add` directly in a PTY. Passphrases are typed interactively, never provided through argv or stored in the database. Key names are reserved while generation runs; existing names are refused. Generation completion refreshes public metadata. No private-key deletion or automatic overwrite is exposed.

Literal Host aliases support add/edit/remove through a reviewed, one-time 60-second confirmation bound to config revision and metadata. Existing configs receive a `0600` backup before atomic replacement; comments and unknown directives outside edited fields are retained. Include/Match, wildcard/multiple-pattern hosts, duplicate aliases/directives and external IdentityFile paths require manual editing. SSH config is not a full semantic editor. Concurrent external edits after the final check remain possible.

Connection diagnostics use explicit host/user/port and an optional identity from this SSH directory, bypass custom config (`-F /dev/null`), proxy/local commands and forwarding, and enforce batch authentication plus strict host-key checking. Unknown or changed hosts are refused; verify their fingerprints through your normal trusted process outside DevCommand. Diagnostics never accept new host keys automatically. Git hosting services may exit nonzero after authentication; read output rather than interpreting the exit code alone. Diagnostic output remains in memory and is not saved to history.

**Docker Manager** detects CLI/daemon availability and shows selected context/endpoint, daemon identity, containers, images, volumes and networks. Reads are bounded to 1 MiB/five seconds per probe. Credentials in endpoint URLs are refused; inspect environment/config secrets are not returned to the renderer. Refresh is explicit and follows completed actions.

Start/stop/restart, stopped-container removal, image removal, unused-volume deletion, empty custom-network removal and logs all use backend-owned argv, managed streaming/cancellation and one-time confirmations bound to context/daemon/resource state. Full immutable container/image/network IDs are required. No force/prune operation is exposed. Volume deletion checks references and explicitly warns of permanent data loss. Logs show the last 200 lines; follow stops after 60 seconds or Cancel. Docker operations and diagnostic output are deliberately ephemeral rather than persisted as rerunnable history.

Compose up/down use the selected Git workspace, exactly one standard Compose filename, and an explicit preview. Confirmation binds the root file, `.env` and effective `compose config --format json` output, including resolved includes/extends/env_file and interpolation. Effective config may contain local environment values: it is hashed in main only, never returned or persisted. Configs/secrets file references are currently refused because their content is not bound. Up disables builds and image pulls; down preserves named volumes but removes containers and their writable layers. These operations require a trusted repository and Docker Compose V2 with JSON config output. Repository-defined services can use bind mounts, privileges and networks.

The library now contains **44 built-ins**. New Node commands show npm/runtime versions and direct dependencies (`npm ls --offline --ignore-scripts`, requires `package.json`). Flutter commands show version, doctor and devices with per-invocation `--suppress-analytics`; they require confirmation because the SDK can initialize caches, contact services or prompt for OS permissions. Dart version, disk usage and numeric TCP-port inspection complete the packs. Arbitrary package scripts, JavaScript input and process killing are not exposed. Missing tools show a reason and disable execution; nothing installs tools automatically.

```sh
npm run test:e2e:extended
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:extended
```

**Verified:** macOS ARM64, 57 unit/native tests, lint/typecheck/build/pack, and all five Electron journeys against both build output and the packaged `.app`. The extended journey uses real `ssh-keygen` in a temporary directory, fixture-only SSH network/agent/Docker programs and an isolated profile. Source tests use a test-only home lookup startup hook; packaged macOS tests use Playwright's privileged main-process channel and recreate the window after startup. Both assert isolation before SSH requests. Neither fixture mechanism is shipped in the application. No real user keys, OS-agent identities, Docker resources or remote hosts are modified by the tests.

**Limits:** Real SSH network authentication/agent integration, live Docker/Compose engines and Flutter SDK/device operations were not exercised. Docker policy/Compose-state checks use fixture transports. Windows/Linux/Intel macOS remain unverified; SSH writes are disabled on Windows pending ACL validation, and npm/Flutter wrapper packs are limited to macOS/Linux. The macOS app is unsigned/unnotarized, uses the default Electron icon and has no installer validation. Phase 6 workflows are not implemented.


## Command Center interface refresh

The desktop shell follows the updated reference: persistent top search, compact sidebar with Git subnavigation, repository context bar and a three-column Command Explorer. The right rail shows real repository metadata, configuration-only quick actions and recent managed history. Terminal tabs share their toolbar; recent task status sits beside the dock on wide displays. No mock activity, storage-usage figures or inactive AI/templates/tools were added.

Navigation now labels the command library **Command Explorer**, workspaces **Repositories**, and starred commands **Favorites**. Existing route URLs and backend APIs are unchanged. The right rail/tasks collapse at 1180px and below, and the sidebar collapses to icons below 1050px; every repository/action remains reachable through existing pages. Git previews show the main operation first, with full managed execution options available in an expandable section. Copy, confirmation and execution retain the exact backend preview/arguments.

```sh
npm run test:e2e:ui
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:ui
```

The fixture journey covers real context/activity, nonexecuting quick actions, favorites, palette/filter reset, modal shortcut isolation, switching repository targets, terminal rendering, Git submenu links, keyboard help, light/dark and 1672/1440/1280/1180/900px layouts. Screenshots remain local ignored artifacts. Desktop verification targets macOS ARM64; the existing platform/signing limits still apply.


All visible selection controls use the official shadcn/ui Radix Select: command filters/parameters, Git operation fields, SSH identity, history status, runtime command and terminal shell. A shared composition preserves domain values (including the empty default/agent SSH identity), accessible labels and required/disabled states. Native-select CSS no longer overrides triggers; popup surfaces use theme tokens and render outside scrolling panels. Cmd/Ctrl+Enter ignores events originating in Select, even if selection closes the popup before the page keyboard handler runs.


The desktop document/root are bounded to the viewport and suppress document overscroll. Main content, sidebar navigation, command lists, details and Settings retain their own scroll boundaries; Radix popups still use body portals. The isolated SSH journey checks repeated wheel scrolling to the pane boundary plus shell selection without moving document/header/footer bounds. Synthetic wheel tests do not validate physical macOS trackpad elastic gestures.


## Compact desktop density

The default window is 1280×820 (minimum remains 900×650). Typography, icons, row heights, section spacing and corner sizes are reduced throughout the shell, managers, Settings, dialogs and shadcn controls; already-small metadata stays readable. Terminal text uses 12px. This uses authored CSS/rem sizing, not browser zoom or a scaled viewport, so scroll ownership and popup placement remain intact.

The compact default retains the repository rail and Running Tasks; task history scrolls within the terminal row rather than increasing its height. Narrow inspector footers retain the risk badge and full confirmation details while removing repeated helper copy. E2E checks window defaults, dock/sidebar/CTA bounds, dropdowns, Settings scrolling, keyboard access and responsive layouts.
