# Kilo profile upgrade: client contract

## What this means for each client

**If you still need the current JetBrains plugin, choose Not now.** Installing or updating a client is not consent. The data choice affects every client using that database.

| Client | Distribution and behavior |
| --- | --- |
| CLI / TUI | `@kilocode/cli@kilo-v2` exposes the `kilo` command. The npm tag remains separate from v1's `latest` and `rc`, but installing into the same npm prefix replaces the executable. The profile is shared. |
| VS Code | `kilocode.kilo-code-v2` remains a separate product with its own `kilo-code.v2.*` settings and commands. It starts its bundled `kilo`, not the binary on `PATH`. **Not now** stops activation. Reload to reconsider. Do not run the v1 extension on a converted profile. |
| Agent Manager | Worktrees and the session associations in `.kilo/agent-manager.json` stay in place. The new extension's disposable pool uses its own namespace under the stable data directory. |
| JetBrains | Its current plugin starts a v1 CLI which expects v1 workspace records. Retaining session IDs is not schema compatibility. There is no automatic backup fallback or JetBrains port in this change. |
| Desktop | Its external sidecar adapter must implement the same preflight, consent, observe and completion protocol before using the shared profile. This change does not implement that adapter. |

## Paths and startup

The CLI, background service, and extension use `kilo` under the XDG config/data/cache/state bases, `kilo.db`, `kilo.json[c]` and `.kilo/`. A distribution channel is not a data namespace. There is no automatic discovery or import from the discontinued preview directories. Stable settings and skills are read at their existing paths. The Kilo selectors `KILO_DB`, `KILO_CONFIG`, and `KILO_CONFIG_DIR` win over the corresponding `OPENCODE_*` variables. Relative database overrides are resolved against the Kilo data directory.

The explicit database or existing canonical `kilo.db` is authoritative. If neither exists, one legacy channel database may be selected at its existing path. If several alternatives exist, select the intended file explicitly; no histories are silently merged. The worktree and configuration roots in a completed migration receipt must match the caller. The journal lives beside the selected store under `.kilo-migration/`, not under another application's data directory.

Run `kilo migrate preflight` using the same environment and working directory as the intended server. It returns one versioned JSON object on stdout. Nonzero exit, malformed data, or unknown status means stop. Probing the schema never opens a live v1 store for writing. If a newly initialized schema is still only in a WAL, a bounded private snapshot is used. Do not start the service to discover whether migration is needed.

| Status | Action |
| --- | --- |
| `absent` | Normal first launch bootstraps the selected stable database. Stable config, skills and auth files can already exist; unresolved legacy resources are reported before startup. |
| `native` | A v2 database is already present. Reopen it without conversion or a new recovery copy. |
| `required` | Show source size (including WAL), available space, backup path and JetBrains warning. Only after explicit acceptance run `migrate apply --accept-jetbrains-breakage`. |
| `running` with `canObserve` | Run `migrate observe` and follow the existing owner. Observers cannot start a conversion. |
| `completed` | Start after verifying the receipt and current workspace policy. |
| `failed` or `interrupted` | Stop. Inspect the reported paths and request fresh consent for `migrate recover --accept-jetbrains-breakage`. |

Migration reports newline-delimited JSON progress. Wait for the exit status and confirm completion with a fresh preflight. Headless startup cannot consent. `--version` is profile-free so package managers can verify an install without triggering migration.

## Limits and recovery

- Keep every v1 client using this profile closed during migration and do not reopen the v1 database path in that client afterwards. Publication is supported on trusted local APFS, ext4, XFS and Btrfs volumes. Windows and unknown filesystems refuse conversion; this does not preclude opening a native v2 store.
- Conversion reuses upstream's session converter in a private stage. Unexpected skipped transcript rows, unsupported per-session permissions, incompatible plugins or unrepresentable settings stop publication. Do not remove a deny rule just to get past the guard.
- Legacy project workflows, skills outside stable discovery and `.kilocodeignore` read/edit rules require reconciliation if they cannot be represented. Known project directories and newly opened locations are checked. The migrator does not rewrite project files across repositories.
- Supported file-backed sign-ins are verified against the converted database; credentials do not appear in progress output. The original database becomes a private `0600` `.pre-v2` recovery copy. Never send it in support bundles.
- Settings and other additive resources are installed after publication. Explicit recovery verifies the accepted inputs and finishes interrupted work. Under the owner lock, it can reclaim the previous run's verified scratch directory and handle an interrupted backup link. Unrelated backups and unverifiable state are not overwritten.
- An offline v1 restore requires first stopping all clients and preserving current v2 files, including their WAL. Restoring the recovery copy cannot restore edits made after cutover.

## Synthetic manual test

Run `bun packages/kilo-cli/script/migration-rehearsal.ts 8` from this checkout.
It creates a temporary home, seeds eight synthetic sessions, runs the full cutover
through `bun dev`, verifies both histories, and removes only its own fixture.
Use `1024` for the multi-gigabyte rehearsal. The space measurement is the observed
change in free space on the volume during the run, not a guaranteed requirement.
