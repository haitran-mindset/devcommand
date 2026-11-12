# Saved Commands

User-approved scope: local CRUD for personal shell commands, multiple tags, bulk tag assignment/removal, search/filter, exact copy, and confirmed execution in a new terminal tab. Existing built-in commands and Favorites stay separate.

1. Add shared validated contracts and SQLite migration v5. Preserve all existing data. Bound command/tag sizes and collection size; use revisions for edit/delete conflicts and atomic bulk tagging.
2. Add trusted IPC/preload API and a service that previews saved text, shell and cwd. Bind expiring single-use confirmations to the record revision and resolved directory. Revalidate on Run. Execute only explicitly confirmed commands using the existing terminal lifecycle; never save terminal output to managed history.
3. Add Saved Commands sidebar/page with compact local search, tag filters, selection/bulk tagging, create/edit/delete dialogs, copy toast, and a Run review dialog. Handle empty/loading/error/pending states and keyboard focus.
4. Verify migration, persistence, validation, CRUD conflicts, bulk atomicity, confirmation replay/stale command/directory, and terminal argv with mocks. Use isolated E2E profiles and harmless printf commands; do not access real SSH configuration or agents.

Execution: POSIX zsh/bash on supported macOS/Linux. Multiline script text is intentional user input and stays one shell argv element. New terminal shell remains after the command exits; no execution on save, copy or app startup. No release, dependency additions, or external service is needed for implementation.
