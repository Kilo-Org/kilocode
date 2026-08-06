# Unnecessary `kilocode_change` Markers — Upstream Merge Review (Round 2)

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo, plus 4 post-review fix commits
- **Round 1 reviewed HEAD**: `cce22e608f` (report: `UNNECESSARY_MARKERS.md`)
- **Round 2 reviewed HEAD**: `37a5cbf5db` — worktree HEAD is `ca36b6bb9f`, which adds only the 7 round-1 report `.md` files at the repo root; all sweeps below were run against the PR diff to `37a5cbf5db` so report files do not pollute marker counts
- **Fix-commit delta**: `git diff cce22e608f..37a5cbf5db` = 65 files
- **Pre-merge Kilo base**: `b135b4e10a` (round-2 PR diff = 398 files; round 1 was 390)
- **Upstream tag**: `v1.18.13` = `a105350812f05f914c768e468559dbd6bd508d8e` (resolved locally via `.opencode-version`; no network used)

## Headline answer

**The 4 fix commits introduced zero unnecessary markers and left zero behind.** Round 1's conclusion still holds at the new head: no file in the PR diff is identical to upstream while carrying markers, and no delta file carries markers without real drift. The same 4 pre-existing `markers-only` files from round 1 remain the only repo-wide occurrences — still untouched by this PR, still not in the PR diff.

- **New findings: 0**
- **Round-1 findings re-verified: 4 of 4 still present, still stale, still pre-existing (untouched by the fix commits)**

## Methodology

### Scripts (read first, run with `--dry-run` only)

- `script/upstream/find-reset-candidates.ts [path] [--dry-run] [--review-limit n] [--concurrency n]` — pre-filters `git diff --name-only <last-merged-upstream>..HEAD` (excluding kilo-only paths `packages/kilo-*/**`, `**/kilocode/**`, `script/upstream`, non-code assets, and `keepOurs`/`skipFiles` policy files), then classifies each file against **transformed** upstream. `markers-only` = stripping `kilocode_change` markers makes local match transformed upstream — this report's core finding type.
- `script/upstream/reset-to-upstream.ts <file> --dry-run` — per-file verification; `[DRY-RUN] Would reset ...` when local differs from transformed upstream, `already matches` when identical.
- Upstream ref resolution: unchanged from round 1 (`last()` reads `.opencode-version` = `v1.18.13`, resolves locally to `a105350812`).

### Invocations

```
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1   # full repo scan, report only
bun run script/upstream/reset-to-upstream.ts <file> --dry-run                # per-finding verification (4 files)
git diff --name-only cce22e608f..37a5cbf5db                                  # 65 fix-commit delta files
git diff --name-only b135b4e10a..37a5cbf5db                                  # 398 PR files (reviewed head)
git diff --name-only b135b4e10a..cce22e608f                                  # 390 PR files (round-1 head, for set diff)
git diff a105350812..HEAD -- <path>                                          # raw upstream diff per file
bun <tmp>/strip-check.ts <pr-marker-files>                                   # marker-strip replication via repo's own clean()
```

`--concurrency 1` was used per round-1 experience (default concurrency hung in this environment); the serial run completed with `EXIT=0`. Default concurrency was not retried this round.

### Scan output (serial run at new head, dry-run)

```
[OK] Last merged upstream: v1.18.13 (a1053508)
[INFO] Candidate files: 1266            (round 1: 1247)
[INFO] Pre-bucketed 385 (missing or too-large)   (round 1: 375)
[INFO] Classifying 881 file(s)...  Classified 881/881

| Bucket | Count | Action |
|---|---|---|
| markers-only | 4 | would reset |
| cosmetic-only | 2 | would reset |
| small-diff | 202 | would reset |
| large-diff | 493 | skipped |
| identical | 179 | nothing to do |
| upstream-missing | 385 | skipped |
| local-missing | 1 | skipped |
```

Round-1 → round-2 bucket shifts: `markers-only` 4→4 (same files), `cosmetic-only` 2→2 (same files), `small-diff` 197→202, `large-diff` 487→493, `identical` 182→179, `upstream-missing` 375→385, `local-missing` 0→1, config-protected 2105→2108. All shifts traced to the fix commits (see below).

## Round-1 verification status

All 4 round-1 findings **re-confirmed at the new head**:

| File | Touched by fix commits? | Markers at HEAD | Raw diff vs `a105350812` | Scan bucket | `reset-to-upstream --dry-run` |
|---|---|---|---|---|---|
| `packages/core/test/session-prompt.test.ts` | no | 1 | marker comment line only (unchanged) | `markers-only` | `Would reset ... to transformed upstream v1.18.13` |
| `packages/opencode/src/cli/cmd/run/demo.ts` | no | 1 | import rebrand + inline marker only (unchanged) | `markers-only` | `Would reset ...` |
| `packages/opencode/src/cli/cmd/run/subagent-data.ts` | no | 1 | import rebrand + inline marker only (unchanged) | `markers-only` | `Would reset ...` |
| `packages/sdk/js/src/error-interceptor.ts` | no | 1 | `kilo server` branding + standalone marker only (unchanged) | `markers-only` | `Would reset ...` |

Additional confirmations:

- None of the 4 is in the round-2 PR diff (`git diff --name-only b135b4e10a..37a5cbf5db -- <files>` is empty) — they remain pre-existing stale markers, not merge or fix-commit regressions.
- Each still has exactly 1 marker line, identical raw upstream diff to round 1.
- Suggested actions from round 1 are unchanged (delete the marker comment, or `reset-to-upstream.ts` the file) — still best done in a separate hygiene commit, not this PR.

## New findings

**None.**

The checks that could have produced findings, and their results:

1. **Delta files with markers** — 45 of the 65 delta files contain `kilocode_change` at the new head. For each: raw `git diff a105350812..HEAD -- <path>` is non-empty (a marker line alone guarantees this), and — the meaningful test — **none** is classified `markers-only` or `identical` against transformed upstream:
   - 36 in `large-diff` (incl. `provider/transform.ts` (141 lines), `provider/provider.ts` (144), `tool/task.ts` (160), `footer.command.tsx` (9), all 19 `packages/ui/src/i18n/*.ts` (18–23), `modal/modal.ts` (10), `modal/models.ts` (7), test files).
   - 5 in `small-diff`, all eyeballed — every marker sits on a real code change:
     - `packages/llm/test/provider-error.test.ts` (2) — two added rate-limit test strings with inline markers.
     - `packages/session-ui/src/v2/components/prompt-input/interaction.ts` (4) — real `part.type !== "image"` guard, inline marker.
     - `packages/session-ui/src/v2/components/prompt-input/types.ts` (2) — real `revoke?: true` field, inline marker (the import rebrand on line 1 is transform-covered and correctly unmarked).
     - `packages/ui/src/components/scroll-view.tsx` (2) — real `hoverRoot` logic change, inline marker.
     - `packages/ui/src/v2/components/toast-v2.tsx` (2) — real `local.swipeDirections ??` fallback, inline marker.
   - 1 `upstream-missing` (kilo-only): `script/check-test-ci.ts` (`// kilocode_change - new file` — conventional, expected).
   - 3 not scanned (excluded `script/upstream` pathspec, kilo-owned merge tooling): `script/upstream/transforms/transform-i18n.ts`, `transform-i18n.test.ts`, `transform-package-json.ts` — markers expected there.
2. **Fix commits making a diverged file identical to upstream while leaving markers** — impossible to reach raw-identical with markers (marker lines are themselves diffs), and confirmed empty both ways: 0 of the 65 delta files are byte-identical to raw upstream; the `markers-only` bucket contains no delta file. The only delta file that became identical to **transformed** upstream is `packages/opencode/src/session/prompt/meta.txt` — via the fix commits' new `takeTheirsAndTransform` config entry — and it carries **no markers**.
3. **Fresh full-PR sweep** (`b135b4e10a..37a5cbf5db`, 398 files):
   - 118 PR files contain markers (round 1: 101; +17 added by fix commits, 0 removed — listed below).
   - 202 PR files are byte-identical to raw upstream (round 1: 215); grepped all 202 → **0 contain markers**.
   - Marker-strip replication over all 118 marker files using the repo's own `clean()` (`script/upstream/utils/markers.ts`) + `join()`: **0 become byte-identical to raw upstream**; 109 retain real diffs; 9 are kilo-only (absent upstream): the 6 from round 1 (`packages/opencode/src/kilocode/tool/task.ts`, `packages/opencode/src/provider/models.ts`, `script/check-model-tool-network.ts`, `script/upstream/README.md`, `script/upstream/merge.ts`, `script/upstream/transforms/transform-package-json.ts`) plus 3 added by fix commits (`script/check-test-ci.ts`, `script/upstream/transforms/transform-i18n.ts`, `transform-i18n.test.ts`). All 9 are kilo-owned paths where markers are conventional.

Marker files added by the fix commits (17): `.github/workflows/test.yml`, `packages/llm/src/provider-error.ts`, `packages/llm/test/provider-error.test.ts`, `packages/opencode/src/cli/cmd/run/footer.command.tsx`, `packages/opencode/src/plugin/modal/modal.ts`, `packages/opencode/src/plugin/modal/models.ts`, `packages/opencode/test/plugin/modal-models.test.ts`, `packages/session-ui/src/v2/components/prompt-input/{attachments,interaction,store.test,store,types}.ts`, `packages/ui/src/components/scroll-view.tsx`, `packages/ui/src/v2/components/toast-v2.tsx`, `script/check-test-ci.ts`, `script/upstream/transforms/transform-i18n{,.test}.ts`. Bucket assignments above; all markers justified.

## Notable non-findings

- **PR-diff set churn from the fix commits** (390 → 398): 20 paths added (7 are the round-1 report `.md` files from docs commit `ca36b6bb9f`, not part of the reviewed head; the rest include 4 new `test/kilocode/**` tests, `script/check-test-ci.ts`, 3 `script/upstream/**` tooling files, `patches/solid-js@1.9.12.patch`, `.changeset/opencode-v1-18-0.md`, `.github/workflows/test.yml`, `packages/kilo-vscode/tests/unit/language-utils.test.ts`), 5 dropped back to base state (`packages/http-recorder/package.json`, `patches/@dnd-kit%2Fdom@0.5.0.patch`, `script/translate-app.{ts,test.ts,md}`).
- **New `local-missing` bucket entry: `patches/@dnd-kit%2Fdom@0.5.0.patch`.** The merge had brought this patch in from upstream byte-identical; fix commit `37a5cbf5db` deleted it (40 deletions). Verified safe with respect to references: no `dnd-kit` entry in HEAD `package.json` `patchedDependencies` (upstream still has it at line 147), no `dnd-kit` anywhere in `bun.lock`, no workspace `packages/*/package.json` dependency. Not marker-related; flagged for human awareness only (intentional orphan-patch cleanup).
- **`script/translate-app.{ts,test.ts,md}` deleted + added to `skipFiles`.** Fix commits removed these upstream files ("Upstream app translation automation targets products and binaries Kilo does not ship" — `script/upstream/utils/config.ts`) which is exactly why config-protected count rose 2105→2108 and why the scanner does not bucket them `local-missing`. `translate-app.ts` had Kilo modifications at the old head but **0 markers**, so the marker question is moot. Not marker-related; flagged for human awareness.
- **The round-1 trio is unchanged**: `packages/opencode/test/account/service.test.ts`, `packages/opencode/test/mcp/oauth-browser.test.ts`, `packages/session-ui/src/components/markdown-worker.ts` — had markers at base `b135b4e10a`, merge dropped marker + dead drift, still byte-identical to raw upstream with 0 markers at the new head, untouched by fix commits. These remain the only 3 "base-marker file now identical to upstream" cases; the fix commits added none.
- **Round-1's 11 justified small-diff marker files**: 10 unchanged (`index.tsx` moved small-diff(4)→large-diff(9) after the fix commits extended its drift — markers still justified); the 5 new small-diff marker files listed above are all justified.
- **`cosmetic-only` bucket unchanged**: `packages/opencode/src/session/prompt/anthropic.txt`, `patches/effect@4.0.0-beta.83.patch` — neither in the PR, neither marker-related.

## Limitations

- **Transformed vs raw comparison**: as in round 1, the scripts compare against upstream *after* Kilo branding/package-name/i18n transforms; all bucket claims above are on the transformed basis, raw-diff claims are labeled as such.
- **File granularity**: buckets classify whole files. An individually-stale marker inside a file that also has real diffs is not detectable at this granularity; per-marker rebuilds (`fix-kilocode-markers.ts <file> --dry-run`) across the 109 real-diff marker files were not performed in this pass (unchanged from round 1).
- **Skipped populations**: 385 pre-bucketed (`upstream-missing`/`too-large`) and 2108 config-protected files were not content-classified; the 3 fix-commit-deleted `translate-app` files fall in the protected set by design. No PR marker file is `too-large`.
- **Marker-unsupported extensions**: `.json` markers are counted as ordinary drift (e.g. `packages/codemode/tsconfig.json`, `small-diff` 4 lines, real config changes — unchanged from round 1).
- **Environment**: serial dry-run used throughout (`--concurrency 1`); default-concurrency behavior not retested. No writes performed at any point — both scripts ran with `--dry-run`, and the worktree remained clean (`git status --porcelain` empty before and after).
