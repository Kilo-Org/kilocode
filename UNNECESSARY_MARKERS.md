# Unnecessary `kilocode_change` Marker Review

## Scope and methodology

Reviewed PR [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) at snapshot `94fc42255c35827b197d97368d75d079242e9f4d`, relative to PR base snapshot `2f7f23deac683078a350014ec8a1a946aae46ce4`. The pristine upstream target reference was `/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/merge/.worktrees/opencode-merge/opencode`.

The review used the repository reset-candidate classifier in dry-run mode, then intersected its findings with files changed by the reviewed PR. The classifier compares local files against transformed upstream `v1.14.46` (`d802b0a2`), strips `kilocode_change` markers for the `markers-only` bucket, and performs no writes under `--dry-run`. The single in-scope candidate was then checked with the one-file reset helper in dry-run mode and spot-checked against the pristine upstream reference.

## Findings

### Unnecessary marker in a PR-changed file

- `packages/sdk/js/src/error-interceptor.ts`
  - The reset-candidate scan classifies this file as `markers-only`.
  - The one-file reset helper confirms that a dry-run reset would replace it with transformed upstream `v1.14.46`.
  - A direct comparison against the pristine upstream target shows the only local differences are the expected Kilo branding transform (`opencode server` to `kilo server`) and the adjacent `// kilocode_change` comment. Because branding transforms already produce the local `kilo server` text automatically, the marker itself is stale and can be removed by resetting the file to transformed upstream.

## Notable non-findings

- The full dry-run scan reported three `markers-only` files, but only `packages/sdk/js/src/error-interceptor.ts` changed in PR #10822. The other two candidates are outside this review's allowed conclusion scope:
  - `packages/opencode/src/cli/cmd/run/permission.shared.ts`
  - `packages/opencode/src/cli/cmd/tui/component/error-component.tsx`
- The reviewed PR changes 181 files. This report intentionally does not treat the scan's `small-diff`, `cosmetic-only`, `identical`, or skipped buckets as unnecessary-marker findings. The task was limited to marker-only drift with no actual difference to transformed upstream.
- No uncertain in-scope cases remain after the dry-run reset verification and pristine-upstream spot-check.

## Commands run and summarized outputs

```bash
git status --short && git rev-parse HEAD
```

- Confirmed the review checkout started clean and `HEAD` was exactly `94fc42255c35827b197d97368d75d079242e9f4d`.

```bash
git diff --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d
```

- Listed the files changed by the reviewed PR for scope restriction.

```bash
git diff --stat 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d && git diff --name-only 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d | wc -l
```

- Summarized the reviewed PR as 181 changed files, with 5,028 insertions and 2,498 deletions.

```bash
bun run script/upstream/find-reset-candidates.ts --dry-run
```

- Compared shared local files against transformed upstream `v1.14.46` (`d802b0a2`) without writing files.
- Reported 724 candidates after skipping 324 non-code assets and 1,524 config-protected files.
- Bucket summary: 3 `markers-only`, 1 `cosmetic-only`, 158 `small-diff`, 281 `large-diff`, 132 `identical`, 147 `upstream-missing`, and 2 `local-missing`.
- The three `markers-only` entries were `packages/opencode/src/cli/cmd/run/permission.shared.ts`, `packages/opencode/src/cli/cmd/tui/component/error-component.tsx`, and `packages/sdk/js/src/error-interceptor.ts`.

```bash
bun run script/upstream/reset-to-upstream.ts --help
```

- Confirmed the one-file helper usage and that `--dry-run` shows the reset action without writing the file.

```bash
bun run script/upstream/find-reset-candidates.ts packages/sdk/js/src/error-interceptor.ts --dry-run
```

- Re-ran the classifier scoped to the only PR-changed `markers-only` candidate.
- Reported one candidate in the `markers-only` bucket and no other buckets.

```bash
bun run script/upstream/reset-to-upstream.ts packages/sdk/js/src/error-interceptor.ts --dry-run
```

- Reported: `[DRY-RUN] Would reset packages/sdk/js/src/error-interceptor.ts to transformed upstream v1.14.46`.

```bash
git diff --unified=20 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d -- packages/sdk/js/src/error-interceptor.ts
```

- Confirmed the reviewed PR introduced `packages/sdk/js/src/error-interceptor.ts` locally, including the stale marker next to the branded server-error text.

```bash
git diff --no-index --unified=20 "/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/merge/.worktrees/opencode-merge/opencode/packages/sdk/js/src/error-interceptor.ts" "/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/review/packages/sdk/js/src/error-interceptor.ts"
```

- Spot-checked the local file against pristine upstream. The direct raw-upstream diff showed `opencode server` versus `kilo server` plus the adjacent marker. The classifier's transformed-upstream comparison correctly reduces this to marker-only drift.

```bash
git grep -l kilocode_change 94fc42255c35827b197d97368d75d079242e9f4d -- $(git diff --name-only --diff-filter=ACMR 2f7f23deac683078a350014ec8a1a946aae46ce4 94fc42255c35827b197d97368d75d079242e9f4d)
```

- Listed marker-bearing files changed in the reviewed PR as an additional scope check. The list includes intentional Kilo drift and Kilo-owned paths, so it was not used as a standalone finding source.

```bash
git status --short
```

- Confirmed the dry-run review commands left the checkout unchanged before this report was written.

## Limitations

- `find-reset-candidates.ts` intentionally skips non-code assets, config-protected files, oversized files, upstream-missing files, and local-missing files. Those skips are not evidence of unnecessary markers.
- The report restricts findings to files changed between the supplied PR base and reviewed snapshots, as requested. Marker-only drift elsewhere in the branch is noted only when the classifier surfaced it and is not attributed to PR #10822.
- Direct pristine-upstream comparison is raw upstream, while reset decisions use repository branding transforms. The one-file dry-run reset verification is the authoritative check for the flagged file.
