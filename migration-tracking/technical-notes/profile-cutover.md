# Internal profile cutover: client handoff

## What this means for each client

**If you still need the current JetBrains plugin for this profile, choose Not now in the CLI or VS Code.** Consent applies to the shared database, not just to the client that asks. Installing or updating a client does not give consent.

| Client | Decision and consequence |
| --- | --- |
| **JetBrains** | The current plugin starts its own v1 CLI and expects the v1 workspace schema. Keeping old session rows does not make the converted schema compatible. This change does not port the plugin, add a compatibility layer, or redirect it to the backup. Close it before accepting elsewhere and do not reopen it on the converted profile. The private `.pre-v2` copy is for offline recovery; it does not receive later v2 edits. |
| **CLI / TUI** | The interactive launcher shows the source, size, backup path and JetBrains warning before the normal database open. Declining exits without switching. Headless startup cannot consent on the user's behalf; explicit apply requires `--accept-jetbrains-breakage`. |
| **VS Code** | The extension prompts before starting its local server. **Not now** stops activation; reload to reconsider. On acceptance the server starts only after a fresh check confirms the same migrated profile. If another client is migrating, the extension can observe its progress. |
| **VS Code Agent Manager** | Session IDs alone do not preserve worktree membership. A known project's unresolved `.kilo/agent-manager.json` blocks migration and names the file, even if preview state also exists. Keep both files for reconciliation. |
| **Kilo Desktop** | This change documents the preflight, consent, observe and completion contract for Desktop's local sidecar. It does not change the Desktop app or establish support for migrating from it. |

Only one process converts a given source. A client that selects different preview databases or configuration roots cannot reuse another client's completion result. Close all v1 and preview clients sharing the store before accepting. Windows and unsupported filesystems refuse publication.

## Implemented: read-only discovery

Before starting a local service, run its matching executable with `migrate preflight`.
Read one JSON object from stdout on exit 0. Treat a nonzero exit or unknown `version`
as unavailable, not as an empty profile. The current contract is version 1:

| Field | Meaning |
| --- | --- |
| `status` | `required` means the selected source file exists; `absent` means it does not. This probe does not validate the SQLite schema. |
| `source`, `sourceBytes`, `walBytes` | Selected v1 database and its observed file sizes, including uncheckpointed WAL bytes separately. |
| `previewStores` | Existing preview database paths that must be considered before switching profiles. |
| `authFiles` | Stable and preview data-directory `auth.json` paths. Preflight does not read their contents. After consent, supported API keys, OAuth sign-ins and well-known credentials are imported into the private candidate and verified there before publication. Different values for the same provider block the switch and identify the files without printing credentials. |
| `backup`, `availableBytes` | Proposed recovery file and available bytes on the source volume. No space is reserved. Neither field guarantees enough room for conversion. |
| `legacyData`, `legacyConfig`, `legacyDefaultConfig`, `previewConfig` | The converter inventories both the `KILO_CONFIG_DIR` override and v1's default `$XDG_CONFIG_HOME/kilo` (once if identical), plus the preview config root selected by `KILO2_CONFIG_DIR`, `OPENCODE_CONFIG_DIR`, or the XDG default. Compatible files are added to `legacyConfig`; conflicting inputs stop publication and name the files to reconcile. |
| `legacyConfigFile`, `previewConfigFile` | Optional absolute paths from `KILO_CONFIG` and `KILO2_CONFIG` (or `OPENCODE_CONFIG`), respectively. A single explicit document stays in place and retains its precedence and relative references. If both paths are different, the pilot reports both and stops; reconcile the settings and point both overrides at the same document. Overrides remain scoped to the environment of the launching client. |

On **Not now**, close the prompt without starting the cutover. `migrate decline`
also returns a `declined` acknowledgement and persists nothing. Before first consent,
neither operation opens SQLite, creates profile directories, or starts the normal host. Installation
does not run either command. Do not offer an enabled **Migrate** button based on
this inventory alone.

## Internal launch protocol

The source launcher sets `KILO_INTERNAL_PROFILE_CUTOVER=1`. Compiled CLI binaries
enable the gate only when built with `KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1`;
an ordinary compiled CLI refuses `apply` even if the runtime flag is set.
The pilot VS Code extension host must enable the same pre-boot gate (see its README).
It is a pre-configuration switch:
neither repository settings nor an installed extension should enable the pilot
implicitly. Do not dispatch `kilo-v2-publish.yml` for a company-only build.

The source inventory includes `kilo.db`, `kilo-<channel>.db`, the older
`opencode-<channel>.db` names in the v1 data directory, and any explicit `KILO_DB`.
A lone channel store is converted at its existing path. If those names identify
multiple paths, the pilot stops and lists them all before selecting a history.

| Preflight state | Action |
| --- | --- |
| `absent` | No candidate database or recognized v1 resources. Keep the existing preview profile. |
| `required` | Confirm explicitly, or stop. Only after acceptance: run `migrate apply --accept-jetbrains-breakage`. |
| `running` with `canObserve` | Run `migrate observe`. It never claims ownership or starts a run. |
| `completed` | Start the sidecar. Preflight and boot require the caller's source, preview databases and config/state roots to match the accepted receipt in the canonical database. Different selections are reported, not adopted. Old pilot markers without a receipt require manual review. |
| `failed`, `interrupted`, unknown, malformed or incompatible version | Keep the sidecar stopped. Show the last phase, recovery path and error. Do not silently create a fresh store. |

`apply` and `observe` emit newline-separated JSON objects on stdout with `phase`,
optional `done` and `total`, and `status`. Keep stderr for diagnostics. Only a
successful process exit means the command finished; a last count of N/N is not
completion. Don't apply a server-start timeout to this process. Keep legacy and
preview clients closed until completion. A recovery database contains credentials
and session contents; keep it private and out of support bundles.

## Client integration for the internal build

The terminal launcher, VS Code extension host and Kilo Desktop Electron main process
should run discovery with the same environment as their sidecar. Display the path,
sizes, recovery location and the JetBrains incompatibility before opening that store.
Desktop should relay structured data to React over IPC; use a startup card rather
than waiting for an already-running sidecar. VS Code should use a native confirmation
in the extension host. Headless commands must not imply consent.

After consent, progress must come from the single process doing the migration,
including backup and verification; the upstream sidecar status endpoint alone only
reports its own session converter. Other windows observe that owner. The cutover
and client consent flows must be verified before enabling the internal build.

## Pilot limits and recovery

- Close **all** v1 and preview clients that use these stores. Multiple new clients
  can observe the same run. The owner lock cannot prevent a fresh legacy launch.
- Settings or sign-ins without a v1 session database are a **resource-only profile**.
  Its migration is not supported in this pilot. Preflight and startup stop before
  opening a database and list the detected paths, including auth, config, skills,
  workflows and model preferences. They do not print the contents of these files.
- Publication requires a local APFS, ext4, XFS or Btrfs volume. Windows, network
  volumes, ambiguous aliases, active writers and unsupported layouts fail closed.
- Divergent preview stores, config conflicts, unsupported plugins and legacy
  resources that cannot be represented safely require manual reconciliation. No
  preview database is deleted. User project files are not bulk-renamed across
  repositories. Before switching, the pilot inspects the current project, directories
  referenced by sessions and worktrees, their applicable ancestors, and linked
  checkouts' primary-config fallback. Remaining `kilo2.json[c]`, `.kilo2` resources
  or legacy `.kilo/workflows` stop the switch with their paths. Move or reconcile
  them into the release layout and retry. Agent Manager's preview state stays under
  `.kilo2`. A legacy `.kilo/agent-manager.json` in a known project blocks cutover
  even if a preview state file exists: the database converter cannot verify the
  worktree assignments or merge the two editor state files. Keep both files and
  the worktrees intact until the associations are reconciled. Unopened projects with no stored sessions
  or worktree references are outside this inventory.
- If the session converter reports a skipped transcript row (invalid message, invalid
  part, or orphan part), the pilot discards the staged conversion and leaves the v1
  database active. Its failure status identifies the affected session and sample
  row IDs without including message text. Retrying requires explicit recovery.
- Nonempty or malformed per-session permission rules stop conversion and identify
  the affected session. The upstream converter cannot preserve those overrides;
  do not discard a deny rule to make the migration proceed.
- Configuration and model/skill files are installed **after** SQLite publication.
  The accepted output fingerprint is in the published database. A late SQLite lock
  failure therefore leaves the old profile's settings untouched. After a crash
  following publication, startup stays blocked; explicit recovery rechecks the
  original inputs and idempotently finishes any missing files before reporting success.
- The recovery inode is restricted to `0600` before creating its backup name;
  on macOS an explicit ACL requires review. Recovery contains sign-ins as well as history.
- On failure, keep the reported source and recovery file. After resolving the cause,
  `migrate recover --accept-jetbrains-breakage` retries an unpublished conversion,
  or verifies a completed replacement and repairs the status without converting
  again. Recovery refuses unrelated backups, partial publication or unverifiable
  state. Do not delete the journal or open the only recovery copy for writing.
- To return to v1, stop the clients and preserve the current v2 database (including
  any WAL) and config first. Restore the verified pre-v2 SQLite copy into an offline
  v1 profile. A restore cannot include edits made in v2 after the cutover. Additive
  config migration leaves existing files intact; review newly added commands/skills.

## Synthetic manual test

The local darwin-arm64 private VSIX was also installed into an isolated VS Code
extensions directory with auth disabled. Its embedded executable matched the private
build's SHA-256. Decline preserved the Kilo data/config/state inventory, hashes and
mtimes. After consent and another reload, **Packaged migration fixture** appeared
under Recent. The recovery database retained its message and passed `integrity_check` at `0600`.

The macOS VS Code self-test was also exercised in a real Extension Development Host:
private extension build, temporary workspace and user directory, `--auth false`,
one synthetic v1 session and a preview instructions file. **Not now** stopped
activation with unchanged data/config/state file inventory, SHA-256 hashes and
mtimes. On the next launch, **Back up and migrate** produced `Converting sessions
1/1`, `Profile ready` and `migrate apply: exit 0` in the extension output. The
Kilo sidebar listed **Synthetic consent rehearsal** under Recent. The active
`session_v2` and recovery `session` tables both contained `ses_consent_ui_fixture`;
the original message was present in the recovery DB and its integrity check passed.

Run `bun packages/kilo-cli/script/migration-rehearsal.ts 8` from this checkout.
It creates a temporary home, seeds eight synthetic sessions, runs the full cutover
through `bun dev`, verifies both histories, and removes only its own fixture.
Use `1024` for the multi-gigabyte rehearsal. The space measurement is the observed
change in free space on the volume during the run, not a guaranteed requirement.
