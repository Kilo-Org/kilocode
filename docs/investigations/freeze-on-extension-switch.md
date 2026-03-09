# Investigation: Freeze / Crash When Switching from Legacy Extension

**Issue:** [#6721](https://github.com/Kilo-Org/kilocode/issues/6721)
**Symptom:** Long freeze (a few minutes), high CPU, when first launching the new extension after using the old Kilo Code v5.x extension.

---

## Root Cause

### The JSON → SQLite One-Time Migration

The most likely cause is the **one-time database migration** the CLI runs on its very first startup.

When the CLI (`kilo serve`) starts for the first time, it checks whether `~/.local/share/kilo/kilo.db` exists. If it does not (i.e. first run of the new extension), it runs `JsonMigration.run()` before starting the HTTP server (`packages/opencode/src/index.ts:131-165`).

This migration scans `~/.local/share/kilo/storage/` and reads every JSON file for all past sessions:

- `project/*.json`
- `session/*/*.json`
- `message/*/*.json` — one file per message, per session
- `part/*/*.json` — one file per message part
- `todo/*.json`, `permission/*.json`, `session_share/*.json`

For a heavy user of the old extension who already had the new CLI installed (e.g. via `kilo` TUI) and accumulated many sessions, this can involve **thousands of JSON files**. The CLI itself says "may take a few minutes" (`packages/opencode/src/index.ts:133`).

**The critical problem:** The VS Code extension's `ServerManager` waits for the CLI to emit its port to stdout before marking startup as complete, with a **hard 30-second timeout** (`server-manager.ts:122-128`). The migration runs _before_ the port is emitted. If the migration takes longer than 30 seconds, the extension kills the process and throws `"Server startup timeout"`, causing the extension to appear frozen and then crash.

Even when it finishes within 30s, the migration is CPU-bound file I/O running in the foreground, which explains the high CPU usage observed by users.

### Secondary: Two Extensions Running Simultaneously

If users still have the old `kilo-code` (v5.x) extension enabled alongside the new one, both extensions are active at the same time. The old extension is itself heavyweight at startup — it scans task history, initializes the auto-purge scheduler, etc. The combined startup load of two full extensions can cause a perceptible freeze in VS Code.

### What Was Previously Ruled Out

- **Migration wizard** (`checkAndShowMigrationWizard`): This runs _after_ the CLI connection is established and only reads SecretStorage + a few small files. It is unlikely to be the cause.
- **Large marketplace GIF**: Already removed.

---

## Evidence

| Location                                                                  | Relevance                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/opencode/src/index.ts:130-165`                                  | JSON→SQLite migration runs on first startup, before port is emitted |
| `packages/opencode/src/storage/json-migration.ts:108-118`                 | Scans all session/message/part files before processing              |
| `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:121-128` | 30-second startup timeout — migration can exceed this               |
| `packages/opencode/src/index.ts:133`                                      | CLI itself warns "may take a few minutes"                           |

---

## Recommended Fixes

### 1. Detect and surface migration progress in the extension (highest impact)

The CLI already emits progress on stderr in non-TTY mode:

```
sqlite-migration:0
sqlite-migration:25
...
sqlite-migration:done
```

The `ServerManager` already listens to `serverProcess.stderr` but only logs it. It should:

- Parse `sqlite-migration:N` lines and report progress to the VS Code UI (e.g. via `vscode.window.withProgress`)
- Extend the startup timeout while migration is in progress (or remove the timeout during migration and apply it only after `sqlite-migration:done`)

### 2. Increase the startup timeout

The 30-second hard limit (`server-manager.ts:122`) is too short for users with large session histories. A more generous timeout (e.g. 5 minutes) with a progress indicator would prevent false "Server startup timeout" crashes.

### 3. Run the JSON migration as an explicit step before spawning the server

Alternatively, run the migration as a separate `kilo db migrate` command _before_ spawning `kilo serve`. This makes it easier to show progress without modifying the serve startup path, and the server timeout only starts after migration completes.

### 4. Prompt users to disable the old extension

After migration, show a notification guiding users to disable the legacy `kilo-code` extension. Running both simultaneously doubles startup overhead.
