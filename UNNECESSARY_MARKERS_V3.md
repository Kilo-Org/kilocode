# Unnecessary `kilocode_change` Markers — Upstream Merge Review (Round 3)

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo, now with latest `origin/main` merged in
- **Round 1 reviewed HEAD**: `cce22e608f` (report: `UNNECESSARY_MARKERS.md`)
- **Round 2 reviewed HEAD**: `37a5cbf5db` (report: `UNNECESSARY_MARKERS_V2.md`)
- **Round 3 reviewed HEAD**: `b6505b164b` — worktree is detached at this commit; tree clean apart from untracked round-3 report files from other review tracks
- **Delta since round 2**: `git diff 37a5cbf5db..b6505b164b` = 433 files (main-merge: `8d4caec308` merged `origin/main` into the v1.18.0 line, `b6505b164b` merged that line into the v1.18.13 branch)
- **New PR base**: `6fce4e2564` (full PR diff = `git diff 6fce4e2564...b6505b164b` = 419 files; round 2 was 398 files against old base `b135b4e10a`)
- **Upstream tag**: `v1.18.13` = `a105350812f05f914c768e468559dbd6bd508d8e` (resolved locally via `.opencode-version`; no network used)

## Headline answer

**The main-merge introduced 8 new unnecessary markers.** All 8 are in `packages/ui/src/i18n/` locale files (`az`, `fi`, `hi`, `id`, `pa`, `sv`, `ur`, `vi`): each file's entire drift from transformed upstream is a single inline `// kilocode_change` comment on an `OpenCode Go` → `Kilo Go` branding line that the merge transforms reproduce automatically. All 8 files carried **0 markers at the round-2 head** — the markers were added by the delta (via conflict-resolution merge `d99467fa02`), so they are new regressions of the "stale marker" type, not pre-existing hygiene items. All 8 are in the PR diff.

Round 2's conclusion otherwise still holds: the 4 pre-existing `markers-only` files remain the only other occurrences repo-wide, still untouched and still outside the PR diff. No file in the PR diff is byte-identical to upstream while carrying markers.

- **New findings: 8** (all delta-introduced, all in the PR diff)
- **Prior findings re-verified: 4 of 4 still present, still stale, still pre-existing**

## Methodology

### Delta changed the tooling itself — semantic-shift audit (done first)

`git diff --name-status 37a5cbf5db..b6505b164b -- script/upstream/` shows 13 changed files. The classification-relevant changes:

1. **New `transforms/remove-kilo-web.ts`** — `translate()` (the comparison baseline builder in `utils/upstream.ts`) now runs `removeKiloWeb()` on `packages/opencode/src/index.ts` only: it replaces the upstream `WebCommand` import/registration with the exact `// kilocode_change - upstream web command intentionally omitted...` comment lines Kilo ships. Effect: those two markers are now part of the transformed baseline for `index.ts` (they no longer count as drift). `index.ts` still lands in `large-diff` (24 non-marker lines) on its other real Kilo drift, so no bucket change.
2. **`utils/config.ts`** — `packages/opencode/src/cli/cmd/web.ts` added to `skipFiles` ("Kilo does not ship upstream's embedded web UI command"). The file itself was deleted in the delta (commit `7f1b402587` "preserve kilo web command removal"); it is now config-protected and excluded from the scan.
3. **`transforms/transform-i18n.ts`** — `transformI18nContent()` gained a `markers` parameter: marker appending on replaced lines now happens only when requested. `translate()` passes `isI18nFile(file)`; the file-writing path (`transformI18nFile`, used by real merges) passes `true` (unchanged behavior). Replacement rules (`I18N_REPLACEMENTS`, `PRESERVE_PATTERNS`) are byte-identical between heads. This does not affect the 8 findings: the `OpenCode Go` → `Kilo Go` replacement is applied earlier by the branding transform (`transform-take-theirs.ts`, `/\bOpenCode\b(?!\.json|\/| Zen)/g`), so the i18n transform fires zero replacements on that line and appends no marker to the baseline under either old or new semantics.
4. **`transforms/transform-package-json.ts`** — baseline now deletes `opentui-spinner` from dependencies/catalog (Kilo removed it as an incompatible OpenTUI runtime; see the matching local shim in `packages/tui/src/ui/spinner.ts`, non-finding below).
5. **Unchanged**: `find-reset-candidates.ts`, `reset-to-upstream.ts`, `utils/reset.ts` (`classifyDrift`), `utils/markers.ts` (`clean`) — `git diff 37a5cbf5db..b6505b164b` on all four is empty, so bucket semantics are directly comparable to rounds 1–2.

### Scripts (read first, run with `--dry-run` only)

- `script/upstream/find-reset-candidates.ts [path] [--dry-run] [--review-limit n] [--concurrency n]` — pre-filters `git diff --name-only <last-merged-upstream>..HEAD` (excluding kilo-only paths `packages/kilo-*/**`, `**/kilocode/**`, `script/upstream`, non-code assets, and `keepOurs`/`skipFiles` policy files), then classifies each file against **transformed** upstream. `markers-only` = stripping `kilocode_change` markers from both sides makes local match transformed upstream — this report's core finding type.
- `script/upstream/reset-to-upstream.ts <file> --dry-run` — per-file verification; `[DRY-RUN] Would reset ...` when local differs from transformed upstream, `already matches` when identical.
- Upstream ref resolution: unchanged (`last()` reads `.opencode-version` = `v1.18.13`, resolves locally to `a105350812`).

### Invocations

```
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1   # full repo scan, report only (EXIT=0)
bun run script/upstream/reset-to-upstream.ts <file> --dry-run                # per-finding verification (all 12 markers-only files)
git diff --name-only 37a5cbf5db..b6505b164b                                  # 433 delta files
git diff --name-only 6fce4e2564...b6505b164b                                 # 419 PR files (new base)
git diff a105350812..HEAD -- <path>                                          # raw upstream diff per file
bun <tmp>/v3-marker-check.ts <files>                                         # translated-vs-local line diff via repo's own translate()/classifyDrift()/clean()
bun <tmp>/v3-strip-check.ts                                                  # marker-strip replication over all 131 PR marker files via repo's own clean()
```

`--concurrency 1` per rounds 1–2 (default concurrency reproducibly hung in this environment); the serial run completed with `EXIT=0`. Default concurrency was not retried. Helper scripts lived in the session temp dir and performed no repo writes.

### Scan output (serial run at `b6505b164b`, dry-run)

```
[OK] Last merged upstream: v1.18.13 (a1053508)
[INFO] Skipping 342 non-code asset(s)
[INFO] Skipping 2112 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1312            (round 2: 1266)
[INFO] Pre-bucketed 414 (missing or too-large)   (round 2: 385)
[INFO] Classifying 898 file(s)...  Classified 898/898   (round 2: 881)

| Bucket | Count | Action |
|---|---|---|
| markers-only | 12 | would reset |        (round 2: 4)
| cosmetic-only | 2 | would reset |        (round 2: 2, same files)
| small-diff | 204 | would reset |        (round 2: 202)
| large-diff | 497 | skipped |            (round 2: 493)
| identical | 171 | nothing to do |       (round 2: 179)
| upstream-missing | 414 | skipped |      (round 2: 385)
| local-missing | 12 | skipped |          (round 2: 1)
```

The `markers-only` jump 4 → 12 is the round-3 story (see New findings). `local-missing` 1 → 12 and `upstream-missing` 385 → 414 are main-merge deletions/additions, none marker-related (non-findings below). `identical` 179 → 171: 8 files left the bucket — exactly the 8 files that gained markers and moved to `markers-only` (the rest of the churn is main-merge content updates moving files between `identical`/`small-diff`/`large-diff`).

## Prior-findings verification

All 4 round-1/round-2 findings **re-confirmed at `b6505b164b`**:

| File | Touched by delta? | Markers at HEAD | In PR diff? | Scan bucket | `reset-to-upstream --dry-run` |
|---|---|---|---|---|---|
| `packages/core/test/session-prompt.test.ts` | no | 1 | no | `markers-only` | `Would reset ... to transformed upstream v1.18.13` |
| `packages/opencode/src/cli/cmd/run/demo.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/opencode/src/cli/cmd/run/subagent-data.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/sdk/js/src/error-interceptor.ts` | no | 1 | no | `markers-only` | `Would reset ...` |

- Raw upstream diffs are byte-for-byte the round-1 evidence (single marker comment line / single rebranded import + inline marker / `kilo server` string + standalone marker).
- `git diff --name-only 37a5cbf5db..b6505b164b -- <file>` and `git diff --name-only 6fce4e2564...b6505b164b -- <file>` are both empty for all four — still pre-existing stale markers, untouched by the main-merge and outside the PR.
- Suggested actions unchanged (delete the marker comment, or `reset-to-upstream.ts` the file) — still best done in a separate hygiene commit, not this PR.

## New findings

### 8 locale files in `packages/ui/src/i18n/` — 1 unnecessary marker each (delta-introduced)

Files: `az.ts`, `fi.ts`, `hi.ts`, `id.ts`, `pa.ts`, `sv.ts`, `ur.ts`, `vi.ts`. All eight show the identical pattern; `az.ts` is representative.

**Evidence (`az.ts`)** — entire raw `git diff a105350812..HEAD` is one line:

```diff
   "dialog.usageExceeded.freeTier.description":
-    "Ayda $5-dan başlayan OpenCode Go abunəliyi ilə ən yaxşı açıq mənbəli modellərə etibarlı giriş əldə edin.",
+    "Ayda $5-dan başlayan Kilo Go abunəliyi ilə ən yaxşı açıq mənbəli modellərə etibarlı giriş əldə edin.", // kilocode_change
```

- The `OpenCode Go` → `Kilo Go` wording is reproduced by the merge branding transform (`transform-take-theirs.ts`, `/\bOpenCode\b(?!\.json|\/| Zen)/g`). Verified with the repo's own pipeline at the reviewed head: `translate()` output vs local file differ on **exactly one line** — local carries the trailing ` // kilocode_change`, the transformed baseline does not — and `clean()`-stripped local === stripped baseline (`stripped-equal=true`, 198 lines each). Same result for `fi.ts`; all 8 are `markers-only` in the scan and each was re-confirmed with `reset-to-upstream.ts --dry-run` → `[DRY-RUN] Would reset ... to transformed upstream v1.18.13`. A reset keeps the `Kilo Go` string (the transform reapplies it) and drops only the comment.
- **Delta-introduced**: all 8 files had **0 markers at the round-2 head** (`git show 37a5cbf5db:<file> | grep -c kilocode_change` = 0 for all eight) and matched transformed upstream then (`identical` bucket). The delta added the marker (`git diff 37a5cbf5db..b6505b164b -- az.ts` = marker suffix only). `git log 37a5cbf5db..b6505b164b -- packages/ui/src/i18n/az.ts` attributes the change to merge commit `d99467fa02` ("resolve merge conflicts", merging the v1.18.0+main line `4174457a0d` back into the v1.18.13 line at round-1 head `cce22e608f`) — i.e. the markers are a conflict-resolution artifact, not deliberate new annotations.
- **In the PR diff**: `git diff --name-only 6fce4e2564...b6505b164b` includes all 8.
- **Stability of removal**: removing the markers will not be undone by the next merge — the file-writing i18n transform appends markers only where its own replacements fire, and the `OpenCode` → `Kilo` replacement on these lines is applied earlier by the branding transform, so no replacement fires on local content that already says `Kilo Go`.
- **Suggested action**: drop the trailing ` // kilocode_change` on the one line in each of the 8 files, or run `bun run script/upstream/reset-to-upstream.ts packages/ui/src/i18n/<file>.ts` per file. Small enough to fold into this PR or a follow-up hygiene commit.

Per-file raw-diff size is 13 lines for all eight (5 header/context lines + the single-line hunk); each has exactly 1 marker at HEAD.

## Notable non-findings

### Delta checks (433 files, `37a5cbf5db..b6505b164b`)

- **58 delta files contain `kilocode_change` at HEAD**: 8 `markers-only` (the findings), 29 `large-diff`, 3 `small-diff`, 16 unscanned kilo-only paths (`packages/kilo-vscode/**`, `packages/opencode/src/kilocode/**`, `test/kilocode/**`, `script/upstream/**` — markers conventional), 2 `upstream-missing` kilo-only (`.kilo/plans/agent-manager-multi-project-sidebar-density.md`, `packages/tui/src/routes/session/terminal.tsx`).
- **"Newly identical to upstream while markers remain": zero.** 0 of the 433 delta files are byte-identical to raw upstream while carrying markers. (The 3 nominally raw-identical delta files — `.changeset/opencode-v1-18-0.md`, `.kilo/plans/agent-manager-multi-project-{implementation-handoff,shipping-gaps}.md` — are delta *deletions*, absent on both sides, so `git diff --quiet` is trivially true. Not findings.)
- **The 3 small-diff delta marker files eyeballed — every marker sits on a real change**:
  - `packages/core/src/repository-cache.ts` (4 lines) — real reuse-guard change (`fs.existsSafe(... ".git")` replacing worktree path resolution), inline markers.
  - `packages/schema/src/file-diff.ts` (2 lines) — real added `before`/`after` schema fields with inline markers. Delta-only: not in the PR diff because the change already reached the new base `6fce4e2564` from main.
  - `packages/tui/src/ui/spinner.ts` (3 lines) — real local `ColorGenerator` type shim replacing the removed `opentui-spinner` import, `kilocode_change start/end` block. Matches the delta's new `opentui-spinner` deletion in `transform-package-json.ts`.
- **Prioritized shared files**: `packages/opencode/src/index.ts` (large-diff 24, 15 markers — all on real Kilo drift: `KiloCli` wiring, `scriptName("kilo")`, omitted account/web commands; the 2 web-omit markers are now also part of the transformed baseline via `removeKiloWeb`), `session/session.ts` (329), `session/summary.ts` (67), `snapshot/index.ts` (302), `tool/grep.ts` (36), `tool/task.ts` (154), httpapi `groups/session.ts` (27) / `handlers/session.ts` (75), all `packages/tui/**` marker files — `large-diff` with real drift, markers justified. `packages/plugin/src/tui.ts` is in the delta with **0 markers**. `packages/opencode/src/cli/cmd/web.ts` was deleted in the delta and added to `skipFiles` — no marker question (file absent).
- **No new "dropped-marker" cases**: 0 files had markers at the round-2 head and are now byte-identical to raw upstream with 0 markers. The round-2 trio (`packages/opencode/test/account/service.test.ts`, `packages/opencode/test/mcp/oauth-browser.test.ts`, `packages/session-ui/src/components/markdown-worker.ts`) is unchanged: 0 markers, byte-identical to raw upstream, untouched by the delta.
- **`local-missing` 1 → 12**: 8 upstream workflows (`.github/workflows/{duplicate-issues,notify-discord,pr-management,publish-github-action,release-github-action,review,stats,triage}.yml`) and 4 patches deleted by the main-merge. The 3 newly-missing patches are stale old-version orphans — `patches/@ff-labs%2Ffff-bun@0.9.3.patch`, `patches/pacote@21.5.0.patch`, `patches/solid-js@1.9.10.patch` — while root `package.json` `patchedDependencies` references the current versions (`fff-bun@0.9.4`, `pacote@21.5.1`, `solid-js@1.9.12`) whose patch files exist (`@dnd-kit/dom` was already covered in round 2). Workflow deletions are guarded by the `check-workflows.ts` allowlist. Not marker-related; flagged for human awareness only.
- **`upstream-missing` 385 → 414**: new kilo-only files from main (changesets, `.kilo/plans`, etc.); expected.
- **`cosmetic-only` unchanged**: `packages/opencode/src/session/prompt/anthropic.txt`, `patches/effect@4.0.0-beta.83.patch` — neither in the PR, neither marker-related.

### Fresh full-PR sweep (419 files, `6fce4e2564...b6505b164b`)

- **131 PR files contain markers** (round 2: 118): 95 `large-diff`, 17 `small-diff`, 8 `markers-only` (the findings), 3 `upstream-missing` kilo-only (`packages/opencode/src/provider/models.ts`, `script/check-model-tool-network.ts`, `script/check-test-ci.ts`), 8 unscanned kilo-only paths (`kilocode/**`, `script/upstream/**`).
- **203 PR files are byte-identical to raw upstream; 0 contain markers** (all 203 grepped, not sampled).
- **Marker-strip replication over all 131 PR marker files** (repo's own `clean()` + `join()` vs raw upstream blobs): **0 become byte-identical to raw upstream after stripping**; 120 retain real diffs; 11 are kilo-only (absent upstream — the 3 bucketed plus the 8 unscanned).
- **The 17 small-diff PR marker files**: 15 are untouched by the delta and keep their round-1/2 "justified" eyeball verdicts (`codemode/tsconfig.json` [`.json` markers counted as ordinary drift; real config changes], `core/src/session/compaction.ts`, `core/src/session/runner/llm.ts`, `llm/test/provider-error.test.ts`, `opencode/src/effect/runtime-flags.ts`, `opencode/test/provider/header-timeout.test.ts`, `session-ui/.../prompt-input/{interaction,types}.ts`, `tui/src/ui/dialog.tsx`, `ui/src/components/{resize-handle.tsx,scroll-view.tsx,select.css}`, `ui/src/styles/theme.css`, `ui/src/v2/components/toast-v2.tsx`, `ui/vite.config.ts`); the 2 new ones (`repository-cache.ts`, `spinner.ts`) were eyeballed above — justified.
- **`identical` bucket (171 files) grepped: 0 markers.** The new baseline-marker behavior (i18n files can now be `identical` *with* transform-produced markers) produced no such case at this head.

## Limitations

- **Transformed vs raw comparison**: the scripts compare against upstream *after* Kilo branding/package-name/i18n transforms (now also `removeKiloWeb` for `index.ts` and `opentui-spinner` deletion for package.json files). All bucket claims above are on the transformed basis; raw-diff claims are labeled as such.
- **File granularity**: buckets classify whole files. An individually-stale marker inside a file that also has real diffs is not detectable at this granularity; per-marker rebuilds (`fix-kilocode-markers.ts <file> --dry-run`) across the 120 real-diff PR marker files were not performed in this pass (unchanged from rounds 1–2). Flagged for human discretion.
- **Skipped populations**: 414 pre-bucketed (`upstream-missing`/`too-large`) and 2112 config-protected files were not content-classified. No PR marker file is `too-large`.
- **Marker-unsupported extensions**: `.json` markers are counted as ordinary drift (`packages/codemode/tsconfig.json`, small-diff 4 lines, real config changes — unchanged).
- **Merge-attribution granularity**: `git log -- <path>` attributes the 8 i18n marker additions to merge commit `d99467fa02` because the merge result differs from its first parent; the exact resolver (manual conflict resolution vs. merge tooling) is not distinguishable from history alone.
- **Environment**: serial dry-run used throughout (`--concurrency 1`, `EXIT=0`); the default-concurrency hang from rounds 1–2 was not retested. No writes performed at any point — both scripts ran with `--dry-run`, helper scripts only read, and the worktree remained clean of modifications (only untracked round-3 report files from parallel review tracks appeared).
