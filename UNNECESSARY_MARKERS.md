# Unnecessary markers — PR #13513

**Verdict: safe to merge for this review lens.** No changed file is upstream-identical except for markers. There are low-priority stale annotations, including one import newly made redundant by upstream and an existing stale block expanded around new upstream code. Do not apply the bulk reset proposals blindly: two would remove intentional Kilo behavior.

## Scope and method

- Reviewer 4/7; sole output: `UNNECESSARY_MARKERS.md`.
- Checkout: `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports`. All commands ran there; the caller checkout was not modified.
- HEAD: `6a7d6bc002319ac2987bcde3d6c63efcafc07021`.
- PR base and verified merge base: `bf1cf502a3c511e9daf6a43244568ae4e83473a8` (`johnnyeric/kilo-opencode-v1.18.18`). Full PR scope: **59 files, 1,524 insertions, 647 deletions**, 95 reachable commits beyond base.
- Main control: `62998965e9fb0d9ed89011c62498b39801dbbb4f`.
- Authoritative upstream controls: v1.18.18 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`; v1.18.19 `2b72179c663cadcb54f54d9f19221b3fb3d11fb6`; v1.18.20 `7248bc1964b13fa67e601733f89ee9dc6dfa0563`.
- HEAD parents: Kilo `91ca95bad927436131ea4783a470885a381ce6ad`, transformed upstream `9563af96a012effc25df5a11eaa1f7633161a742`.
- `.opencode-version` contains `v1.18.20`; the local tag resolves to the authoritative SHA, which is an ancestor of HEAD. No fallback fetch was necessary. Authoritative remote fetching was performed by the parent reviewer; this lens independently checked local refs and ancestry.

Read root `AGENTS.md`, `REVIEW.md`, `script/upstream/README.md`, applicable package instructions, both required skills, and the reset scripts and helpers before executing them. `find-reset-candidates.ts:386` gates writes behind `!opts.dryRun`; `utils/reset.ts:43,55,67` returns before deletion or writes on dry runs. The diagnostic scripts are unchanged by this PR.

The bulk output was intersected with the **entire 59-file PR list**, not just files containing newly added markers. All 29 changed marker-bearing files were then compared in memory against both (a) the scripts' freshly translated pristine upstream and (b) the actual transformed merge parent. The scan examined **184 parsed marker blocks and 338 inline markers**, followed by inspection of 24 standalone marker comments and contextual verification of equality candidates. It used order-sensitive `difflib.SequenceMatcher(..., autojunk=False)`, not the bulk tool's line-multiset heuristic. No temporary source files were created.

## Findings

### P3 — Upstream adoption leaves misleading Kilo ownership annotations

**Locations:** `packages/opencode/test/tool/task.test.ts:6`; `packages/opencode/src/cli/cmd/run.ts:802-807`.

1. **Newly obsolete import marker.** The task test retains `// kilocode_change - Cause for resume-hint coverage` on `import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"`. Upstream v1.18.18 did not import `Cause`; v1.18.20 and transformed parent now have exactly this complete import. Base and main contain the Kilo marker, so its redundancy is caused by this upstream range, not a newly written comment. The tests still have genuine Kilo resume-hint assertions, but that no longer makes the shared import a fork difference.
2. **Existing stale block grows around new upstream code.** `run.ts:802` says “revert to upstream: consume native events without normalizing sync copies.” The enclosed loop header was already upstream-identical in base/main. The merge adds upstream's three-line `session.created` descendant-tracking branch inside that marker. The complete four-line body at HEAD lines 803–806 matches v1.18.20 and the transformed parent verbatim. Base/main contain only the old loop-header marker; their bodies lack the newly added descendant branch.

**Maintenance impact:** These annotations falsely identify upstream-owned imports and descendant tracking as Kilo behavior to preserve during subsequent merges. This creates avoidable conflict noise and makes a future upstream update look like a fork behavior change.

**Minimal direction:** Remove only the import suffix and the `run.ts` block's two marker comments. Preserve the import, loop, descendant tracking, and surrounding genuine Kilo auto-approval/suggestion logic. This is non-blocking maintenance, not a runtime regression.

### P3 — Additional pre-existing stale annotations remain in changed files

These are **pre-existing Kilo maintenance debt**, not regressions introduced by PR #13513. Base/main retain the same annotations, while the referenced code already exists in pristine v1.18.18 and remains in v1.18.20/transformed upstream:

- `packages/opencode/src/tool/task.ts:286-315`: the entire 28-line `TaskTool.injectBackgroundResult` body is upstream-identical. This is a redundant block even though the rest of the file retains substantial Kilo cost, sandbox, lifecycle, and resume-hint behavior.
- `packages/opencode/src/plugin/openai/codex.ts:413`: the `DISALLOWED_MODELS` rejection line is identical. The adjacent optional `model.options?.reasoningMode` guard is a real difference and should remain annotated.
- `packages/opencode/src/provider/provider.ts:1338,1342`: the `reasoningVariants` fallback and `mapValues` assignment are identical. The preceding `patchKiloModel` call is genuinely Kilo-specific and must remain.
- `packages/opencode/src/tool/registry.ts:281`: the conditional `execute: Tool.init(codeModeTool)` registration is identical. Kilo's instance-scoped initialization and added tool registrations elsewhere still differ.
- `packages/opencode/test/tool/task.test.ts:16`: the full `MessageID, PartID, SessionID` import already exists upstream; the “SessionID used by cost propagation tests” suffix is stale.
- `packages/opencode/test/session/compaction.test.ts:1337`: `{ timeout: 10_000 }` already matches upstream. Preserve the neighboring Kilo snapshot-isolation changes.
- `packages/opencode/test/session/processor-effect.test.ts:1207`: the trailing marker on `)` is redundant; as a stronger control than matching punctuation, the complete preceding provider-executed-error test at lines 1161–1206 matches pristine upstream and transformed upstream after marker removal.

**Evidence/control:** Exact cleaned block matching and contextual diffs against base, main, pristine v1.18.18/v1.18.20, and transformed parent. Both fully redundant blocks and all eight unchanged inline candidates were verified against the actual transformed parent; the previous finding accounts for one block and one inline candidate.

**Maintenance impact and direction:** Reduce false fork-ownership signals by deleting only these stale comments. Do not reset any of these whole files or remove the neighboring Kilo implementations. These inherited cleanups need not block this incremental merge.

## Unsafe reset proposals — not upstream-identical files

The bulk tool proposes five changed files, all in `small-diff`; **none is `markers-only` or `cosmetic-only`**. All five were verified with the required per-file dry run. Those commands only say “Would reset”; they do not prove safety. Comparing their proposed content against actual transformed upstream gives:

| Candidate | Bulk count | Verified difference and disposition |
|---|---|---|
| `packages/core/src/session/compaction.ts:229` | 1 | Reset deletes `include: selected.recent`, an intentional compatibility field in emitted compaction events. Preserve it and its marker. |
| `packages/opencode/test/plugin/openai-ws.test.ts:545,596` | 3 | Reset changes the first explicit `idleTimeout: 100` back to `20` and removes the second explicit `100`. These are real test timing controls, not whitespace/markers. Preserve pending an independent timing decision. |
| `packages/opencode/src/control-plane/workspace.ts:5` | 2 | Reset restores an unused `FetchHttpClient` import. This file has no Kilo markers and is not evidence of unnecessary annotations. |
| `packages/sdk/js/src/v2/gen/core/types.gen.ts:65` | 2 | Only generated comment punctuation differs: `e.g.` versus `e.g.,`. No markers. Follow the generator rather than manually resetting generated output. |
| `packages/sdk/js/src/v2/gen/core/utils.gen.ts:126` | 2 | Only generated comment punctuation differs: `i.e.` versus `i.e.,`. No markers. Same generator caveat. |

**Compatibility control:** Base contains `include` at compaction line 228 and main at line 222. `packages/schema/src/session-event.ts:429` explicitly preserves this optional field; `packages/core/test/kilocode/event-storage-compat.test.ts:88,105-107` covers persistence of the version-1 event's `include` field. Resetting the producer would remove a compatibility output, even though the bulk heuristic counts only one line. This lens did not execute a historical-client downgrade test and does not claim a newly reproduced data-loss scenario.

**Timing control:** Base/main both have the two explicit `idleTimeout: 100` settings at lines 520 and 571. The current PR adds unrelated residency/large-payload tests; it does not make the timing settings upstream-equivalent. No CI-flake reproduction was attempted, so the precise benefit of 100 ms is not independently quantified here.

**Provenance:** The reset heuristic and both intentional deltas predate this PR. The generator is upgraded from `@hey-api/openapi-ts` 0.90.10 to 0.97.3 in `packages/sdk/js/package.json:26`; the punctuation-only differences are part of that generated delta, not stale markers.

## Notable non-findings

- **Zero whole-file unnecessary-marker candidates in the PR.** The repository-wide bulk scan finds 40 `markers-only` files and two `cosmetic-only` files, but none of those 42 files is in this PR's 59-file delta.
- **Six apparent inline matches are translation artifacts, not redundant against the actual merge parent.** The referer headers at `packages/opencode/src/provider/provider.ts:491,502,512,523,638,908` become `https://kilo.ai/` when the per-file translator runs. The actual transformed parent still has `https://opencode.ai/` at those sites. They were therefore excluded from the stale-marker findings: removing them solely on the translator's result would hide a real diff against the merge input.
- **Genuine terminal-task adaptation remains.** The new task test block at `packages/opencode/test/tool/task.test.ts:398-487` intentionally asserts Kilo's resume-hint format rather than upstream's exact failure message. The corresponding runtime errors append `resumeHint`. These blocks are not wholly redundant despite containing substantial upstream test structure.
- The 24 standalone comments include annotations whose local next line happens to match upstream but whose control flow differs: for example `packages/tui/src/routes/session/index.tsx:441` follows removal of upstream's `plan_exit` auto-switch branch, and `packages/opencode/src/provider/provider.ts:1678` follows a loop extended with Kilo custom loaders. They are not treated as marker-only code from a one-line match.

## Commands and observed outputs

All commands below ran from the isolated report checkout. The SHA aliases used in prose above were not branch substitutions in the comparisons.

### Baselines and scope

```sh
git rev-parse HEAD
git diff --name-status bf1cf502a3c511e9daf6a43244568ae4e83473a8 6a7d6bc002319ac2987bcde3d6c63efcafc07021
git show HEAD:.opencode-version
git rev-parse 'v1.18.20^{commit}' refs/review/pr-13513/upstream-v1.18.18 refs/review/pr-13513/upstream-v1.18.19 refs/review/pr-13513/upstream-v1.18.20
git merge-base bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
git show -s --format='%H %P' HEAD
git merge-base --is-ancestor 7248bc1964b13fa67e601733f89ee9dc6dfa0563 HEAD
git diff --stat bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
git rev-list --count bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD
git diff --quiet bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD -- script/upstream
git diff --name-only -z bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD | xargs -0 git grep -n 'kilocode_change' HEAD --
```

Results: exact expected HEAD/base/parents, authoritative upstream SHAs, ancestry success, 59 changed paths, 95 commits, no PR change to the diagnostics. Marker search identified 29 changed marker-bearing files.

### Required bulk check

```sh
bun run script/upstream/find-reset-candidates.ts --dry-run
```

A complete successful invocation produced the following summary against **v1.18.20 / `7248bc19`**, scope **all shared paths**, default review limit **5**:

| Bucket | Repository count | Intersection with full PR delta |
|---|---|---|
| markers-only | 40 | 0 |
| cosmetic-only | 2 | 0 |
| small-diff | 221 | 5 |
| large-diff | 541 | 40 |
| identical | 167 | 4 |
| upstream-missing | 384 | 1 (`.opencode-version`) |
| local-missing | 2 | 0 |
| Total classified/pre-bucketed | 1,357 | 50 |
| Non-code assets skipped | 342 | 1 (`bun.lock`) |
| Config-protected skipped | 2,187 | 0 |

The remaining eight PR paths are seven raw-upstream-identical paths omitted by the bulk prefilter and one excluded Kilo-owned path. The completed report's entries were intersected using a content-search expression enumerating the full changed-path set: **50 matches**, including exactly the five reset proposals listed above. The independent classifier pass over all 29 marker-bearing files returned **27 large-diff, two small-diff, zero marker-only/cosmetic-only**.

The successful full output is retained in the local tool artifact `/Users/johnnyamancio/.local/share/kilo/tool-output/tool_043945176001J2waYZ7KDJ9ywl` (1,438 lines; summary at lines 37–59). This report records its complete bucket counts rather than embedding the repository-wide inventory.

**Execution limitation:** The first invocation timed out at 120 seconds. A retry with a 300-second allowance completed and produced the output above. A later captured-output rerun, and the final resume-time rerun, timed out at 300 seconds after logging `Classified 973/973`, without reaching the summary. That progress message is not proof that every concurrent worker completed. The completed invocation—not those timed-out runs—is the source of the counts. Dependencies resolved; no installation was attempted. The intermittent hang's cause was not diagnosed.

### Required per-candidate checks

```sh
bun run script/upstream/reset-to-upstream.ts packages/core/src/session/compaction.ts --dry-run
bun run script/upstream/reset-to-upstream.ts packages/opencode/src/control-plane/workspace.ts --dry-run
bun run script/upstream/reset-to-upstream.ts packages/opencode/test/plugin/openai-ws.test.ts --dry-run
bun run script/upstream/reset-to-upstream.ts packages/sdk/js/src/v2/gen/core/types.gen.ts --dry-run
bun run script/upstream/reset-to-upstream.ts packages/sdk/js/src/v2/gen/core/utils.gen.ts --dry-run
```

All five completed successfully, including a second execution after resume. Each resolved `v1.18.20 (7248bc19)` and printed `[DRY-RUN] Would reset <file> to transformed upstream v1.18.20`. **Five proposals, zero applied resets.** Their actual content comparisons—not the dry-run status line—support the dispositions above.

### Context/provenance controls

```sh
git diff -U2 9563af96a012effc25df5a11eaa1f7633161a742 HEAD -- packages/opencode/src/provider/provider.ts packages/opencode/src/tool/registry.ts packages/opencode/src/plugin/openai/codex.ts
git diff -U3 31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d 7248bc1964b13fa67e601733f89ee9dc6dfa0563 -- packages/opencode/test/tool/task.test.ts
git diff -U1 bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD -- packages/sdk/js/script/build.ts packages/sdk/js/package.json
git grep -n 'include: selected.recent\|idleTimeout: 100' bf1cf502a3c511e9daf6a43244568ae4e83473a8 62998965e9fb0d9ed89011c62498b39801dbbb4f -- packages/core/src/session/compaction.ts packages/opencode/test/plugin/openai-ws.test.ts
```

Additional read-only `bun -e` probes used the repository's `upstream`, `translate`, and `clean` helpers to pass JSON through Python's in-memory sequence matcher. The freshly translated baseline yielded **two unchanged blocks, 14 unchanged inline sites**. Repeating against the actual transformed parent yielded **two unchanged blocks, eight unchanged inline sites**; all six removed matches were the referer-header translation artifacts. Exact-body controls independently verified the complete task injection helper and provider-error test against base/main/upstream, avoiding punctuation-only conclusions.

## Limitations and integrity

- This is the unnecessary-marker lens only, not an overall functional, security, CI, or mergeability verdict. No GitHub state was queried or changed by this reviewer.
- The bulk classifier's “small” and “cosmetic” buckets are not semantic equivalence tests. Its multiset algorithm can hide reordering; no changed file landed in its cosmetic bucket in the completed run.
- Parsed marker counts exclude HTML comment markers inside the Codex callback HTML strings. Their enclosing callback replacement genuinely differs from upstream's shared-page implementation; they were not counted as fully redundant blocks.
- Equality scanning is diagnostic, not a proof that every partially broad marker is minimal. Whole-block/inline candidates were manually checked against context, with provenance separated from new merge debt.
- No runtime tests, lint, or typecheck were run for this report-only lens. No source code or generated files were changed, so no implementation-validation claim is made. A diagnostic probe initially misused `join(clean(...))`, failed, and was corrected to `join(clean(...).text)` before its results were used.
- No source resets, installs, commits, pushes, branch switches, Git configuration changes, or real user-state access. Other reviewers' report files were left untouched. At resume, tracked source was clean and HEAD still matched the immutable target; the six other reports were untracked. This reviewer writes only this report.
- Final verification: `bun run script/check-md-table-padding.ts UNNECESSARY_MARKERS.md` passed (`1 file(s) checked, no padded tables found`); `git diff --exit-code` passed with no tracked-source changes; `git rev-parse HEAD` remained `6a7d6bc002319ac2987bcde3d6c63efcafc07021`. The only new file authored by this reviewer is this report.
