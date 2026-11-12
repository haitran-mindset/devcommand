# DevCommand

DevCommand is a desktop application for managing repositories, finding and configuring CLI commands, working with Git and SSH, and using a terminal in the same window.

It combines a **GUI and terminal**, stores data locally in SQLite, and does not require a DevCommand account. The primary tested platform is **macOS Apple Silicon**.

## Table of contents

- [Downloads and releases](#downloads-and-releases)
- [Requirements](#requirements)
- [Development](#development)
- [Building and installing on macOS](#building-and-installing-on-macos)
- [Getting started](#getting-started)
- [Features](#features)
- [Integrated terminal](#integrated-terminal)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Data and security](#data-and-security)
- [Project architecture](#project-architecture)
- [Scripts and testing](#scripts-and-testing)
- [Troubleshooting](#troubleshooting)
- [Current limitations](#current-limitations)

## Downloads and releases

Tagged releases are built by [Release macOS](.github/workflows/release.yml). Download links become available after the first successful release:

- [Latest release](https://github.com/haitran-mindset/devcommand/releases/latest)
- [macOS Apple Silicon](https://github.com/haitran-mindset/devcommand/releases/latest/download/DevCommand-mac-arm64.dmg)
- [macOS Intel](https://github.com/haitran-mindset/devcommand/releases/latest/download/DevCommand-mac-x64.dmg)

Private repositories require GitHub access. Stable `latest` links exclude prereleases; download prerelease assets from their individual release page. Builds are unsigned and not notarized; see the installation instructions below.

### Publishing a release

Commit the release configuration to GitHub before tagging it. For the initial version, after committing and pushing the setup:

```sh
npm run test:release
node scripts/check-release.mjs v0.1.0
git tag -a v0.1.0 -m "DevCommand v0.1.0"
git push origin v0.1.0
```

For subsequent versions, update both manifests, commit the changes, then push the matching tag:

```sh
npm version 0.1.1 --no-git-tag-version
# Review, commit and push package.json and package-lock.json first.
node scripts/check-release.mjs v0.1.1
git tag -a v0.1.1 -m "DevCommand v0.1.1"
git push origin v0.1.1
```

Tags must match `v` plus the package version, including the lockfile root versions. Prerelease versions such as `0.2.0-beta.1` are supported; build metadata is not. Each architecture runs checks and builds its own DMG. Both installers and `SHA256SUMS.txt` must be ready before the draft is published. The workflow refuses to replace an already published release. A failed draft can be retried from GitHub Actions.

GitHub Actions must be enabled and organization policies must allow the listed actions, macOS runners, and `contents: write` for the publishing job. The built-in `GITHUB_TOKEN` publishes assets; no personal access token or SSH key is required. Native dependencies are built on the matching macOS architecture. Local build filenames remain versioned; release download aliases use stable architecture names.

Download both installers and the checksum file into one directory to verify:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

No automatic app update mechanism is included. Install a newer release manually. CI publishing still needs a successful tag-triggered run in your repository before download links are live.

## Requirements

### Development and builds

- Node.js **24 or later** and npm.
- macOS to build and test the macOS installer.
- Git to use repository features and run Git tests.
- Xcode Command Line Tools if native dependency installation requires a compiler.

Dependencies are pinned in [package-lock.json](./package-lock.json). Use `npm ci` to install from the lockfile.

### Running the application

The packaged `.app` includes its own Electron runtime; Node.js is not required just to open it. Commands that invoke external tools still require the corresponding CLIs on your machine:

| Feature | Required CLI |
| --- | --- |
| Repositories and Git Manager | `git` |
| SSH | `ssh`, `ssh-keygen`, `ssh-add`; a running agent is required to manage identities |
| Node/npm | `node`, `npm` |
| Flutter | `flutter` |
| Zsh | `zsh` |
| File Comparison | `diff`, `cmp` |
| Ports & Processes | `lsof`, `ps`, `kill` |
| Permissions on macOS | `ls`, `chmod`, `chown` |
| ACL on Linux | `getfacl`, `setfacl` |
| AI Developer CLI | `codex`, `claude`, `gemini`, or `agy` |
| Cloudflare Tunnel | `cloudflared` and the configuration/account required by the selected action |
| ngrok | `ngrok` with your existing credentials and configuration |

The app indicates when a CLI is missing or an action is unavailable on the current operating system. DevCommand does not install tools or sign in to provider accounts automatically.

## Development

From the project directory:

```sh
npm ci
npm run dev
```

`npm ci` runs `postinstall` to rebuild native dependencies for Electron and prepare executable permissions for the `node-pty` spawn helper. The development server watches both main/preload and renderer changes.

If your environment defines `ELECTRON_RUN_AS_NODE`, unset it when launching the app:

```sh
env -u ELECTRON_RUN_AS_NODE npm run dev
```

Run the source checks:

```sh
npm run typecheck
npm run lint
npm test
```

## Building and installing on macOS

### Create an Apple Silicon `.dmg` installer

```sh
npm run dist -- --mac --arm64
```

For the current version, `0.1.0`, the output includes:

```text
release/
├── DevCommand-0.1.0-arm64.dmg
├── DevCommand-0.1.0-arm64.dmg.blockmap
└── mac-arm64/
    └── DevCommand.app
```

To install:

1. Quit any running instance of DevCommand.
2. Open the `.dmg` in Finder.
3. Drag **DevCommand** into **Applications**, replacing the previous version if one is installed.
4. Open the app from **Applications**.

The `.dmg` is directly inside `release/`. Directories such as `Contents/MacOS`, `Frameworks`, and `Resources` are internal parts of the `.app`, not separate installers.

Verify the disk image integrity:

```sh
hdiutil verify release/DevCommand-0.1.0-arm64.dmg
```

Artifact names follow the `version` in [package.json](./package.json).

### Create a `.app` for testing

```sh
npm run pack
```

On an Apple Silicon Mac, the application is created at `release/mac-arm64/DevCommand.app`.

| Command | Result |
| --- | --- |
| `npm run build` | Compile main/preload/renderer into `out/` |
| `npm run pack` | Compile and package the application as a `.app` directory |
| `npm run dist -- --mac --arm64` | Compile, package the `.app`, and create a `.dmg` installer |

### Intel Macs and code signing

You can ask electron-builder to produce an Intel build:

```sh
npm run dist -- --mac --x64
```

The Intel build has not been verified on Intel hardware. Its native modules and artifacts need separate testing before distribution.

The current configuration sets `mac.identity: null`: the app is **not Developer ID signed or notarized**. If macOS blocks a trusted local build, check **System Settings → Privacy & Security → Open Anyway**. You do not need to disable Gatekeeper system-wide.

## Getting started

1. Open **Repositories → Add repository** and select an existing local Git repository.
2. Choose the active repository using the picker in the header.
3. Open **Command Explorer**, find a command group, and select an **Action**.
4. Fill in the parameters, then review the **Command Preview** and working directory.
5. Choose **Copy**, **Insert**, or **Run Command** as needed.
6. Star frequently used commands and open **Favorites** to arrange them.

Commands that do not require a repository can run from your home directory when no repository is selected. Commands requiring a repository or project file validate those prerequisites before execution.

## Features

### Dashboard

- Current repository, branch, and working-tree status.
- Shortcuts to Command Explorer, Git Manager, and SSH Manager.
- Favorite groups in their saved order.
- Recent managed-command activity and access to History.
- Empty, loading, and error states backed by real data.

### Repositories and header

- Add, select, favorite, and remove repositories from the list.
- Removing an entry **does not delete its local directory**.
- Inspect the branch, clean/dirty state, conflicts, upstream, and fetch/push remotes.
- Handle bare repositories, unborn branches, detached HEAD, and missing paths.
- **Open repository** opens its directory; **Refresh repository** reloads its state.

### Command Explorer

Related commands are grouped into one item; choose an operation using **Action**. Filters support category, risk, and platform. The list search shares its query with the header and matches group names, command names, descriptions, and aliases.

| Action | Behavior |
| --- | --- |
| **Configure** | Enter and validate parameters |
| **Details** | Read the description and consequences |
| **Examples** | View syntax examples |
| **Related** | Find related commands through categories and aliases |
| **Copy** | Copy the concise displayed command |
| **Insert** | Open a shell and insert the concise command without pressing Enter |
| **Run Command** | Execute a managed command or open an interactive CLI session |

Preview, Copy, Insert, History, and Process Core use concise Git commands such as:

```sh
git status --short --branch
```

Managed execution retains internal safety arguments, including disabling hooks/fsmonitor/pagers and blocking external/file transports. Command Explorer exposes the full command under **Managed execution options** where applicable. Meaningful command arguments, including the `--` separator when needed, are preserved.

Sensitive parameters are masked in previews and cannot be copied or inserted. **Insert** currently requires zsh/bash with bracketed paste; review the draft before pressing Enter yourself. Commands entered directly in a shell are outside managed-execution policy.

### Favorites and drag ordering

Favorites is a tab in Command Explorer, not a separate sidebar menu.

- The list star adds/removes actions in a group; the inspector star applies to the selected action.
- Partially starred groups still show their saved action count.
- Drag the dotted grip on the left of a group to place it before or after another group.
- Focus the grip and use **Alt + ↑/↓** to reorder with the keyboard.
- The order is stored locally, survives restarts, and also applies to Dashboard Favorites.
- Reordering a filtered list preserves hidden groups and does not change the Commands tab order.

### Git Manager

Click the entire **Git Manager** sidebar row to expand its submenu; click again to collapse it. All sections use the selected repository:

| Section | Features |
| --- | --- |
| **Overview** | File status, staged/unstaged diffs, Stage/Unstage |
| **Branches** | List, create, switch, rename, and delete merged branches |
| **Commits** | Paginated commit history and diff inspection by OID |
| **Remotes** | List, add, rename, change URL, and remove remotes |
| **Stash** | List, inspect, save tracked changes, apply, pop, and drop |
| **Config** | Local/global/effective values, scope/source, and editing forms |

Config editing is limited to `user.name`, `user.email`, `core.autocrlf`, `pull.rebase`, and `init.defaultBranch`. Config values are treated as sensitive parameters; config values/output are excluded from Execution History.

Mutating operations require a preview and confirmation. Branch deletion does not use force and protects the current branch, unmerged branches, and branches checked out in another linked worktree. Stash Apply/Pop require a clean working tree; Drop includes a data-loss warning. DevCommand does not currently provide commit creation or a merge-conflict editor.

### SSH Manager and SSH commands

SSH Manager reads public-key metadata, fingerprints, public comments, host aliases, and agent identities.

- Copy public keys without displaying or storing private-key content.
- Generate a new ed25519 pair with `ssh-keygen`, without automatically overwriting existing keys.
- Enter passphrases in the terminal, never through argv or the database.
- Select a key and lifetime with **Add key to agent**.
- List identities using `ssh-add -l -E sha256`.
- Remove a selected identity or all identities from the agent.
- Add/edit/remove host aliases with previews, revision checks, and config backups before writes.
- Test connections with strict host-key checking, without automatically trusting new or changed host keys.

| Lifetime | `ssh-add` invocation |
| --- | --- |
| 10 minutes | `ssh-add -t 600 <private-key>` |
| 1 hour | `ssh-add -t 3600 <private-key>` |
| 8 hours | `ssh-add -t 28800 <private-key>` |
| 24 hours | `ssh-add -t 86400 <private-key>` |
| No time limit | `ssh-add <private-key>` |

**No time limit** omits a lifetime for that invocation. A key can still expire under an agent-wide default, be removed, or disappear when the agent restarts; this does not guarantee persistence across machine restarts.

The agent is shared by your repositories and applications. Removing an identity may affect authentication for repositories using it; it does not delete key files, edit Git remotes, or change host configuration. These operations run only after confirmation.

**Refresh SSH/Refresh agent** reloads state without creating, adding, or removing keys. Complex host configuration involving Include/Match, wildcards, or IdentityFile paths outside the SSH directory may require manual editing.

Command Explorer also includes SSH Connect, Test authentication, Version/Help, key generation, fingerprints, and agent operations. **SSH Connect** uses your OpenSSH configuration; diagnostic tests use direct parameters, bypass proxy/local commands, and retain strict host-key checking.

### Ports & Processes

Under **System**, the **Ports & Processes** group supports:

- Listing all TCP listening ports.
- Inspecting a specific TCP port.
- Finding processes using a TCP/UDP port.
- Stopping a TCP listener by port, defaulting to `3000`.

Stopping a listener checks its PID and process identity before sending **SIGTERM**, requires confirmation, and does not force-kill it. If multiple processes listen on the port, specify the intended PID. Operating-system permissions may limit which processes can be inspected or stopped.

### Permissions

The **Permissions** category contains two groups:

- **File Permissions:** inspect permissions/owner/group, `chmod`, and `chown`.
- **File ACL:** inspect, add, remove entries, and clear extended ACLs.

Paths must belong to the selected repository. Operations apply to one path without automatic recursion or `sudo`; unsafe paths are rejected. The backend selects the appropriate macOS/Linux CLI.

### Node, npm, Flutter, and system tools

- Node/npm versions, runtime information, and direct dependencies.
- `npm ls` uses `--offline --ignore-scripts` and does not run repository package scripts.
- Flutter version, doctor, and devices.
- Flutter actions require confirmation because the SDK may initialize caches or contact services; analytics are suppressed for each invocation.
- Working directory, directory listing, and disk usage.

### File Comparison

Open **System → File Comparison**, or search for `diff`, `cmp` or `compare`. Five actions share one item:

| Action | Command |
| --- | --- |
| Unified diff | `diff -u <first-file> <second-file>` |
| Quick check | `diff -q <first-file> <second-file>` |
| Ignore whitespace | `diff -u -w <first-file> <second-file>` |
| Ignore case | `diff -u -i <first-file> <second-file>` |
| Byte comparison | `cmp <first-file> <second-file>` |

Use the **folder icon** beside either input (tooltip: Choose first/second file) to open the native file picker, or type/paste a path manually. Cancel keeps the current value. The picker starts at the selected repository, or home without a repository. Selected paths update the preview automatically.

Both inputs must resolve to regular files. Absolute paths are accepted; relative paths start at the selected workspace, or home without a workspace. Symbolic links resolve to their targets. These actions are read-only on macOS/Linux and need no mutation confirmation. Copy and Insert use quoted, resolved paths.

Exit `0` means equal under the selected rules, `1` means different, and higher codes indicate errors. Both `0` and `1` appear as successful comparisons; the exit code and output distinguish equality from differences. Equal files usually produce no output. Diff output may contain file contents and is saved in Execution History; managed timeout/output limits apply.

### File Operations

Open **System → File Operations** to create files or directories, copy/move/rename a regular file, delete a regular file, or remove an empty directory. All seven actions share one item and require a selected working-tree repository on macOS/Linux.

Paths are relative to the repository and checked at preview and run. Parent directories must exist. Preview resolves full paths and every Run requires a one-use confirmation bound to source/destination metadata. Changed paths require a fresh preview. Existing destinations, traversal, `.git` metadata, symbolic links and hard-linked files are refused. Copy/move use no-clobber flags as an additional safeguard. These CLI operations are not atomically isolated from concurrent filesystem changes; do not modify the same paths in another tool during execution. Enter the full destination filename, rather than only its directory.

File deletion is permanent and does not use Trash. Directory removal uses `rmdir` and refuses nonempty directories. This pack does not recursively copy/move directories, recursively delete, create missing parents, overwrite existing files or run sudo. Copy/Insert provide the reviewed shell command; manually executing a terminal draft is outside managed confirmation and revalidation.

### Find

Open **System → Find**, or search for `find`. All seven actions share one item:

| Action | Example predicates |
| --- | --- |
| By name | `-type f -name '*.ts'` |
| By name (ignore case) | `-type f -iname '*readme*'` |
| By extension | `-type f -name '*.ts'` |
| Directories | `-type d -name '*'` |
| Empty files or directories | `-type f -empty` or `-type d -empty` |
| Large files | `-type f -size +100M` |
| Recently modified | `-type f -mtime -7` |

The default search directory is `/` (the whole filesystem), with **No limit** for maximum depth. Choose a narrower directory or a numeric depth limit when needed. System-protected directories may produce permission errors or partial results; no automatic sudo is used. Relative directories start at the selected workspace, or home when no workspace is selected; absolute paths are also supported. Preview resolves the directory and quotes patterns for Copy/Insert. Managed execution passes arguments directly, without a shell.

Searches are read-only on macOS/Linux, include hidden directories, exclude the starting directory itself, and do not follow nested symbolic links (`-P`). There are no delete or exec actions. Empty matches succeed; permission failures can leave partial results. Large searches have a 60-second managed timeout and the standard output limits; use Cancel to stop a running search.

### Zsh

Search for `zsh` or open **System → Zsh**. All actions share one group:

| Action | Main command |
| --- | --- |
| Open Zsh | `zsh -i` |
| Reload .zshrc | `source ~/.zshrc` (uses `$ZDOTDIR/.zshrc` when set) |
| Open without user startup files | `zsh -f -i` |
| Version | `zsh --version` |
| Help | `zsh --help` |
| PATH entries | `zsh -f -c 'print -rl -- $path'` |
| Default options | `zsh -f -c 'set -o'` |
| Default keybindings | `zsh -f -c 'bindkey'` |
| Find command | `zsh -f -c 'whence -a -- "$1"' devcommand git` |
| Check config syntax | `zsh -f -n -- <startup-file>` |

Reload .zshrc opens a new interactive Zsh with `-f`, then sources the selected `.zshrc` once after the prompt is ready. Aliases, functions and environment changes remain available in that tab; existing tabs are unchanged. The same absolute `ZDOTDIR`/home file validation as syntax checking applies. Sourcing executes the file after confirmation; it does not edit it. Copy and Insert provide the source command for manual use.

Open Zsh uses your existing startup files after confirmation. The `-f` session skips user startup files but inherits the environment and can still read the system `/etc/zshenv`; it is not a sandbox. Both actions open Zsh directly, so Ctrl+C interrupts a foreground job while the shell stays available.

PATH, options, keybindings, and command lookup inspect a fresh `-f` shell rather than the state of another terminal tab. Lookup passes a validated command name as a positional argument and does not execute that command.

Syntax checking accepts `.zshrc`, `.zprofile`, `.zshenv`, `.zlogin`, or `.zlogout` from an absolute `ZDOTDIR`, or your home directory when `ZDOTDIR` is unset. It requires a regular, nonsymlink file no larger than 256 KiB. `-n` parses the selected file without executing its commands or modifying it; syntax-check output is omitted from persistent history. User startup files are not created, edited, sourced, or reloaded automatically by the inspection actions.

See the [Zsh invocation reference](https://zsh.sourceforge.io/Doc/Release/Invocation.html) for startup-file and invocation behavior.

### AI Developer CLI

Each tool has its own group under **AI Developer CLI**:

| Group | Executable | Start | Resume |
| --- | --- | --- | --- |
| Codex | `codex` | `codex` | `codex resume --last` |
| Claude Code | `claude` | `claude` | `claude --continue` |
| Gemini CLI | `gemini` | `gemini` | `gemini --resume latest` |
| Antigravity CLI | `agy` | `agy` | `agy --continue` |

Help and Version actions are provided where supported by the command definitions; Antigravity currently has no Version action. Start/Resume open a terminal in the selected repository, require confirmation, and do not submit prompts or enable permission-bypass flags automatically.

Each CLI uses its own accounts, configuration, permissions, and session storage. DevCommand does not record these interactive sessions in Execution History.

### Cloudflare Tunnel

Search for `cloudflared` or open **General → Cloudflare Tunnel**:

| Action | Main command |
| --- | --- |
| Quick tunnel | `cloudflared tunnel --url http://localhost:3000` |
| Run named tunnel | `cloudflared tunnel run <name-or-uuid>` |
| Login | `cloudflared tunnel login` |
| Create tunnel | `cloudflared tunnel create <name>` |
| List tunnels | `cloudflared tunnel list` |
| Tunnel info | `cloudflared tunnel info <name-or-uuid>` |
| Version | `cloudflared --version` |
| Help | `cloudflared tunnel --help` |

Quick Tunnel accepts a local HTTP(S) URL. Named tunnels use your existing `cloudflared` configuration. After confirmation, Login/Create may open authentication or create Cloudflare certificates/credentials.

### ngrok

Search for `ngrok` or open **General → ngrok**:

| Action | Main command |
| --- | --- |
| HTTP by port | `ngrok http 3000` |
| HTTP local URL | `ngrok http http://localhost:3000` |
| HTTP custom domain | `ngrok http 3000 --url https://example.ngrok.app` |
| TCP tunnel | `ngrok tcp 5432` |
| Start named endpoint | `ngrok start <name>` |
| Start all endpoints | `ngrok start --all` |
| Check config | `ngrok config check` |
| Version | `ngrok version` |
| Help | `ngrok help` |

These actions use your existing ngrok credentials/configuration. Custom domains and some endpoint types depend on account entitlements. DevCommand does not configure an authtoken automatically.

Tunnels run in the terminal. **Ctrl+C** stops the agent and returns to the shell in the same tab. Running a tunnel publishes the service according to the provider's access configuration; review the preview before confirming.

### History and Process Core

**History** stores up to 100 managed runs with status, timing, exit code, and bounded/redacted output. It supports status filtering, **Clear history**, and Review & rerun. Rerun returns the request to a form for revalidation instead of replaying saved argv automatically. Sensitive parameters must be entered again.

**Shell Tools → Process Core** offers these fixed, read-only checks and displays managed executions from the current session:

| Command | Purpose |
| --- | --- |
| `git --version` | Git version |
| `node --version` | Node.js version |
| `npm --version` | npm version |
| `python3 --version` | Python 3 version |
| `docker --version` | Docker client version; no daemon connection |
| `ssh -V` | OpenSSH version; no host connection |
| `whoami` | Current OS user |
| `hostname` | Computer hostname |
| `pwd` | Check working directory (home) |
| `uname -a` | OS/kernel information |
| `uptime` | System uptime |
| `date` | Current system date/time |

Select a command to see its purpose, then click **Run check**. Checks run from your home directory with backend-owned arguments; custom executables, arguments and shell expressions are not accepted. Missing tools produce an installation/PATH error. System information commands require macOS/Linux. **Clear** removes only finished runs from the current session list, preserving running processes and saved Execution History. Running commands can be cancelled; Git headings use concise commands. Docker remains absent from the sidebar; its version check does not restore Docker management.

Standard error is an output channel, not a failure indicator: Git progress messages often use it. Successful/running output uses normal text colors; failed/timed-out stderr and explicit execution errors receive error styling. Exit status and original output are preserved.

Terminal input/output is not saved in History. Clearing history does not delete project files or terminal output, or automatically cancel running processes.

## Integrated terminal

The terminal uses `node-pty` and xterm.js, with up to **8 active sessions** per window and **3,000 scrollback lines** per terminal.

| Control | Behavior |
| --- | --- |
| Shell picker + **+** | Select an installed shell and create a tab; ordinary shell tabs start in your home directory |
| Click a tab | Switch sessions and scroll the tab strip to the active tab |
| Left/right arrows in the tab strip | Scroll the list when many tabs are open |
| **Ctrl+C** or keyboard icon | Send an interrupt to the foreground process in the active tab |
| **OctagonX** icon | Stop sessions and close all terminal tabs |
| **X** on a tab | Stop and close that tab |
| Expand icon | Change the dock height |
| **X** in the toolbar | Hide the dock without stopping sessions |

The tab strip is separate from the toolbar so additional sessions do not displace controls. Resize the dock by dragging its top edge or focusing the separator and pressing ↑/↓. The interface supports light/dark/system themes, themed scrollbars, a default window size of **1280×820**, and a minimum of **900×650**.

Ordinary interactive CLI sessions launched from Command Explorer, including tunnels, AI CLIs, and SSH Connect, run inside a shell: after the command finishes or receives Ctrl+C, you can enter another command in the same tab. Specialized SSH key/agent operations still use dedicated PTYs and may end their session when the tool finishes. Programs that handle or ignore Ctrl+C may continue running; use OctagonX or close the tab to terminate the session.

Closing the window, reloading the renderer, or quitting the app terminates its managed terminal sessions. Terminals are not restored after restart. Your shell may read startup files and maintain its own history independently.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + K` | Command palette |
| `Cmd/Ctrl + P` | Repositories |
| `Cmd/Ctrl + J` | Toggle terminal dock |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + Enter` | Request execution/review of the configured command |
| `Ctrl + C` in the terminal | Interrupt the foreground process |
| `Cmd + C` on macOS | Copy the terminal selection |
| `Ctrl + Shift + C` | Copy the terminal selection |
| `Alt + ↑/↓` on a Favorites grip | Reorder groups |
| `Esc` in Search commands | Clear the list search query |

The command palette uses a compact search header and scrollable command rows. Use ↑/↓ to navigate, Enter to open configuration, and Esc to close. Selecting a result does not execute it. The palette supports dark/light themes, accessible selection, empty results and retry after loading errors.

The Keyboard shortcuts dialog displays platform-specific keycaps (⌘ on macOS, Ctrl on Windows/Linux), icons and brief action descriptions. Close it with Esc, the close icon or a backdrop click.

App shortcuts do not intercept keys while terminal input has focus. Selects and dialogs handle keyboard events separately to avoid executing commands behind a popup.

## Data and security

### Local data

SQLite is stored at `app.getPath('userData')/devcommand.sqlite`. The `userData` location depends on the runtime environment; use `--user-data-dir` for isolated tests.

Stored locally:

- Theme, last page, sidebar state, and dock preferences.
- Repository entries and the selected repository.
- Command Favorites and group order.
- Bounded/redacted managed-execution history.

Private-key content, passphrases, terminal keystrokes, and full terminal output are not stored. The app has no separate account or telemetry; CLIs you run may still access the network and follow their own data policies.

The database uses migrations and is not silently reset when corrupted. Migration v4 removes data from a retired experimental module and redirects its old page to Command Explorer while preserving other data. Quit the app before manually backing up or modifying the database; there is no database backup/export UI yet.

### Execution and confirmation

- Renderer Node integration is disabled; context isolation and sandboxing are enabled.
- Preload exposes only allowlisted APIs; main validates the sender, frame, and payload using Zod.
- Managed commands use backend-owned executable/argument arrays with `shell: false`.
- Every mutating managed action requires a one-use confirmation token that expires after 60 seconds and is bound to the relevant request/state.
- The backend rechecks the appropriate repository, refs, configuration, process, or metadata before execution.
- The managed runner allows up to 4 concurrent processes, with a normal timeout of 10 seconds or 60 seconds for network commands and Find searches.
- Retained output is capped at 128 Ki characters/512 chunks per execution; a process is stopped after more than 1 MiB is received. Known credential patterns are redacted before persistence.
- Runtime retains up to 12 execution records; persistent history retains up to 100 records.
- Native clipboard integration supports copying in packaged Electron builds.

**The terminal is your local-user shell**, with ordinary operating-system permissions. It is not restricted by the managed-command allowlist. Process-tree termination is best effort; deliberately detached/reparented processes may escape cleanup. External tools can still change state after the final validation.

## Project architecture

| Component | Technology |
| --- | --- |
| Desktop and packaging | Electron, electron-vite, electron-builder |
| Interface | React, TypeScript, Tailwind CSS, shadcn/ui on Radix, Lucide |
| State/data fetching | Zustand, TanStack Query, React Router |
| Database | better-sqlite3, Drizzle ORM |
| Terminal | node-pty, xterm.js |
| Contracts | Zod, typed preload/IPC |
| Testing | Vitest, Playwright Electron |

```text
src/
├── main/
│   ├── index.ts                  # Lifecycle, window, and cleanup
│   ├── ipc/                      # Authorized, payload-validated handlers
│   ├── security/                 # Sender validation and public errors
│   ├── infrastructure/
│   │   ├── database/             # SQLite schema/store/migrations
│   │   └── process/              # Process-tree termination
│   └── services/
│       ├── cli/                  # CLI discovery and bounded probes
│       ├── commands/             # Registry, policy, ports, permissions
│       ├── execution/            # Managed runner and redaction
│       ├── git/                  # Git reads, parsing, and watcher
│       ├── ssh/                  # Public metadata, config, agent actions
│       └── terminal/             # Shell discovery and PTY sessions
├── preload/                      # contextBridge allowlist
├── shared/                       # DTOs, Zod contracts, command groups
└── renderer/src/
    ├── components/ui/            # Shared shadcn/ui compositions
    ├── features/                 # Dashboard, commands, Git, SSH, terminal...
    ├── lib/                      # Queries, settings, session, clipboard
    └── App.tsx                   # Shell, sidebar, and routing
scripts/                          # Native helper/icon/packaging hooks
resources/                        # Application icons and assets
tests/                            # Unit/integration and Electron E2E
docs/superpowers/plans/            # Relevant implementation plans
```

Docker no longer appears in the sidebar. Some compatibility backend/UI code and Docker tests remain in the source; it is not a module exposed through the current sidebar flow. Workflows has been removed from the app.

## Scripts and testing

### Main scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the development app |
| `npm run build` | Build production output into `out/` |
| `npm start` | Preview the production build |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit/integration tests |
| `npm run pack` | Package the application as a directory |
| `npm run dist -- --mac --arm64` | Create the macOS Apple Silicon DMG |
| `npm run icon` | Regenerate icons using the project script |

### Electron E2E

Build before running E2E tests from source:

```sh
npm run build
npm run test:e2e
npm run test:e2e:runtime
npm run test:e2e:shell-tools
npm run test:e2e:find
npm run test:e2e:palette
npm run test:e2e:shortcuts
npm run test:e2e:workspace
npm run test:e2e:git
npm run test:e2e:extended
npm run test:e2e:command-packs
npm run test:e2e:ports
npm run test:e2e:files
npm run test:e2e:compare
npm run test:e2e:output
npm run test:e2e:zsh
npm run test:e2e:zsh-source
npm run test:e2e:favorites
npm run test:e2e:ui
```

| Suite | Coverage |
| --- | --- |
| `test:e2e` | Isolation, IPC, navigation, themes, and settings persistence |
| `test:e2e:shortcuts` | Platform keycaps, shortcut dialog dismissal/focus, modal command isolation, themes and minimum window sizing |
| `test:e2e:palette` | Palette keyboard/pointer selection, focus restoration, empty/error recovery, themes and compact window sizing |
| `test:e2e:find` | Whole-machine/no-depth-limit defaults with and without a selected repository, using a fake find executable |
| `test:e2e:shell-tools` | Twelve fixed CLI/system checks using fake executables, missing-tool feedback, clear finished runs and IPC restrictions |
| `test:e2e:runtime` | PTYs, multiple tabs, Ctrl+C, session closing, and process cleanup |
| `test:e2e:workspace` | Repository picker, preview/confirm/run, history, and insertion |
| `test:e2e:git` | Git Manager against temporary repositories |
| `test:e2e:extended` | SSH metadata/keygen/config, fake agent/network, and extended CLIs |
| `test:e2e:command-packs` | Permissions, fake AI/Cloudflare/ngrok CLIs, and shell continuity after Ctrl+C |
| `test:e2e:compare` | Grouped comparisons, equal/different status, Copy, retained inputs and removed Dart Version |
| `test:e2e:files` | Grouped file operations, confirmation/cancellation and real results in an isolated repository |
| `test:e2e:ports` | Port inspection and fixture-listener termination |
| `test:e2e:output` | Neutral successful stderr, failed-output styling, and unchanged status/text across result views |
| `test:e2e:zsh-source` | Source confirmation, one-time loading and persistent aliases/environment with an isolated `.zshrc` |
| `test:e2e:zsh` | Zsh inspection, syntax-only checks, isolated startup files, and Ctrl+C shell continuity |
| `test:e2e:favorites` | Drag/drop, keyboard ordering, filters, Dashboard, and restart persistence |
| `test:e2e:ui` | Responsive layouts, dropdowns, Dashboard, sidebar, dock, and keyboard behavior |

Run the same suites against a packaged application:

```sh
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:ui
DEVCOMMAND_EXECUTABLE="$PWD/release/mac-arm64/DevCommand.app/Contents/MacOS/DevCommand" npm run test:e2e:favorites
```

Replace the final script name to run another E2E suite. Run Electron UI suites **sequentially** to avoid keyboard-focus contention. Tests use temporary profiles/repositories and fake CLIs where appropriate; mutation tests do not use your real SSH agent or cloud accounts.

Screenshots are written to `resources/screenshots/` and ignored by Git because they may include machine names or paths. `node_modules/`, `out/`, `release/`, and `coverage/` are also excluded from commits.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Only `Contents/MacOS` is visible, with no `.dmg` | You are inside the `.app`; run `npm run dist -- --mac --arm64` and look directly in `release/` |
| The app still shows an older version | Quit it, replace the copy in Applications, and reopen it from Applications |
| Native modules/PTY fail after changing Node/Electron | Check Node 24+ and rerun `npm ci` to rebuild native dependencies; install Xcode Command Line Tools if a compiler is missing |
| The Dock shows Electron in development mode | Use the packaged `DevCommand.app` to check release branding |
| A CLI works in an external terminal but is missing in the app | Check the executable is on the app's search PATH; common locations such as Homebrew and `~/.local/bin` are added. Shell aliases/functions do not replace managed-command executables |
| Main/preload changes are not taking effect | Restart the app/development process to load the new preload/API |
| SSH agent unavailable | Check your OS agent and `SSH_AUTH_SOCK`, then refresh SSH/agent state |
| SSH test returns nonzero | Read the output; Git providers may authenticate successfully without offering a shell |
| Copy/Insert is disabled | Check validation, CLI availability, repository selection, and sensitive parameters |
| Ctrl+C only prints `[Session exited · code ...]` in an old session | That session has ended or uses a specialized tool PTY; create a new CLI session using the current app |
| History/database cannot be read | Check permissions and disk space; back up data before manual recovery instead of deleting the database to experiment |

## Current limitations

- macOS ARM64 is the primary tested platform. Intel macOS, Windows, and Linux have not received equivalent validation.
- Signing and notarization are not configured. Tag-based release distribution is configured in GitHub Actions and requires a successful remote run.
- CLI availability, OS permissions, shell setup, agents, and provider accounts affect actual behavior.
- Tunnel/AI/network/agent tests use fixtures and do not prove compatibility with every live account or SSH server.
- Managed Git does not provide force push, unmerged-branch deletion, rebase/cherry-pick, or a conflict editor.
- Custom shell-script registration, split terminal panes, and a database backup/export UI are not implemented.
- Insert currently supports zsh/bash on POSIX only; some CLI packs and SSH writes have additional platform restrictions.
- Commands entered directly in the terminal do not run inside an application-level command sandbox.

Revisit these limitations and validation results when adding platforms or tools; macOS results alone do not establish cross-platform support.
