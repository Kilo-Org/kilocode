# `kilocode_change` Marker Audit

## Scope and methodology

- Reviewed exact head `054ee594915b93546d0613a45e0671edd43905ee` against base and merge base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8` for PR #12695 (`johnnyeric/kilo-opencode-v1.17.13`). Verified recorded upstream merge `db1eae3583535d9b7a61ec8af9702e1580471056` has upstream parent `10c894bdeef3618f5666fb506ef7f9491bb964d8`, and conflict-resolution merge `518501a994bcd660e8c6d061b450c32412104004` has second parent `898f0dc40b4549bb4160ed3cb53d19a6a39243dc`.
- Checked all **1,237 changed files** from `git diff --name-only <base> <head>`. The inventory was traversed file by file to compare marker counts and marker-bearing lines at base/head; shared source candidates were also compared with pristine upstream v1.17.13 after the repository's branding/package transforms. Deleted and renamed paths were separately inventoried, and surviving base-marked code was searched by normalized content when line positions moved.
- Focused semantic review covered all 175 files whose marker lines changed, all 265 changed files that contained a marker at base, every file with a removed marker line, all 48 files with a net marker-count decrease, and concept/symbol moves implicated by those removals. A removal was accepted only when the final file matched upstream, the marked construct disappeared with an upstream deletion/refactor, or equivalent Kilo behavior remained marked at its new location.
- The audit concerns accidental marker loss. It does not claim that every pre-existing marker is ideally narrow or that every unrelated Kilo divergence introduced by concurrent `main` merges is annotated.

## Findings

### P3: Kilo credential compatibility dependencies lost their block marker

- **Path/symbol:** `packages/core/src/credential.ts:206-207`, optional `FSUtil.Service` and `Global.Service` acquisition inside `Credential.layer`.
- **Evidence:** Base lines 218-221 wrapped these two acquisitions in `// kilocode_change start` / `end`. Reviewed head retains the same Kilo-only acquisitions at lines 206-207 but removes both boundaries. Pristine upstream `10c894b...` has neither acquisition and its credential layer depends only on the database. Head still needs these services for Kilo's isolated `KILO_AUTH_CONTENT` handling and legacy `auth.json` synchronization; the new node wiring at lines 423-424 is marked, but it does not annotate the separate service acquisitions. The marker fixer reports `[DRY-RUN] Would update packages/core/src/credential.ts`. `git blame` attributes removal of the boundaries to conflict resolution `518501a994`.
- **Risk:** No runtime behavior is lost, but future upstream comparisons and conflict resolution can misclassify these optional Kilo dependencies as upstream code and drop or incorrectly simplify them. The inline marker on `export const layer` at line 201 covers only that declaration under the repository checker semantics, not lines 206-207.
- **Verification/fix direction:** Restore a narrow start/end block around lines 206-207, then dry-run `script/upstream/fix-kilocode-markers.ts` and confirm those lines are covered against transformed v1.17.13.

### P3: The Kilo model-footer sort marker moved onto the upstream release-date sort

- **Path/symbol:** `packages/tui/src/component/dialog-model.tsx:297-298`, non-`newestFirst` branch of `sortModelOptions`.
- **Evidence:** Base line 297 was `(option) => option.footer === undefined, // kilocode_change - free model footers include Kilo disclosure labels`. Reviewed head leaves that Kilo-specific predicate unmarked at line 297 and puts the same explanatory marker on `[(option) => option.releaseDate, "desc"]` at line 298. Pristine upstream `10c894b...` already contains release-date descending sort there, while its footer predicate is `(option) => option.footer !== "Free"`. Thus the marker now marks upstream behavior and no longer marks the actual Kilo divergence. The repository marker fixer reports that it would update the file, but direct line/symbol comparison is required to identify the ownership error. `git blame` attributes the misplaced marker to `518501a994`.
- **Risk:** No current sorting behavior is lost, but the marker gives the next merge the opposite guidance: it encourages retaining a stale marker on upstream code while leaving the Kilo disclosure-label ordering vulnerable to reset.
- **Verification/fix direction:** Move the existing inline marker/comment from line 298 back to the footer predicate at line 297; leave the upstream release-date line unmarked.

## Notable non-findings

- No removed marker corresponded to a confirmed loss of Kilo runtime behavior. Concept searches found the reviewed branch's explicit restoration commit `a606a91e69` retained the previously dropped processor tool settlement, compaction overflow accounting/system instructions, snapshot ignore cleanup, shell metadata/output draining, Snowflake OAuth branding, worker logging, and TUI rendering deltas with markers at their final locations.
- Fourteen net-loss files were justified exact upstream reverts: ten final blobs exactly match pristine upstream (`packages/core/src/command.ts`, `packages/core/src/session/event.ts`, `packages/core/src/v1/permission.ts`, `packages/core/src/v1/session.ts`, three Core provider tests, `packages/opencode/src/server/event.ts`, `packages/server/src/api.ts`, and `packages/server/src/handlers/event.ts`), while four marked files were deleted along with their upstream counterparts (`packages/core/src/plugin/boot.ts`, `packages/core/src/plugin/provider/openai-auth.ts`, `packages/server/src/groups/location.ts`, and `packages/server/src/groups/session.ts`). The latter functionality was moved into upstream's new plugin/protocol/location structure rather than silently discarded.
- Marker-count decreases caused by the Layer-to-`LayerNode` refactor were generally justified. Broad marked `defaultLayer`/dependency blocks disappeared, while surviving Kilo dependencies were represented by narrow markers on node dependencies or Kilo-owned nodes. Examples checked include `packages/opencode/src/effect/app-runtime.ts`, `agent/agent.ts`, `config/config.ts`, `provider/auth.ts`, `session/revert.ts`, `session/summary.ts`, `skill/index.ts`, and `tool/registry.ts`.
- `packages/core/src/tool/read-filesystem.ts` retained the filesystem-identity invariant: `Target`, `inspect`, `verify`, descriptor verification in `read`, and directory verification in `list` remain marked. Removed markers around pagination code accompanied an upstream rewrite to typed errors/chunk handling rather than a loss of the Kilo permission-to-use race protection.
- `packages/opencode/src/session/compaction.ts` retained Kilo compaction queue/recovery/chunk/export logic and marked Kilo dependencies. The unmarked `SessionEvent.Compaction.Started` publication is unchanged upstream behavior; the old marker was associated with the earlier event bridge shape, not a surviving Kilo-only line.
- `packages/opencode/src/cli/cmd/tui.ts` retained marked Kilo cloud-fork ordering, internal authenticated transport, worker lifecycle, and graceful shutdown behavior. Removed inline markers were either absorbed by surrounding Kilo blocks or matched upstream transport/validation behavior. `packages/opencode/src/tool/shell.ts` moved the output-reader marker from the call line to the immediately adjacent explanatory line; coverage remains clear.
- All 12 detected renames were upstream server-group moves into `packages/protocol/src/groups/*`; the renamed `fs` path retained its marker, and no other renamed source had a base marker to lose.

## Exact command outputs and results

```text
$ git rev-parse HEAD
054ee594915b93546d0613a45e0671edd43905ee

$ git merge-base 0b8f749ae13388cf7a38ea7fb9183acaac99eef8 054ee594915b93546d0613a45e0671edd43905ee
0b8f749ae13388cf7a38ea7fb9183acaac99eef8

$ git rev-list --parents -n 1 db1eae3583
db1eae3583535d9b7a61ec8af9702e1580471056 f844790ed7e0220146d0b5d650a57fce6ecc79d5 10c894bdeef3618f5666fb506ef7f9491bb964d8

$ git rev-list --parents -n 1 518501a994
518501a994bcd660e8c6d061b450c32412104004 db1eae3583535d9b7a61ec8af9702e1580471056 898f0dc40b4549bb4160ed3cb53d19a6a39243dc

$ git diff --name-only <base> <head> | wc -l
1237

$ git diff --shortstat <base> <head>
1237 files changed, 101898 insertions(+), 41085 deletions(-)

$ git diff --name-status <base> <head> | status-count
A 334
D 31
M 860
R 12

$ git diff --name-only <base> <head> | shasum -a 256
8b58590320954afdc63188e6bb204c79411f79ea375442c75a2c2e224ded7ceb  -

$ git grep -I -n -e kilocode_change <base> -- | wc -l
5817
$ git grep -I -n -e kilocode_change <head> -- | wc -l
5920

$ git diff --name-only -Gkilocode_change <base> <head> | wc -l
175

base_marked_changed_files=265 head_marked_changed_files=301

$ bun run script/check-opencode-annotations.ts --base <base>
Skipping shared upstream annotation check — upstream merge detected.

$ bun run script/upstream/fix-kilocode-markers.ts packages/core/src/credential.ts --dry-run
[OK] Last merged upstream: v1.17.13 (10c894bd)
[INFO] [DRY-RUN] Would update packages/core/src/credential.ts

$ bun run script/upstream/fix-kilocode-markers.ts packages/tui/src/component/dialog-model.tsx --dry-run
[OK] Last merged upstream: v1.17.13 (10c894bd)
[WARN] 1 upstream-only deleted line(s) cannot be annotated in the current file
[INFO] [DRY-RUN] Would update packages/tui/src/component/dialog-model.tsx
```

## Limitations

- The normal annotation guard deliberately skips upstream-merge ranges, so it cannot validate this PR; the audit used direct base/head/upstream comparisons and the repository marker utilities instead.
- The marker fixer identifies changed ranges, not semantic ownership within a multi-line range. That is why it misses the misplaced `dialog-model.tsx` inline marker and why every candidate required direct evidence rather than treating dry-run output as a finding.
- Transformed-upstream comparison over-reports files changed by later `main` merges and Kilo adaptations. Findings were retained only where a marker-covered base construct demonstrably survives as unmarked Kilo-only code at reviewed head.
- One generated file was present in the 1,237-file inventory; generated and binary files were included in path/status/count checks, but marker semantics apply only to comment-capable source files.
- Other reviewers had untracked report/config files in the shared worktree during this audit. They were not part of the pinned Git comparisons and were not modified. No GitHub state was read or mutated, and no commit or push was performed.
