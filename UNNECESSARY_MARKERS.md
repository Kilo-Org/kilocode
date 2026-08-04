# Unnecessary `kilocode_change` Markers

## Scope And Methodology

- Reviewed PR #12695 at exact head `054ee594915b93546d0613a45e0671edd43905ee` against requested base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`; `git merge-base` returned the same base. The PR range contains 525 commits and 1,237 changed files (334 added, 860 modified, 31 deleted, 12 renamed).
- Verified the recorded and resolved upstream version is `v1.17.13` at `10c894bdeef3618f5666fb506ef7f9491bb964d8`, that this commit is an ancestor of the reviewed head, and that `.opencode-version` at the head contains `v1.17.13`.
- Read the required root/package review instructions and marker-minimization guidance. Limited findings to files changed in `0b8f749a..054ee594`; repository-wide candidates outside that range were treated only as non-findings.
- Ran the required bulk candidate command, then successful narrower dry runs over the shared packages containing the PR-relevant marker-only files. Independently scanned all 1,237 PR-touched files using the repository's own `translate()`, `clean()`, and `join()` functions. Of 301 PR-touched files containing `kilocode_change`, only the two findings below were marker-only relative to transformed upstream.
- For each relevant candidate, ran the single-file reset script with its supported invocation, `bun run script/upstream/reset-to-upstream.ts <repo-relative-file> --dry-run`. No reset was applied.

## Findings

### P3: stale marker in the merged core prompt test

- **Path / marker:** `packages/core/test/session-prompt.test.ts:101`, standalone comment `// kilocode_change - no durable interrupt lookup: released database readers cannot decode that event type.` immediately before `describe("SessionV2.prompt", ...)`.
- **Evidence:** `find-reset-candidates.ts packages/core --dry-run --concurrency 1` classified this file as `markers-only`. Compared with pristine upstream merge parent `10c894bd`, the sole final-head difference is that comment. Upstream blob hash is `c6bc9430b3ac0467db3e00d437d2b321ad963e47`; head blob hash is `4389eaf90e68dbc5636b16b700dd579efdc3f3fd`. Transform-aware verification returned `rawEqual=false`, `transformedEqual=false`, `markerCleanedEqual=true`; upstream/transformed/cleaned size is 19,669 bytes while head is 19,776 bytes.
- **Reset verification:** `[OK] Last merged upstream: v1.17.13 (10c894bd)` followed by `[INFO] [DRY-RUN] Would reset packages/core/test/session-prompt.test.ts to transformed upstream v1.17.13`.
- **Cleanup:** reset this file to transformed upstream or remove the standalone marker comment. There is no Kilo code attached to preserve.

### P3: stale inline marker in the merged account service test

- **Path / marker:** `packages/opencode/test/account/service.test.ts:39`, trailing `// kilocode_change` on the `LayerNode.compile(Account.node, ...)` line.
- **Evidence:** `find-reset-candidates.ts packages/opencode/test --dry-run --concurrency 1` classified this file as `markers-only`. Compared with pristine upstream merge parent `10c894bd`, the sole final-head difference is the trailing marker. Upstream blob hash is `0ebe69c2394b6b5028acd45e32132d5df41251ea`; head blob hash is `eb246cfe824158108a114af2b6e97135719a4367`. Transform-aware verification returned `rawEqual=false`, `transformedEqual=false`, `markerCleanedEqual=true`; upstream/transformed/cleaned size is 14,032 bytes while head is 14,051 bytes.
- **Reset verification:** `[OK] Last merged upstream: v1.17.13 (10c894bd)` followed by `[INFO] [DRY-RUN] Would reset packages/opencode/test/account/service.test.ts to transformed upstream v1.17.13`.
- **Cleanup:** reset this file to transformed upstream or remove the trailing marker. The `LayerNode.compile(...)` implementation itself is pristine upstream code.

## Notable Non-Findings

- The source-scope run also classified `packages/opencode/src/cli/cmd/run/demo.ts` and `packages/opencode/src/cli/cmd/run/subagent-data.ts` as marker-only, but neither file changed in the reviewed PR range; they are excluded from findings.
- No other PR-touched marker file became identical to transformed `v1.17.13` after marker removal. This statement is limited to marker-only identity, not whether other small Kilo diffs remain desirable.
- Branding/package transforms did not affect either finding: for both candidates the transformed upstream byte count equals the raw upstream byte count.

## Command Results

`bun run script/upstream/find-reset-candidates.ts --dry-run`:

```text
[OK] Last merged upstream: v1.17.13 (10c894bd)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 332 non-code asset(s)
[INFO] Skipping 1879 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1198
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 359 (missing or too-large)
[INFO] Classifying 839 file(s)...
[INFO] Classified 839/839
shell tool terminated command after exceeding timeout 600000 ms
```

The same exact command first timed out after 120,000 ms at the same point. It made no writes because `--dry-run` was set.

Successful scoped candidate results relevant to this report:

```text
packages/core: 135 candidates; markers-only 1
  packages/core/test/session-prompt.test.ts

packages/opencode/test: 175 candidates; markers-only 1
  packages/opencode/test/account/service.test.ts

packages/opencode/src: 255 candidates; markers-only 2
  packages/opencode/src/cli/cmd/run/demo.ts
  packages/opencode/src/cli/cmd/run/subagent-data.ts
```

The two `packages/opencode/src` candidates are outside the PR range. Both PR-relevant single-file reset dry runs exited successfully and reported that they would reset to transformed upstream `v1.17.13`; neither wrote a file.

## Limitations

- The required all-shared-path bulk command reproducibly hung after printing `Classified 839/839` and never emitted its markdown summary, even with a 600-second timeout. Static inspection shows report generation should follow classification directly, but the exact post-classification blocking cause was not established. Successful package-scoped executions plus the independent transform-aware scan supplied the missing PR-scoped classification.
- The bulk finder intentionally excludes 332 non-code assets and 1,879 config-protected files and pre-buckets missing/oversized files. The independent scan considered PR-touched text blobs that contain marker text and exist at both upstream and head, so this report does not claim marker-only verification for binary, deleted, upstream-missing, or marker-free files.
- Existing untracked reviewer artifacts were present and were not read, edited, deleted, or included in this report. No GitHub state was queried or mutated, and no commit, push, reset, or source edit was performed.
