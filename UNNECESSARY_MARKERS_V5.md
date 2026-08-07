# Unnecessary `kilocode_change` Markers — Upstream Merge Review (Round 5)

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo, with round-4 review fixes applied
- **Round 1 reviewed HEAD**: `cce22e608f` (report: `UNNECESSARY_MARKERS.md`)
- **Round 2 reviewed HEAD**: `37a5cbf5db` (report: `UNNECESSARY_MARKERS_V2.md`)
- **Round 3 reviewed HEAD**: `b6505b164b` (report: `UNNECESSARY_MARKERS_V3.md`)
- **Round 4 reviewed HEAD**: `b793883de6` (report: `UNNECESSARY_MARKERS_V4.md`)
- **Round 5 reviewed HEAD**: `4bb1c2a45b` (= worktree `HEAD~4`; the top 4 commits `37bce69b34`, `0c56eb8220`, `79b02370fc`, `01fe00178c` add only the 28 round-1/2/3/4 report `.md` files at the repo root — `git diff 4bb1c2a45b..HEAD` = 28 files, all `.md`. All sweeps below target `4bb1c2a45b` explicitly; the full-repo scan ran at worktree HEAD `01fe00178c`, where the 28 report files land harmlessly in `upstream-missing` (verified — see Methodology), so code-file classifications are exactly the reviewed-head results.)
- **Delta since round 4**: single commit `4bb1c2a45b` "fix(core): address round 4 review findings for upstream merge" — 5 files: `packages/core/src/models-dev.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/opencode/script/kilocode/test-cli.ts`, `packages/opencode/src/config/config.ts`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` (`git diff b793883de6..4bb1c2a45b`)
- **PR base**: `4f59fcb666` (unchanged from round 4; full PR diff = `git diff 4f59fcb666...4bb1c2a45b` = 422 files, same count as round 4 — all 5 fix-commit files were already in the PR diff)
- **Upstream tag**: `v1.18.13` = `a105350812f05f914c768e468559dbd6bd508d8e` (resolved locally via `.opencode-version`; no network used)

## Headline answer

**The round-4 fix commit introduced 1 new unnecessary marker: `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` now wraps two upstream-verbatim assertions in a `kilocode_change start/end` block.** The file's *only* drift from upstream v1.18.13 is the two marker comment lines (`diff` of the two blobs: `111a112`, `113a115` — nothing else). The finder classifies it `markers-only` ("would reset"), and a reset keeps the assertions (they are upstream's own lines, `a105350812:112-113`) while dropping the markers. This is the fix commit over-correcting round-4's KILOCODE_CHANGE_MARKERS finding R3-F2: restoring the deleted assertions was right; marking upstream's own lines as a Kilo change was not. The finding is in the PR diff and is delta-introduced (0 markers at the round-4 head).

Everything else is unchanged: the 4 pre-existing stale-marker files remain the only other `markers-only` entries repo-wide, still untouched, still outside the PR diff.

- **New findings: 1** (delta-introduced, in the PR diff)
- **Pre-existing findings re-verified: 4 of 4 still present, still stale, still pre-existing**
- **Round-4 fix verification (8 locale files): still fixed** (0 markers, `identical` bucket)

## Methodology

### Tooling unchanged since round 4

`git diff --name-status b793883de6..4bb1c2a45b -- script/upstream/` is **empty** — the finder, resetter, classifier, marker cleaner, and all transforms are byte-identical to the round-4 head, so bucket semantics are directly comparable. Scripts were re-read this round regardless:

- `script/upstream/find-reset-candidates.ts [path] [--dry-run] [--review-limit n] [--concurrency n]` — pre-filters `git diff --name-only <last-merged-upstream>..HEAD` (excluding kilo-only paths `packages/kilo-*/**`, `**/kilocode/**`, `script/upstream`, non-code assets, and `keepOurs`/`skipFiles` policy files), then classifies each file against **transformed** upstream.
- `script/upstream/utils/reset.ts` `classifyDrift()` — `identical` if local == transformed upstream; else `clean()` both sides (strip standalone marker lines and inline marker suffixes; **content wrapped in `start/end` blocks is kept**) and compare: equal → `markers-only`; whitespace-only → `cosmetic-only`; ≤5 non-marker diff lines → `small-diff`; else `large-diff`.
- `script/upstream/reset-to-upstream.ts <file> --dry-run` — per-file verification; `[DRY-RUN] Would reset ...` when local differs from transformed upstream, `already matches` when identical.
- Upstream ref resolution: unchanged (`last()` reads `.opencode-version` = `v1.18.13`, resolves locally to `a105350812`).

### Invocations

```
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1   # full repo scan, report only (FINDER_EXIT=0)
bun run script/upstream/reset-to-upstream.ts <file> --dry-run                # all 5 markers-only files
git show --patch 4bb1c2a45b                                                  # fix-commit content
git diff a105350812..4bb1c2a45b -- <path>                                    # raw upstream diff per file
diff <(git show a105350812:<path>) <(git show 4bb1c2a45b:<path>)             # exact blob diff for the finding
git diff --name-only 4f59fcb666...4bb1c2a45b                                 # 422 PR files
git show <head>:<path> | grep -c kilocode_change                             # marker counts at both heads
bun <tmp>/v5-strip-check.ts                                                  # marker-strip replication over all 128 PR marker files via repo's own clean()/join()
```

`--concurrency 1` per rounds 1–4 (default concurrency reproducibly hung in this environment); the serial run completed with `FINDER_EXIT=0`. Default concurrency was not retried. The strip-check helper lived in the session temp dir, imported `clean`/`join` from the repo's `script/upstream/utils/markers.ts`, and performed no repo writes.

### Scan output (serial run at worktree HEAD `01fe00178c` = `4bb1c2a45b` + 28 report-only `.md` files, dry-run)

```
[OK] Last merged upstream: v1.18.13 (a1053508)
[INFO] Skipping 342 non-code asset(s)
[INFO] Skipping 2112 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1355            (round 4: 1348; +7 net new report files → comparable)
[INFO] Pre-bucketed 452 (missing or too-large)   (round 4: 445; +7 report files → comparable)
[INFO] Classifying 903 file(s)...  Classified 903/903   (round 4: 903)

| Bucket | Count | Action |
|---|---|---|
| markers-only | 5 | would reset |        (round 4: 4)
| cosmetic-only | 2 | would reset |        (round 4: 2, same files)
| small-diff | 205 | would reset |        (round 4: 206)
| large-diff | 502 | skipped |            (round 4: 502)
| identical | 177 | nothing to do |       (round 4: 177)
| upstream-missing | 452 | skipped |      (round 4: 445; +7 = the 7 new round-4 report files)
| local-missing | 12 | skipped |          (round 4: 12, same 12 files)
```

All 28 report `.md` files were verified to appear in the `upstream-missing` list (`comm -23 <report files> <bucket>` empty), so they inflate only that bucket and the candidate/pre-bucketed counts. The bucket churn is fully accounted for by one file move: `diff-viewer-file-tree.test.tsx` moved `small-diff` → `markers-only` (small-diff 206→205, markers-only 4→5). The `markers-only (5)` section:

```
## markers-only (5) — would reset
- `packages/core/test/session-prompt.test.ts`
- `packages/opencode/src/cli/cmd/run/demo.ts`
- `packages/opencode/src/cli/cmd/run/subagent-data.ts`
- `packages/sdk/js/src/error-interceptor.ts`
- `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`
```

## Prior-findings verification

### Pre-existing stale files (rounds 1–4) — 4 of 4 still present, still stale

| File | Touched by delta? | Markers at `4bb1c2a45b` | In PR diff? | Scan bucket | `reset-to-upstream --dry-run` |
|---|---|---|---|---|---|
| `packages/core/test/session-prompt.test.ts` | no | 1 | no | `markers-only` | `Would reset ... to transformed upstream v1.18.13` |
| `packages/opencode/src/cli/cmd/run/demo.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/opencode/src/cli/cmd/run/subagent-data.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/sdk/js/src/error-interceptor.ts` | no | 1 | no | `markers-only` | `Would reset ...` |

- Raw upstream diffs are byte-for-byte the rounds-1–4 evidence (verified again this round): a standalone marker comment line (`session-prompt.test.ts`), a rebranded `@opencode-ai/sdk/v2` → `@kilocode/sdk/v2` import with inline marker (`demo.ts`, `subagent-data.ts`), and the `kilo server` error string plus standalone marker (`error-interceptor.ts`).
- `git diff --name-only b793883de6..4bb1c2a45b -- <file>` and `git diff --name-only 4f59fcb666...4bb1c2a45b -- <file>` are both empty for all four — still pre-existing stale markers, untouched by the fix commit and outside the PR.
- Suggested actions unchanged (delete the marker comment, or `reset-to-upstream.ts` the file) — still best done in a separate hygiene commit, not this PR.

### Round-3/4 locale-file fixes — still fixed

All 8 `packages/ui/src/i18n/{az,fi,hi,id,pa,sv,ur,vi}.ts` files: **0 markers** at `4bb1c2a45b`, all listed in the `identical` bucket (and the `identical` bucket greps clean overall — see below). The fix commit did not touch them.

## New findings

### R5-F1: `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` — `kilocode_change start/end` block wrapping upstream-verbatim lines (delta-introduced, in PR diff)

**Evidence.**

Exact blob diff between upstream `a105350812` and reviewed head `4bb1c2a45b` (200 → 202 lines) — the *entire* drift is the two marker comment lines:

```
111a112
>     // kilocode_change start - restore upstream absence assertions
113a115
>     // kilocode_change end
```

The wrapped lines — `expect(focused.some((line) => line.includes("*"))).toBe(false)` and the `unfocused` twin — are upstream's own content, verbatim at `a105350812` lines 112–113 (and also present in PR base `4f59fcb666`). At the round-4 head `b793883de6` the file had **0 markers** and *lacked* the assertions (merge commit `cb44dd327c` had dropped them; flagged as KILOCODE_CHANGE_MARKERS R3-F2 / TESTS_V4 finding 3). Fix commit `4bb1c2a45b` restored the assertions — which alone would have made the file byte-identical to upstream — but additionally wrapped them in a marker block, reintroducing exactly 2 lines of drift.

- **Scan bucket**: `markers-only` (the bucket's definition: after `clean()` strips marker lines from both sides, local == transformed upstream). Verified directly: `clean()`-stripped local === stripped raw upstream in the strip-check replication (the only such file among all 128 PR marker files; round 4 had 0).
- **`reset-to-upstream.ts --dry-run`**: `[DRY-RUN] Would reset packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx to transformed upstream v1.18.13`. A reset writes transformed upstream, which **keeps both assertions** (they are upstream content) and drops only the 2 marker lines — so the reset is safe and is exactly the right end state.
- **In the PR diff**: yes (`git diff --name-only 4f59fcb666...4bb1c2a45b` includes it).
- **Why the marker is unnecessary**: the marker's purpose is to flag Kilo-only divergence. These two lines diverge from nothing — they are upstream's own assertions. Marking them (a) mislabels upstream content as a Kilo change, (b) makes the file the PR's only `markers-only` entry, and (c) adds merge surface: future upstream edits to these lines will conflict against the marker block for no benefit. If the intent was to answer R3-F2 ("the weakening is undocumented, unmarked"), restoring the lines already resolves it — the documentation value lives in the fix commit message.
- **Suggested action**: delete the 2 marker comment lines (`// kilocode_change start ...` / `// kilocode_change end`), keeping the assertions — or run `bun run script/upstream/reset-to-upstream.ts packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, which produces the same result. Small enough to fold into this PR.
- **Human-verification note**: if the team deliberately wants the marker block as in-source documentation (e.g. to warn that the assertions were once flaky — see TESTS_V4 finding 3), be aware the file then sits in the auto-reset bucket: any future non-dry-run `find-reset-candidates` pass will silently strip the markers. A plain non-marker comment would document without creating marker drift.

## Notable non-findings

### Fix-commit shared files — the other two carry real drift, markers justified

- **`packages/core/src/models-dev.ts`** (markers 7→9, large-diff 30 lines): the fix changed the default models URL `https://models.opencode.ai` → `https://models.dev` on two lines and added an inline `// kilocode_change` to each. Verified no transform covers this URL (`grep -r "models\.(dev|opencode\.ai)" script/upstream/` → no matches), so both lines are genuine drift from raw *and* transformed upstream — markers justified. File is nowhere near byte-identical (135-line raw diff: `KILO_*` flag renames, Kilo catalog schema fields, lock re-read block, `ModelsRefresh.notify()`, etc.).
- **`packages/opencode/src/config/config.ts`** (markers 115→115, large-diff 509 lines): the fix edited code *inside* two existing marker blocks (broadened `catchReason` pairs → `catchTag("PlatformError", ...)`, rewrote the block comment texts). Marker count unchanged; the marked regions remain real Kilo drift (confinement-tolerant config setup). Nothing became upstream-identical.
- **Byte-identical check**: none of the 5 fix-commit files is byte-identical to raw upstream at `4bb1c2a45b` (`git diff --quiet a105350812..4bb1c2a45b -- <f>` fails for all five; GitOps.ts and test-cli.ts don't exist upstream). So the strict "raw-identical + markers remain" pattern is absent; R5-F1 above is the stripped-basis equivalent for diff-viewer.
- **No markers added to anything upstream-identical**: the delta added markers to exactly 2 files (models-dev.ts +2 inline, diff-viewer +start/end). models-dev.ts has 135 lines of raw drift; diff-viewer is R5-F1.
- **`packages/kilo-vscode/src/agent-manager/GitOps.ts`** (kilo-only path, excluded from scan): 0 markers before and after; upstream-missing; the 12 added `delete env.*` lines need no markers (kilo-owned tree).
- **`packages/opencode/script/kilocode/test-cli.ts`** (kilocode path, excluded from scan): 1 marker (the conventional `new file` header) before and after; the catch-block fix added a `console.warn` with no marker change — correct for a kilo-only file.

### Fresh full-PR sweep (422 files, `4f59fcb666...4bb1c2a45b`)

- **128 PR files contain markers** (round 4: 127). Churn fully accounted: **+1** = `diff-viewer-file-tree.test.tsx` (R5-F1). Verified by recomputing the round-4 set at `b793883de6` and diffing the lists — the only addition.
- Bucket breakdown of the 128: **96 `large-diff`, 17 `small-diff`, 1 `markers-only`** (R5-F1), 5 `upstream-missing` kilo-only (`packages/opencode/src/provider/models.ts`, `packages/ui/src/context/marked-code-span.{ts,test.ts}`, `script/check-model-tool-network.ts`, `script/check-test-ci.ts`), 9 unscanned kilo-only paths (`packages/opencode/script/kilocode/test-cli.ts`, `packages/opencode/src/kilocode/tool/task.ts`, `script/upstream/{README.md,merge.ts,transforms/remove-kilo-web{,.test}.ts,transforms/transform-i18n{,.test}.ts,transforms/transform-package-json.ts}`).
- **200 PR files are byte-identical to raw upstream; 0 contain markers** (all 200 grepped via set intersection with the marker-file list, not sampled).
- **Marker-strip replication over all 128 PR marker files** (repo's own `clean()` + `join()` vs raw upstream blobs): **1 becomes byte-identical to raw upstream after stripping — R5-F1** (round 4: 0); 113 retain real diffs; 14 are kilo-only (absent upstream — the 5 bucketed plus the 9 unscanned).
- **The 17 `small-diff` PR marker files are exactly round 4's 17** (`codemode/tsconfig.json`, `core/src/repository-cache.ts`, `core/src/session/compaction.ts`, `core/src/session/runner/llm.ts`, `llm/test/provider-error.test.ts`, `opencode/src/effect/runtime-flags.ts`, `opencode/test/provider/header-timeout.test.ts`, `session-ui/.../prompt-input/{interaction,types}.ts`, `tui/src/ui/{dialog.tsx,spinner.ts}`, `ui/src/components/{resize-handle.tsx,scroll-view.tsx,select.css}`, `ui/src/styles/theme.css`, `ui/src/v2/components/toast-v2.tsx`, `ui/vite.config.ts`) — all carry their prior "markers on real drift" eyeball verdicts; diff-viewer *left* this bucket (for `markers-only`) rather than a new file entering it.
- **`identical` bucket (177 files) grepped: 0 markers** — the 8 fixed locale files sit here marker-free, and no file matches transformed upstream while still carrying markers.
- **`markers-only` ∩ PR diff = exactly 1 file** (R5-F1); the other 4 `markers-only` files are all outside the PR diff (set intersection verified).

### Unchanged populations

- **The round-1/2/3 trio**: `packages/opencode/test/account/service.test.ts`, `packages/opencode/test/mcp/oauth-browser.test.ts`, `packages/session-ui/src/components/markdown-worker.ts` — 0 markers, byte-identical to raw upstream, untouched by the delta (re-verified).
- **`local-missing` 12 = same 12 as rounds 3–4**: 8 upstream workflows (`.github/workflows/{duplicate-issues,notify-discord,pr-management,publish-github-action,release-github-action,review,stats,triage}.yml`) and 4 stale/old-version patches (`@dnd-kit%2Fdom@0.5.0`, `@ff-labs%2Ffff-bun@0.9.3`, `pacote@21.5.0`, `solid-js@1.9.10`). Prior-round verification stands (workflow deletions guarded by `check-workflows.ts`; patch orphans unreferenced by current `patchedDependencies`/`bun.lock`). Not marker-related.
- **`cosmetic-only` unchanged**: `packages/opencode/src/session/prompt/anthropic.txt`, `patches/effect@4.0.0-beta.83.patch` — neither in the PR, neither marker-related.
- **No dropped-marker cases**: the delta touched 5 files; none that had markers at the round-4 head is now byte-identical to raw upstream, and no marker count decreased.

## Limitations

- **Transformed vs raw comparison**: the scripts compare against upstream *after* Kilo branding/package-name/i18n transforms (plus `removeKiloWeb` for `index.ts` and the `opentui-spinner` package.json deletion, all unchanged since round 3). Bucket claims are on the transformed basis; raw-diff claims are labeled as such. For R5-F1 the two bases coincide: no transform fires on this file, so transformed upstream == raw upstream and the finding holds on both.
- **Scan head vs reviewed head**: the finder ran at worktree HEAD `01fe00178c`, which adds 28 report `.md` files on top of the reviewed head `4bb1c2a45b`. All 28 were verified to land in `upstream-missing`; every code-file classification is therefore exactly the reviewed-head result. All per-file git checks targeted `4bb1c2a45b` explicitly.
- **File granularity**: buckets classify whole files. An individually-stale marker inside a file that also has real diffs is not detectable at this granularity; per-marker rebuilds (`fix-kilocode-markers.ts <file> --dry-run`) across the 113 real-diff PR marker files were not performed in this pass (unchanged from rounds 1–4). Flagged for human discretion.
- **Skipped populations**: 452 pre-bucketed (`upstream-missing`/`too-large`, incl. the 28 report files) and 2112 config-protected files were not content-classified. No PR marker file is `too-large`.
- **Marker-unsupported extensions**: `.json` markers are counted as ordinary drift (`packages/codemode/tsconfig.json`, small-diff, real config changes — unchanged).
- **Environment**: serial dry-run used throughout (`--concurrency 1`, `FINDER_EXIT=0`); the default-concurrency hang from rounds 1–4 was not retested. No writes performed at any point — both scripts ran with `--dry-run`, the helper script only read, and the worktree remained clean of modifications (three untracked `*_V5.md` reports from parallel review tracks appeared; no repo files were changed by this round).
