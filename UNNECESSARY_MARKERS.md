# Review: Stale `kilocode_change` markers after PR #9978

> NOTE: this report was reconstructed from the review subagent's final summary because an earlier scratch write of the markdown was lost when the working tree was reset. The findings below match what the agent reported. A human should re-run `bun run script/upstream/find-reset-candidates.ts --dry-run packages/opencode` themselves to reproduce.

## Methodology

1. Ran the canonical tool, scoped to `packages/opencode`, against the PR branch:
   ```
   bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 16 packages/opencode
   ```
   (Compared to last merged upstream snapshot `006a05abe` / v1.14.33.)
2. Intersected each bucket with the 254 files changed by PR #9978.
3. For each `markers-only` / `identical` candidate inside the PR diff, verified by spot-checking with:
   ```
   bun run script/upstream/reset-to-upstream.ts --dry-run <file>
   ```
4. Manually confirmed the merge-resolution flashpoints called out in the PR description (`src/server/proxy.ts`, `src/server/routes/global.ts`) by comparing against transformed upstream.

## Bucket summary (PR-touched ∩ candidates)

| Bucket | Count | PR-touched? | Notes |
|---|---|---|---|
| `markers-only` | 0 | n/a | **Empty** — no stale-markers files to reset. |
| `identical` | 32 | yes | Spot-checked sample contains zero markers; differs from raw upstream only via `translate()` branding/package-name transforms. |
| `whitespace-only` | 0 | n/a | None. |
| `small-diff` | 23 | yes | Each carries markers around real Kilo additive code (e.g. `src/server/cors.ts`, `src/server/server.ts`, `src/storage/db.ts`); confirmed via `git diff 006a05abe..pr-9978 -- <file>`. |
| `large-diff` | 72 | yes | Substantive Kilo-specific changes including `src/server/proxy.ts` and `src/server/routes/global.ts`; markers guard real logic. |
| `cosmetic-only` | 1 | **no** | `packages/opencode/src/session/prompt/anthropic.txt` — single trailing-space drift, not touched by this PR; pre-existing finding. |

## Findings

None. No `markers-only` candidates were detected in the PR-touched file set; no resets are recommended for this PR.

## Conclusion

PR #9978 does not introduce any newly-stale `kilocode_change` markers. All markers in PR-touched files still guard real Kilo behavior. The cosmetic-only `anthropic.txt` finding is independent of this PR.
