# `kilocode_change` Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

Most marker-associated behavior identified in the first report is restored or cleared. One new shared-file ownership issue and one narrowed race-tolerance gap remain. The current merge-base diff contains 1,214 files; the remediation range from the first reviewed snapshot, `a1d8b83b59..b42f911f76`, contains 256 changed files.

## Findings

### Medium: the active Kilo `/init` template is an unmarked shared-core divergence

`packages/core/src/plugin/command/initialize.txt:3,15,60` now contains Kilo-specific wording and `kilo.json` guidance. `packages/core/src/plugin/command.ts:7` imports that file as the active command template. This correctly fixes the user-facing regression, but the production divergence is neither isolated behind a Kilo-owned override nor annotated; only the assertions in `packages/core/test/plugin/command.test.ts:37-39` are marked.

The annotation checker currently misses this class of change because `packages/core` is outside its shared scopes and `.txt` is outside its source extensions. Adding a marker directly to the prompt would leak it into model input. Prefer a Kilo-owned template/override, or extend the ownership mechanism so shared prompt assets remain discoverable without changing prompt content.

### Medium follow-up: deleted-session FK tolerance is restored only for legacy writers

`KiloSession.runSyncSafe` correctly detects nested `SQLITE_CONSTRAINT_FOREIGNKEY` errors, and `packages/opencode/src/session/session.ts:724-748` applies it to legacy message and part publication. This clears the default first-party CLI and VS Code path.

The former guard covered the common next-event projector. Native `SessionEvent` writes in `packages/core/src/session/projector.ts` remain unguarded. They are reachable only through dormant/experimental execution: native v2 routes are omitted from `kilo serve` by `createListenerRoutes()` at `packages/opencode/src/server/routes/instance/httpapi/server.ts:286-290`, and legacy mirroring requires `KILO_EXPERIMENTAL_EVENT_SYSTEM`. Treat this as a follow-up before enabling native v2 prompting or event mirroring, with a deletion-race test covering the native projector.

## Resolved or cleared first-pass findings

- **Kilo-owned markers:** all eleven additions reported in the eight `packages/opencode/**/kilocode/**` source/test files were removed.
- **Darwin watcher behavior:** `packages/core/test/filesystem/watcher.test.ts:17-20` restores the CI exception, and `packages/opencode/test/kilocode/core-watcher.test.ts` plus the Darwin profile execute it.
- **Summary diff contract:** public and producer boundaries are patchless through `Snapshot.SummaryFileDiff`; the broad internal storage type does not expose patches.
- **V2 HttpApi source title:** `packages/server/src/api.ts:34` now says `kilo experimental HttpApi` with a marker. The stale generated OpenAPI output is tracked in `OPENCODE_MENTIONS.md`.
- **`/file/content` full-file patches:** no in-repository production consumer remains. The endpoint schema still advertises optional `diff`/`patch`, so external compatibility remains a product decision rather than a confirmed Kilo regression.
- **Configured-reference metadata:** directory attachments replaced the old producer path, while the compatibility reader remains. No product consumer of `metadata.reference` was found.
- **Config schema extraction:** Kilo fields and their runtime readers remain connected in the extracted schema.

## Commands and limitations

The review used explicit Git refs, including `git diff --name-status`, `git diff -Gkilocode_change`, `git show`, `git grep`, `git blame`, and `git diff --check` over both `origin/main...b42f911f76` and `a1d8b83b59..b42f911f76`. The annotation checker skips upstream merges, so marker preservation required manual ref comparison. No runtime suite was run for this marker-focused report; current PR checks, including annotations, generated artifacts, typecheck, and platform unit jobs, are green.
