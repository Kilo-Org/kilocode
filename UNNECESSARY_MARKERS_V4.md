# Unnecessary `kilocode_change` Markers — Upstream Merge Review (Round 4)

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo, with latest `origin/main` merged in and round-3 review fixes applied
- **Round 1 reviewed HEAD**: `cce22e608f` (report: `UNNECESSARY_MARKERS.md`)
- **Round 2 reviewed HEAD**: `37a5cbf5db` (report: `UNNECESSARY_MARKERS_V2.md`)
- **Round 3 reviewed HEAD**: `b6505b164b` (report: `UNNECESSARY_MARKERS_V3.md`)
- **Round 4 reviewed HEAD**: `b793883de6` — worktree HEAD is `596bf49680`, which adds only the 21 round-1/2/3 report `.md` files at the repo root (7 tracks × 3 rounds, `git diff b793883de6..HEAD` = 21 files, all `.md`). All sweeps below target `b793883de6` explicitly; the full-repo scan ran at the worktree HEAD, where the 21 report files land harmlessly in `upstream-missing` (verified — see Methodology), so code-file classifications are exactly the reviewed-head results.
- **Delta since round 3**: `git diff b6505b164b..b793883de6` = 151 files (main-merge `72c57d9765`, v1.18.0-line merge `5065743896`, round-3-fix `6d331a726f`, annotation commit `3b2686af84` — the latter two reachable via those merges/branch state; `3b2686af84` is an ancestor of the new base, `6d331a726f` is head-side only)
- **New PR base**: `4f59fcb666` (full PR diff = `git diff 4f59fcb666...b793883de6` = 422 files; round 3 was 419 files against old base `6fce4e2564`)
- **Upstream tag**: `v1.18.13` = `a105350812f05f914c768e468559dbd6bd508d8e` (resolved locally via `.opencode-version`; no network used)

## Headline answer

**All 8 round-3 findings are fixed; the delta introduced zero new unnecessary markers.** The round-3-fix commit `6d331a726f` removed the stray inline marker from all 8 `packages/ui/src/i18n/` locale files (branding line kept, `// kilocode_change` suffix dropped); all 8 now classify `identical` against transformed upstream, and `reset-to-upstream.ts --dry-run` reports "already matches". The repo-wide `markers-only` bucket is back to exactly the 4 pre-existing stale files from rounds 1–3 — still untouched, still outside the PR diff.

- **Round-3 findings re-verified: 8 of 8 FIXED** (markers removed, files now match transformed upstream)
- **Pre-existing findings re-verified: 4 of 4 still present, still stale, still pre-existing**
- **New findings: 0**

## Methodology

### Tooling unchanged since round 3

`git diff --name-status b6505b164b..b793883de6 -- script/upstream/` is **empty** — the finder, resetter, classifier, marker cleaner, and all transforms are byte-identical to the round-3 head, so bucket semantics are directly comparable. Scripts were re-read this round regardless:

- `script/upstream/find-reset-candidates.ts [path] [--dry-run] [--review-limit n] [--concurrency n]` — pre-filters `git diff --name-only <last-merged-upstream>..HEAD` (excluding kilo-only paths `packages/kilo-*/**`, `**/kilocode/**`, `script/upstream`, non-code assets, and `keepOurs`/`skipFiles` policy files), then classifies each file against **transformed** upstream. `markers-only` = stripping `kilocode_change` markers from both sides makes local match transformed upstream — this report's core finding type.
- `script/upstream/reset-to-upstream.ts <file> --dry-run` — per-file verification; `[DRY-RUN] Would reset ...` when local differs from transformed upstream, `already matches` when identical.
- Upstream ref resolution: unchanged (`last()` reads `.opencode-version` = `v1.18.13`, resolves locally to `a105350812`).

### Invocations

```
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1   # full repo scan, report only (FINDER_EXIT=0)
bun run script/upstream/reset-to-upstream.ts <file> --dry-run                # 4 stale files + az.ts/vi.ts spot checks
git diff --name-only b6505b164b..b793883de6                                  # 151 delta files
git diff --name-only 4f59fcb666...b793883de6                                 # 422 PR files (new base)
git diff a105350812..b793883de6 -- <path>                                    # raw upstream diff per file
git show <head>:<path> | grep -c kilocode_change                             # marker counts at both heads
bun <tmp>/v4-strip-check.ts                                                  # marker-strip replication over all 127 PR marker files via repo's own clean()/join()
```

`--concurrency 1` per rounds 1–3 (default concurrency reproducibly hung in this environment); the serial run completed with `FINDER_EXIT=0`. Default concurrency was not retried. The strip-check helper lived in the session temp dir, imported `clean`/`join` from the repo's `script/upstream/utils/markers.ts`, and performed no repo writes.

### Scan output (serial run at worktree HEAD `596bf49680` = `b793883de6` + 21 report-only `.md` files, dry-run)

```
[OK] Last merged upstream: v1.18.13 (a1053508)
[INFO] Skipping 342 non-code asset(s)
[INFO] Skipping 2112 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1348            (round 3: 1312; +21 report files → 1327 comparable)
[INFO] Pre-bucketed 445 (missing or too-large)   (round 3: 414; +21 report files → 424 comparable)
[INFO] Classifying 903 file(s)...  Classified 903/903   (round 3: 898)

| Bucket | Count | Action |
|---|---|---|
| markers-only | 4 | would reset |        (round 3: 12)
| cosmetic-only | 2 | would reset |        (round 3: 2, same files)
| small-diff | 206 | would reset |        (round 3: 204)
| large-diff | 502 | skipped |            (round 3: 497)
| identical | 177 | nothing to do |       (round 3: 171)
| upstream-missing | 445 | skipped |      (round 3: 414; 424 comparable, +10 net new kilo-only)
| local-missing | 12 | skipped |          (round 3: 12, same 12 files)
```

All 21 report `.md` files were verified to appear in the `upstream-missing` list, so they inflate only that bucket and the candidate count. The `markers-only` drop 12 → 4 is the round-4 story: the 8 locale files moved to `identical` (all 8 are listed in the `identical` bucket). The `markers-only (4)` section lists exactly the 4 pre-existing files:

```
## markers-only (4) — would reset
- `packages/core/test/session-prompt.test.ts`
- `packages/opencode/src/cli/cmd/run/demo.ts`
- `packages/opencode/src/cli/cmd/run/subagent-data.ts`
- `packages/sdk/js/src/error-interceptor.ts`
```

## Prior-findings verification

### Round-3 findings (8 locale files) — ALL FIXED

`packages/ui/src/i18n/{az,fi,hi,id,pa,sv,ur,vi}.ts`. Per-file state at `b793883de6` (identical for all eight):

| Check | Result |
|---|---|
| Markers at `b793883de6` | **0** (was 1 at `b6505b164b`) |
| Attribution | `6d331a726f` "fix(core): address round 3 review findings for upstream merge" touched all 8 |
| Delta diff content | marker suffix removal only — representative `az.ts` hunk: `-"…Kilo Go…", // kilocode_change` → `+"…Kilo Go…",` |
| Raw `git diff a105350812..b793883de6` | 13 lines each — the single `OpenCode Go` → `Kilo Go` branding line remains, reproduced by the merge branding transform |
| Scan bucket | `identical` (all 8 listed) — was `markers-only` at round 3 |
| `reset-to-upstream.ts --dry-run` | `az.ts`, `vi.ts`: **`already matches transformed upstream v1.18.13`** (was `Would reset` at round 3); scan bucket covers the other 6 |
| In PR diff? | yes, all 8 (as fixed state; `6d331a726f` is head-side, not an ancestor of base `4f59fcb666`) |

The fix matches round 3's suggested action exactly (drop the trailing marker, keep the transformed branding line). Removal stability reasoning from round 3 still holds (branding transform fires before the i18n marker-appending transform; no script changes in the delta).

### Pre-existing stale files (rounds 1–3) — 4 of 4 still present, still stale

| File | Touched by delta? | Markers at `b793883de6` | In PR diff? | Scan bucket | `reset-to-upstream --dry-run` |
|---|---|---|---|---|---|
| `packages/core/test/session-prompt.test.ts` | no | 1 | no | `markers-only` | `Would reset ... to transformed upstream v1.18.13` |
| `packages/opencode/src/cli/cmd/run/demo.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/opencode/src/cli/cmd/run/subagent-data.ts` | no | 1 | no | `markers-only` | `Would reset ...` |
| `packages/sdk/js/src/error-interceptor.ts` | no | 1 | no | `markers-only` | `Would reset ...` |

- `git diff --name-only b6505b164b..b793883de6 -- <file>` and `git diff --name-only 4f59fcb666...b793883de6 -- <file>` are both empty for all four — still pre-existing stale markers, untouched by the delta and outside the PR.
- Suggested actions unchanged (delete the marker comment, or `reset-to-upstream.ts` the file) — still best done in a separate hygiene commit, not this PR.

## New findings

**None.**

The checks that could have produced findings, and their results:

1. **Delta files byte-identical to raw upstream while carrying markers** — swept all 151 delta files (`git diff --quiet a105350812..b793883de6 -- <path>` with existence on both sides + marker grep): **zero** byte-identical files at all, so zero with markers.
2. **Annotation commit `3b2686af84` over-marking check** — it touched exactly 2 files, and neither is otherwise-upstream-identical:
   - `packages/opencode/script/build.ts` (markers 45→47): added `kilocode_change start/end` around the Kilo-only `isKiloConsoleUpToDate`/`buildKiloConsole` functions and folded `await $`rm -rf dist`` into an existing marker block. Scan: `large-diff` (273 lines of real drift). Markers wrap real Kilo build wiring — justified, not over-marking.
   - `packages/opencode/script/test-runner.ts` (markers 2→4): added `start/end` around the `TestCli`-supplied-binary block. The file is **absent upstream** (kilo-only, carries the conventional `// kilocode_change - new file` header) — markers conventional.
   - Additionally, `3b2686af84` is an **ancestor of the new PR base** `4f59fcb666` (`git merge-base --is-ancestor`), so its annotations are already in the base and are not net-new PR content.
3. **18 delta files gained markers** (round-3 head → round-4 head). Every one verified justified or kilo-only; none is `markers-only` or `identical` in the scan:

   | File | Gained | Bucket | Verdict |
   |---|---|---|---|
   | `packages/opencode/src/format/index.ts` | 0→3 | small-diff (5) | eyeballed raw diff: markers on real env-sanitization drift (`modelEnv` import, `extendEnv: false`) |
   | `packages/opencode/src/lsp/launch.ts` | 0→3 | small-diff (3) | eyeballed: same env-sanitization change — justified |
   | `packages/opencode/src/util/process.ts` | 0→3 | small-diff (4) | eyeballed: real new `extendEnv` option — justified |
   | `packages/opencode/src/mcp/index.ts` | 26→29 | large-diff (90) | eyeballed delta hunks: +3 markers on the real `modelEnv(...)` MCP env-sanitization rewrite — justified |
   | `packages/opencode/src/session/session.ts` | 79→80 | large-diff (330) | eyeballed delta hunks: +1 marker on a real added line (`platform: KiloSession.resolvePlatform(original.id)`) — justified |
   | `packages/core/src/pty.ts` | 25→27 | large-diff (69) | real drift, markers scale with it |
   | `packages/schema/src/pty.ts` | 2→4 | large-diff (8) | real drift |
   | `packages/opencode/src/tool/shell.ts` | 42→44 | large-diff (142) | real drift |
   | `packages/opencode/script/build.ts` | 45→47 | large-diff (273) | annotation commit, see check 2 |
   | `packages/opencode/test/lsp/launch.test.ts` | 0→2 | large-diff (29) | test coverage for the real launch.ts change |
   | `packages/opencode/test/util/process.test.ts` | 0→2 | large-diff (17) | test coverage for the real process.ts change |
   | `packages/opencode/test/server/httpapi-pty.test.ts` | 0→2 | large-diff (7) | real test drift |
   | `packages/opencode/test/server/httpapi-exercise/backend.ts` | 3→5 | large-diff (26) | real drift |
   | `packages/opencode/script/test-runner.ts` | 2→4 | upstream-missing | kilo-only file, conventional markers |
   | `packages/opencode/script/kilocode/test-cli.ts` | 0→1 | excluded (kilocode path) | kilo-only, `new file` header |
   | `packages/ui/src/context/marked-code-span.ts` | 0→1 | upstream-missing | kilo-only, `new file` header (added by `6d331a726f`) |
   | `packages/ui/src/context/marked-code-span.test.ts` | 0→1 | upstream-missing | kilo-only, `new file` header (added by `6d331a726f`) |
   | `script/check-architecture.ts` | 0→1 | upstream-missing | kilo-only, `new file` header |

   Only 8 delta files **lost** markers: exactly the 8 fixed locale files (1→0 each). **No new dropped-marker cases**: 0 files that had markers at the round-3 head are now byte-identical to raw upstream (the 8 locale files still differ by the transform-covered branding line, raw diff 13 lines each).
4. **Prioritized shared files** (task-specified): `command/index.ts` (large-diff 100, 30 markers), `format/index.ts` (small 5, justified above), `lsp/launch.ts` (small 3, justified), `mcp/index.ts` (large 90, justified), `session/session.ts` (large 330, justified), `tool/shell.ts` (large 142, 44 markers), `util/process.ts` (small 4, justified), `core/src/pty.ts` (large 69, 27 markers), `schema/src/pty.ts` (large 8, 4 markers) — all carry real drift, none `markers-only`/`identical`. `packages/client/src/generated/{client.ts,types.ts,.httpapi-codegen.json}`: **0 markers** each (client.ts/types.ts have real generated drift, `.httpapi-codegen.json` is byte-identical to upstream).

### Fresh full-PR sweep (422 files, `4f59fcb666...b793883de6`)

- **127 PR files contain markers** (round 3: 131). Churn fully accounted for: **−8** = the fixed locale files; **+4** = `script/kilocode/test-cli.ts` (gained its conventional `new file` header via the delta), `session/session.ts` (re-entered the PR diff because the new base diverges from it — at round 3 its state was fully contained in old base `6fce4e2564`), `marked-code-span.{ts,test.ts}` (kilo-only, added by `6d331a726f`).
- Bucket breakdown of the 127: **96 `large-diff`, 17 `small-diff`, 0 `markers-only`, 0 `identical`**, 5 `upstream-missing` kilo-only (`packages/opencode/src/provider/models.ts`, `packages/ui/src/context/marked-code-span.{ts,test.ts}`, `script/check-model-tool-network.ts`, `script/check-test-ci.ts`), 9 unscanned kilo-only paths (`kilocode/**`, `script/upstream/**`).
- **200 PR files are byte-identical to raw upstream; 0 contain markers** (all 200 grepped, not sampled).
- **Marker-strip replication over all 127 PR marker files** (repo's own `clean()` + `join()` vs raw upstream blobs): **0 become byte-identical to raw upstream after stripping**; 113 retain real diffs; 14 are kilo-only (absent upstream — the 5 bucketed plus the 9 unscanned).
- **The 17 `small-diff` PR marker files are exactly round 3's 17** (`codemode/tsconfig.json`, `core/src/repository-cache.ts`, `core/src/session/compaction.ts`, `core/src/session/runner/llm.ts`, `llm/test/provider-error.test.ts`, `opencode/src/effect/runtime-flags.ts`, `opencode/test/provider/header-timeout.test.ts`, `session-ui/.../prompt-input/{interaction,types}.ts`, `tui/src/ui/{dialog.tsx,spinner.ts}`, `ui/src/components/{resize-handle.tsx,scroll-view.tsx,select.css}`, `ui/src/styles/theme.css`, `ui/src/v2/components/toast-v2.tsx`, `ui/vite.config.ts`) — all carry their prior "markers on real drift" eyeball verdicts; nothing new entered this bucket with markers.
- **`identical` bucket (177 files) grepped: 0 markers** — the 8 locale files now sit here marker-free, and no file matches transformed upstream while still carrying markers.

## Notable non-findings

- **The round-1/2/3 trio is unchanged**: `packages/opencode/test/account/service.test.ts`, `packages/opencode/test/mcp/oauth-browser.test.ts`, `packages/session-ui/src/components/markdown-worker.ts` — 0 markers, byte-identical to raw upstream, untouched by the delta.
- **`local-missing` 12 = same 12 as round 3**: 8 upstream workflows (`.github/workflows/{duplicate-issues,notify-discord,pr-management,publish-github-action,release-github-action,review,stats,triage}.yml`) and 4 stale/old-version patches (`@dnd-kit%2Fdom@0.5.0`, `@ff-labs%2Ffff-bun@0.9.3`, `pacote@21.5.0`, `solid-js@1.9.10`). Round-3 verification stands (workflow deletions guarded by `check-workflows.ts`; patch orphans unreferenced by current `patchedDependencies`/`bun.lock`). Not marker-related.
- **`upstream-missing` 414 → 424** (comparable basis, excluding the 21 report files): net +10 new kilo-only files from the main-merge (changesets, `marked-code-span.*`, `.github/workflows/check-opencode-annotations.yml`, etc.); expected.
- **23 delta files contain markers at the reviewed head** (round-3 delta: 58 of 433): 13 `large-diff`, 3 `small-diff` (the eyeballed env-sanitization trio), 5 `upstream-missing` kilo-only, 2 unscanned kilo paths (`script/kilocode/test-cli.ts`, `packages/kilo-vscode/package.json`). Zero `markers-only`, zero `identical`.
- **`cosmetic-only` unchanged**: `packages/opencode/src/session/prompt/anthropic.txt`, `patches/effect@4.0.0-beta.83.patch` — neither in the PR, neither marker-related.
- **Delta sweep for raw-upstream-identical files found none at all** — no deletions-ambiguous cases this round (round 3's 3 nominally-identical entries were both-sides-absent deletions; the round-4 delta has no such marker-adjacent cases).

## Limitations

- **Transformed vs raw comparison**: the scripts compare against upstream *after* Kilo branding/package-name/i18n transforms (plus `removeKiloWeb` for `index.ts` and the `opentui-spinner` package.json deletion, both unchanged since round 3). All bucket claims above are on the transformed basis; raw-diff claims are labeled as such.
- **Scan head vs reviewed head**: the finder ran at worktree HEAD `596bf49680`, which adds 21 report `.md` files on top of the reviewed head `b793883de6`. All 21 were verified to land in `upstream-missing`; every code-file classification is therefore exactly the reviewed-head result. All per-file git checks targeted `b793883de6` explicitly.
- **File granularity**: buckets classify whole files. An individually-stale marker inside a file that also has real diffs is not detectable at this granularity; per-marker rebuilds (`fix-kilocode-markers.ts <file> --dry-run`) across the 113 real-diff PR marker files were not performed in this pass (unchanged from rounds 1–3). Flagged for human discretion.
- **Skipped populations**: 445 pre-bucketed (`upstream-missing`/`too-large`, incl. the 21 report files) and 2112 config-protected files were not content-classified. No PR marker file is `too-large`.
- **Marker-unsupported extensions**: `.json` markers are counted as ordinary drift (`packages/codemode/tsconfig.json`, small-diff 4 lines, real config changes — unchanged).
- **Environment**: serial dry-run used throughout (`--concurrency 1`, `FINDER_EXIT=0`); the default-concurrency hang from rounds 1–3 was not retested. No writes performed at any point — both scripts ran with `--dry-run`, the helper script only read, and the worktree remained clean of modifications (one untracked `OPENCODE_MENTIONS_V4.md` from a parallel review track appeared; no repo files were changed by this round).
