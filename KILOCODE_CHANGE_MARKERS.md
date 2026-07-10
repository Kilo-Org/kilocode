# `kilocode_change` Review: PR #12088

## Scope

- Compared `review/upstream-merge-12088` (`a1d8b83b59`) with `origin/main` using the three-dot merge-base diff.
- Checked all **1,206 changed files** from the complete `git diff --name-status origin/main...HEAD` list. The review combined file-by-file diff classification with manual comparison of every marker-changing file, every changed file that contains markers in either revision, deleted/moved marker owners, and the corresponding v1.16.2 upstream implementations.
- The diff contains 115,443 insertions and 46,254 deletions. Of the changed files, 276 contain markers at `HEAD`; 109 files directly add, remove, or alter marker lines.

## Concrete Findings

1. **Kilo's git-based full file diff behavior was dropped from `/file/content`.**
   - `origin/main:packages/opencode/src/file/index.ts` used the marked `DiffFull.file(...)` path and returned `patch` and `diff` for modified files, specifically to avoid the JS Myers implementation and its large-file freeze.
   - The replacement at `packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts:66-79` matches upstream and returns only content plus binary metadata. No replacement calls `DiffFull.file`, although the endpoint schema still permits `diff` and `patch`.
   - This is a concrete loss of behavior associated with a removed marker block. Restore the Kilo hook in the replacement handler/service or explicitly confirm that clients no longer require file-content diffs.

2. **Deleted-session foreign-key race tolerance was not moved to the new session projector.**
   - `origin/main:packages/opencode/src/session/projectors-next.ts` wrapped `SessionMessageUpdater.update(...)` in a marked guard that ignored only `SQLITE_CONSTRAINT_FOREIGNKEY` failures caused by late writes after session deletion.
   - `packages/core/src/session/projector.ts:112-208` now invokes the updater without that guard, and its writes use `Effect.orDie`. No equivalent foreign-key detection exists in `packages/core/src`.
   - This can restore the deleted-session race failure unless the new transactional EventV2 architecture makes the race impossible. Treat this as a behavior regression unless that invariant is verified.

3. **The lightweight `summary_diffs` contract was broadened back to include patches.**
   - `origin/main:packages/opencode/src/session/session.sql.ts` deliberately typed `summary_diffs` as marked `Snapshot.SummaryFileDiff[]`, which excludes `patch`.
   - `packages/core/src/session/sql.ts:40` now stores `Snapshot.FileDiff[]`; `packages/core/src/v1/session.ts:331-337` defines that shape with optional `patch`; and `packages/core/src/session/projector.ts:61` persists it unchanged.
   - This loses the marked Kilo restriction intended to keep summary diffs lightweight. Verify storage/SSE expectations and restore the no-patch schema if the restriction remains required.

4. **The v2 OpenAPI title reverted from Kilo to OpenCode.**
   - The deleted marked title in `origin/main:packages/opencode/src/server/routes/instance/httpapi/groups/v2.ts` was `kilo experimental HttpApi`.
   - Its replacement is `opencode experimental HttpApi` at `packages/server/src/api.ts:34`, exactly matching upstream v1.16.2.
   - Restore Kilo branding and annotate it in the new shared file, unless this API is intentionally exposed under upstream branding.

5. **The marked macOS CI watcher-test exception was lost during the test move.**
   - `origin/main:packages/opencode/test/file/watcher.test.ts` intentionally ran native watcher tests when `KILO_TEST_PROFILE === "darwin"`, including under CI.
   - `packages/core/test/filesystem/watcher.test.ts:17` now uses upstream's `Watcher.hasNativeBinding() && !process.env.CI`, so the selected Darwin CI profile skips the watcher suite.
   - This removes native macOS coverage introduced by commits `07c136d0d1` and `276c5471b5`. Reapply the exception at the new test location if that profile still provides the coverage.

6. **Eleven new markers were added inside eight Kilo-owned paths.**
   - Repository policy and `script/check-opencode-annotations.ts:22-26,87-90` exempt paths containing `kilocode`; markers there are redundant and misleading during future upstream merges.
   - Newly affected files: `packages/opencode/src/kilocode/config/default-plugins.ts`, `packages/opencode/src/kilocode/permission/drain.ts`, `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts`, `packages/opencode/src/kilocode/session/index.ts`, `packages/opencode/test/kilocode/permission/env-read.test.ts`, `packages/opencode/test/kilocode/permission/external-directory-allow.test.ts`, `packages/opencode/test/kilocode/permission/next.always-rules.test.ts`, and `packages/opencode/test/kilocode/server/permission-allow-everything.test.ts`.
   - Remove only the newly introduced marker text; retain the associated Kilo behavior.

## Human Verification

- `packages/opencode/src/session/prompt.ts`: marker normalization dry-run would rewrite the file and reports 15 upstream-only deleted lines. The removed configured-reference metadata injection appears to have been replaced by upstream's root-directory attachment model and corresponding tests, but product owners should confirm that Kilo clients do not depend on the former `metadata.reference` text parts.
- `packages/opencode/src/config/config.ts`: marker normalization dry-run would rewrite the file and reports 25 upstream-only deleted lines. The removed inline schemas appear to have moved to marked `packages/core/src/v1/config/*` definitions, with Kilo fields retained, but this large schema extraction should receive a config-owner confirmation before merge.

## Notable Non-Findings

- The marked `auth-v2.json` migration and OAuth `accountId` preservation moved to `packages/core/src/auth.ts`; `packages/core/test/kilocode/account-auth-v2-migration.test.ts` still covers the behavior.
- PTY self-command resolution, session association, `KILO_PTY_ID`, and server-credential stripping moved to `packages/opencode/src/pty-preparation.ts` and `packages/core/src/pty.ts` with markers retained.
- Sandbox-decorated filesystem mutations and hardened containment checks moved from `packages/core/src/filesystem.ts` to marked `packages/core/src/fs-util.ts`.
- The well-known `kilo` provider ID moved from the deleted provider schema to marked `packages/core/src/provider.ts`.
- Runtime file-watcher feature flags survived in the new core watcher; only the Darwin CI test exception identified above was lost.
- Existing irregular marker delimiters in `packages/opencode/src/provider/provider.ts` and `packages/opencode/src/session/message-v2.ts` were already present on `origin/main`; they were not introduced by this PR.

## Commands

- `git diff --name-status origin/main...HEAD`
- `git diff --numstat origin/main...HEAD`
- `git diff -Gkilocode_change origin/main...HEAD`
- `git grep -n kilocode_change origin/main -- ...` and `git grep -n kilocode_change HEAD -- ...`
- Per-file `git diff`, `git show origin/main:<path>`, `git show 76c631d198:<path>`, and `git log -S...` comparisons for moved/deleted behavior.
- `bun run script/check-opencode-annotations.ts --base origin/main`
- `bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/session/prompt.ts --dry-run`
- `bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/config/config.ts --dry-run`
- `git diff --check origin/main...HEAD`

## Limitations

- The repository annotation checker exits successfully without checking files when it detects an upstream merge; its only output was `Skipping shared upstream annotation check — upstream merge detected.` Manual inventory and upstream comparisons were therefore required.
- The full-repository custom marker-balance scan exceeded the two-minute command limit. A changed-file scan completed and surfaced only delimiter irregularities already present on `origin/main`.
- No runtime or package test suite was run because this task was a marker-focused review and no production files were modified. Behavioral findings above are based on direct old/new/upstream code-path comparison.
- Pre-existing untracked `INFRASTRUCTURE_CHANGE.md` was not read or modified.
