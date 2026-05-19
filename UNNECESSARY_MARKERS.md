# Unnecessary Markers Review

## Scope
- PR: https://github.com/Kilo-Org/kilocode/pull/10387
- Base compared: main

## Commands Run
- `git status --short --branch`
  Outcome: current branch is `mark/review-pr-10387-reports`; no working-tree changes were reported at command time.
- `git diff --name-only main...HEAD`
  Outcome: listed 396 files changed in PR 10387 versus `main`.
- `bun run script/upstream/find-reset-candidates.ts --dry-run`
  Outcome: completed successfully against all shared paths. Last merged upstream was `v1.14.34` (`b5f433b4`). Summary included `markers-only: 0`, `cosmetic-only: 1`, `small-diff: 137`, `large-diff: 266`, `identical: 121`, `upstream-missing: 173`, and `local-missing: 2`.
- `git grep -l kilocode_change -- $(git diff --name-only main...HEAD)`
  Outcome: listed 146 PR-changed files containing `kilocode_change` markers.
- `bun run script/upstream/reset-to-upstream.ts <file> --dry-run`
  Outcome: run for each finding below; every command completed successfully and reported `[DRY-RUN] Would reset <file> to transformed upstream v1.14.34`.
- `git status --short`
  Outcome: after writing this report, showed untracked `UNNECESSARY_MARKERS.md` plus pre-existing untracked `INFRASTRUCTURE_CHANGE.md`, `OPENCODE_MENTIONS.md`, and `TESTS.md`.

## Findings
- `packages/opencode/src/bus/global.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 1 non-marker diff line, so the markers may now be unnecessary or the file may be resettable.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/bus/global.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/cli/cmd/agent.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 5 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/cli/cmd/agent.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/cli/cmd/tui/worker.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 3 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/cli/cmd/tui/worker.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/config/paths.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/config/paths.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/git/index.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/git/index.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/project/vcs.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 5 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/project/vcs.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/server/auth.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/server/auth.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/server/cors.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/server/cors.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/server/middleware.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 5 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/server/middleware.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/server/routes/instance/httpapi/server.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/server/server.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 5 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/server/server.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/session/session.sql.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/session/session.sql.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/src/storage/db.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 3 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/src/storage/db.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/acp/event-subscription.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/acp/event-subscription.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/file/index.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/file/index.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/server/httpapi-config.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/server/httpapi-config.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/server/httpapi-experimental.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/server/httpapi-experimental.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/server/httpapi-instance.legacy.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/server/httpapi-instance.legacy.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/apply_patch.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/apply_patch.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/external-directory.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/external-directory.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/grep.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 2 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/grep.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/parameters.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/parameters.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/read.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 4 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/read.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.
- `packages/opencode/test/tool/shell.test.ts`
  Why: PR-changed shared file contains `kilocode_change` markers and `find-reset-candidates.ts --dry-run` classified it as `small-diff` with 5 non-marker diff lines.
  Verification: `bun run script/upstream/reset-to-upstream.ts packages/opencode/test/tool/shell.test.ts --dry-run` reported it would reset to transformed upstream `v1.14.34`.

## Notes
- `find-reset-candidates.ts --dry-run` does not accept an arbitrary file list, so it was run across shared paths and then filtered to files changed by `git diff --name-only main...HEAD` and files containing `kilocode_change` markers.
- The dry-run found no `markers-only` bucket overall. The findings above are `small-diff` files, not pure `markers-only` files, but each is PR-touched, marker-containing, and dry-run resettable to transformed upstream.
- Existing untracked files other than `UNNECESSARY_MARKERS.md` were observed but not read or modified.
- No command failures occurred.
