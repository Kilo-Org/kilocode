# V1 session store schema audit (read-only)

Scope: phase-6 precondition from `plans/kilo-opencode-v2-issue-13750.md` — a
read-only schema diff of Kilo `main`'s session store against the v2
`V1Migration` expectations, plus the evidence for whether a copy-then-migrate
import is lossless (verdict: not proven lossless; known field transforms and
an unverified historical/malformed-store caveat).
This document changes no refs and runs no migration.

Sources compared:

- V1: Kilo-main `d99662338e3ddbd2613ab41fc0369837a6eb4be9` (the checked-out
  writer), release `1536aef0fbe96c4575d23e9de2d50ba897f6b8ac`, and local
  `origin/main` `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`
  (`packages/core/src/database/{schema.gen.ts,migration/*}`,
  `packages/opencode/src/storage/{db.ts,schema.ts}`,
  `packages/schema/src/v1/session.ts`, `packages/schema/src/file-diff.ts`).
- V2: worktree HEAD `59b29de40966803e2c7cd734d439843fb773f6a6`
  (`packages/core/src/database/v1-migration.bun.ts`,
  `packages/core/src/database/migration/*`, `packages/core/src/session/sql.ts`,
  `packages/schema/src/v1/session.ts`, `packages/schema/src/file-diff.ts`).
  HEAD is 5 commits past the recorded pin
  `76dbaf20adbd43fd208a00ef3cda4a51e125a234`; the migrator and migration set
  above are identical at both SHAs (verified by `git diff` on
  `packages/core/src/database/` — no changes between pin and HEAD).

## V1 store identity and shape

- Kilo v1 stores sessions in the `packages/core` Database at
  `Global.Path.data/kilo.db` (channel builds) or `kilo-<channel>.db`, overridable
  with `KILO_DB` (`origin/main:packages/core/src/database/database.ts`).
  `packages/opencode/src/storage/schema.ts` re-exports the same core tables;
  both entry points open the same file.
- A v1 store carries a `migration` journal table (TypeScript migration
  lineage), not only Drizzle's `__drizzle_migrations`. Journal ids at v1 main:
  the 38 shared ids plus two Kilo-only ids
  (`20260714141136_session-message-legacy-writer-compat`,
  `20260828074139_kilocode_board`).
- Table set (v1 bootstrap, `schema.gen.ts` on `origin/main`): `workspace`,
  `data_migration`, `account_state`, `account`, `control_account`,
  `credential`, `event_sequence`, `event`, `kilo_board_message`, `kilo_board`,
  `permission`, `project_directory`, `project`, `message`, `part`,
  `session_context_epoch`, `session_input`, `session_message`, `session`,
  `todo`, `session_share`. Indexes include Kilo's `recall_part_search_idx` on
  `part`.

## Migration-lineage compatibility

`DatabaseMigration.apply` (v2) takes the `applyOnly` path when a `session` (or
`session_v2`) table exists, reads the existing `migration` journal, and applies
only ids it knows that are not yet recorded.

- 38 migration files are shared between v1 main and v2 HEAD. Spot diffs
  (`20260323234822_events`, `20260127222353_familiar_lady_ursula`,
  `20260312043431_session_message_cursor`, `20260511173437_session-metadata`)
  show only cosmetic wrapper differences (`export default {…} satisfies` vs
  `const migration …; export default migration`, `.js` import suffixes); the
  executed SQL is identical.
- The two Kilo-only journal ids are unknown to v2 and ignored by `applyOnly`.
- The eight v2-only migrations were each checked against the v1 leftover
  shapes:

| Migration | Behaviour on a v1 copy | Verdict |
|---|---|---|
| `20260804233008_loose_psylocke` | v1 stores lack the pre-split marker `20260730195856_optional_session_title`, so the fresh-split branch runs: `CREATE TABLE IF NOT EXISTS` for `kv`/`instruction_*`/`session_pending`/`session_v2`; `ALTER TABLE event ADD created` (v1 `event` has no `created` — applies cleanly); recreates `session_message` with `seq NOT NULL` and an FK to `session_v2`, dropping v1's nullable-seq `session_message` rows (rebuilt later by the migrator from `message`/`part`); `DROP TABLE data_migration`, `session_context_epoch`, `session_input` — all present in v1. | compatible |
| `20260805200742_import_legacy_credentials` | Reads `Global.data/auth.json`; absent under the isolated `kilo2` identity (and `paths.preflight` rejects it there), so a no-op. Credential import stays with the auth/config owner. | compatible (no-op) |
| `20260808023530_workspace_domain` | `DROP TABLE workspace` then recreates the v2 shape. v1's control-plane `workspace` table exists and no v1 table FK-references it (v1 `session.workspace_id` has no FK). | compatible |
| `20260811161259_execution_claim_attempts` | `ALTER TABLE session_v2 ADD resume_attempts` on the freshly created table. | compatible |
| `20260812181746_session_inbox` | `CREATE TABLE session_inbox`; absent in v1. | compatible |
| `20260812213948_worktree` | `CREATE TABLE worktree` + `INSERT … SELECT` from `project_directory`; v1 has `project_directory(project_id, directory, type, strategy, time_created)`. | compatible |
| `20260819222447_session_viewed_state` | `ALTER TABLE session_v2 ADD time_idle/time_viewed/idle_outcome`. | compatible |
| `20260823191254_nullable_workspace_binding` | Recreates `workspace` (created by `workspace_domain`). | compatible |

## Migrator expectations vs v1 actuals

`V1Migration.run` (bun build only) operates on the database it is opened
against. On a v1 copy:

- Detection: `hasLegacySessions` finds `session` → `required`. On an empty
  `kilo2` store there is no `session` table → migrator is a no-op (the phase-0
  boot assertion).
- `DELETE FROM event …` clears v1's durable event log by design. v1 `event`
  rows (schema: `id, aggregate_id, seq, type, data`) are **not** migrated; v2
  rebuilds projections from `session_message` + `event_sequence` watermarks.
  This matches upstream's treatment of upstream v1 stores.
- Sessions: `INSERT OR IGNORE INTO session_v2 (…) SELECT … FROM session` copies
  `id, project_id, workspace_id, parent_id, slug, directory, path, title,
  version, share_url, summary_*, metadata, cost, tokens_*, revert, permission,
  agent, model, time_created, time_updated, time_compacting, time_archived`.
  Every selected column exists in v1's `session` (verified against
  `origin/main` `packages/core/src/session/sql.ts` and bootstrap DDL).
  `session_v2`'s FK to `project(id)` is satisfied because the `project` table
  is shared and survives in place; sessions whose `project_id` is missing from
  `project` are reassigned to `Project.ID.global` with a logged warning.
  `fork_session_id`/`fork_boundary` stay NULL (v1 has neither).
- Projects: the `project` table itself is not copied (same table, already
  present); the migrator only `INSERT OR IGNORE`s the global project row with
  `sandboxes='[]'`. v1 `project` has `sandboxes NOT NULL`; v2's ProjectTable is
  column-identical.
- Messages/parts: `message.data` and `part.data` JSON decode through v2's
  `SessionV1` schemas (`packages/schema/src/v1/session.ts`) and are rewritten
  into `session_message` rows (`user`/`synthetic`/`assistant`/`compaction`
  types). Tool parts preserve `input`/`output`/attachments/`metadata` for
  `completed` and `error` states; `running`/`pending` tools become
  `tool.interrupted` errors (v1 cannot have live executions across the cutover).
  Compaction pairs fold into `compaction` messages with rendered `recent` text.
- Session aggregates (`cost`, `tokens_*`, `agent`, `model`) are recomputed from
  assistant messages; `revert` and `time_compacting` are reset to NULL.

## Kilo deltas that are **not** preserved by the transform

These are v1-main `kilocode_change` fields absent from v2's `SessionV1`
schemas. Effect Schema strips unknown keys on decode, so rows still decode, but
the field values are silently dropped from migrated data:

| v1 field | Where | Fate |
|---|---|---|
| `StepFinishPart.model/generationID/vercelID/metrics/time` (per-step generation metrics) | `part.data` | stripped; only `snapshot` is read from step-finish parts |
| `SubtaskPart.variant` (workflow variant) | `part.data` | stripped; subtask parts are otherwise only used to detect subtask-only user messages |
| `UserMessage.editorContext` (VS Code editor context) | `message.data` | stripped |
| `Revert.workspace` restore status | `session.revert` | moot: the transform resets `revert` to NULL for all sessions |
| v1 `session_message` rows (dual-written projection) | table | dropped by `loose_psylocke` and rebuilt from `message`/`part` |
| `todo` rows | table | never read by the migrator; left as a leftover table |
| `session_share` rows (share id/secret/url) | table | never read; only the denormalized `session.share_url` column carries over |
| `account`, `account_state`, `control_account`, `credential` | tables | never read; credential import is the auth/config owner's scope |
| `kilo_board`, `kilo_board_message` (Agent Manager) | tables | never read; v2 has no board consumer |
| `event` rows | table | deleted by design |

## FileDiff shape correction and remaining caveat

An earlier version of this audit incorrectly said that v1's `FileDiff.Info`
marks `additions` and `deletions` optional. That is false for each exact
Kilo-main ref available locally. At `d99662338e3ddbd2613ab41fc0369837a6eb4be9`,
`1536aef0fbe96c4575d23e9de2d50ba897f6b8ac`, and
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`:

- `packages/schema/src/file-diff.ts` defines both fields as
  `Schema.Finite` in `FileDiff.Info`.
- `packages/schema/src/v1/session.ts` uses `FileDiff.Info` for user summary
  diffs, and the schema is unchanged between `d996623` and its two descendants
  for this shape. The only relevant descendant change in that file adds
  `SessionRevert.workspace`.
- `packages/core/src/event.ts` validates durable event data before persistence,
  so the actual writer rejects a missing count before it can write a message.

V2's `FileDiff.LegacyInfo` also requires both numbers. The companion
`v1-fixture-generation.md` records an actual writer-generated fixture with
valid counts; its user message migrates successfully. This establishes the
valid-count path for the checked refs, not universal preservation for arbitrary
databases.

An older historical writer or a malformed v1 database could still contain a
persisted `diffs` entry without one of these fields. Such a row would fail the
v2 `SessionV1` decode and the entire user message would be skipped with an
`invalid-message` warning. No such historical writer ref is present locally,
and this audit does not fabricate one by casting, editing SQL, or bypassing the
writer. The caveat therefore remains unverified rather than a demonstrated
blocker for the exact writer refs above.

## Copy consistency (the tested seam)

Runtime spike on the packaged Bun (`packages/kilo-cli/dist/interactive/bun`,
1.4.x), against a quiescent synthetic WAL-mode fixture: a `readonly`
`bun:sqlite` connection saw committed-but-uncheckpointed WAL rows; `VACUUM
INTO` from that connection produced a standalone copy containing those rows;
`PRAGMA integrity_check` on the copy returned `ok`; the source file bytes
were unchanged and no `-wal`/`-shm` files were created for the source. The
copy is atomic when written to a temp file in the destination directory and
published with a no-clobber hard link. `VACUUM INTO` is not the only such
mechanism — SQLite's online backup API would serve as well — but bun:sqlite
exposes no backup binding, so `VACUUM INTO` is the available one here.

Honesty limits of the source-unchanged check: the helper hashes the two
content-bearing files (the database and its `-wal`) before opening the source
and again after copying; identical SHA-256 bytes prove no byte-level change
**in the tested quiescent fixture**. The `-shm` wal-index is deliberately
excluded: it is a rebuildable index, and any SQLite reader may legitimately
update its read marks. A live v1 process appending to the WAL will change
bytes without my module touching anything. The check is therefore a
conservative *detector* (any content-byte change refuses the publish), not a
proof that read-only access has zero observable side effects. Import from a
quiescent source.

## Verdict

- Schema mapping for **projects, sessions, and tool-call content** runs
  entirely on upstream machinery (`DatabaseMigration.apply` + `V1Migration.run`)
  with no Core fork. The real writer fixture exercises the valid-count
  message path; known Kilo fields are still dropped or reset, and arbitrary
  historical/malformed stores remain outside the evidence.
- The import is **not proven lossless**. The table above lists what the
  transform drops or resets. An omitted-count row from an unknown historical
  or malformed store could also drop its entire user message during decode, but
  no checked writer ref emits that shape.
- This slice ships an **unintegrated candidate utility** (inspection +
  consistent copy). It is not a wired importer: nothing calls it from the
  CLI, no migration of a copied store is wired or authorized, and the
  remaining work is **blocked** on the gates below, all outside this slice's
  file ownership.

## Remaining gates (owners noted)

1. `packages/kilo-cli/src/storage.ts` `prepare()` refuses any store containing
   a `session` table and any store without the `_kilo_preview` marker
   (ownership/channel seal). A migrated copy still contains the leftover v1
   tables, so the next boot after an import would be refused. Relaxing or
   sequencing that guard is host wiring owned by the parent slice.
2. A real writer-generated fixture now covers the valid-count path for the
   checked refs; see `kilocode/baseline/v1-fixture-generation.md`. An exact
   historical writer that permits omitted counts is not available locally, so
   malformed-store handling remains an evidence gap rather than a fabricated
   preservation claim.
3. `auth.json` credential import and `kilo.jsonc` key mapping are explicitly
   owned by another agent and are not touched here.
4. End-to-end "import then boot and open a migrated session" validation
   requires the parent CLI command wiring (`kilo2 import …`) that owns
   detection, prompt, and destination selection.
