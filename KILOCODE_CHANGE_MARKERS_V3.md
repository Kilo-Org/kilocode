# `kilocode_change` Marker Audit v3: PR #12901

## Scope And Method

Round-3 re-review of PR #12901 covering the full fix range `cbbbd7217f..3003a302bc` in two deltas. **Delta 1** (`cbbbd7217f..af6d1ded6d`, 8 files): re-review of v2 finding F1 (P1: restored `isKimiFamily` crashing upstream's `providerID`-less test mocks) plus a marker-hygiene audit of `.github/workflows/test.yml`, root `package.json`, `packages/opencode/src/provider/transform.ts`, `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts`, `packages/sdk-next/package.json`, `script/check-test-ci.ts`, `script/upstream/transforms/transform-package-json.{ts,test.ts}`. **Delta 2** (`af6d1ded6d..3003a302bc`, 14 files, commit `3003a302bc` "fix: address pull request review comments"): marker audit of the OpenTUI spinner-runtime replacement, the it/nl locale translation fill-ins, the `opentui-spinner` dependency removal, and the merge-tooling updates. Reviewed head: `3003a302bc65a4ce0df7c544303c0898db5406e3`. Method: line-level diff of both deltas, marker-block boundary inspection at each head, upstream comparison against tag `v1.18.0`, targeted test execution in the local checkout (`6f676b6dbb`, which differs from the reviewed head only by report `.md` files — verified via `git diff --stat 3003a302bc HEAD`), a differential old-vs-new semantics harness for `isKimiFamily` (delta 1), per-file and whole-tree marker inventory comparisons, and the repo's own guards (`check-test-ci.ts`, `check-opencode-annotations.ts`, `tsgo`).

## V2 Finding Status

| # | v2 finding | Status | Summary |
|---|---|---|---|
| F1 P1 | Restored `isKimiFamily` crashes `providerID`-less mocks; `transform.test.ts` 382 pass / 3 fail | **Fixed** | All three dereferences null-guarded inside the Kilo block, markers untouched and narrow, upstream suite back to 385/0, new regression test covers the undefined-field shape, populated-model semantics byte-equivalent, previously red CI shards green. |

### F1 Verification Detail

(a) **All unsafe dereferences guarded.** At the delta-1 head `af6d1ded6d` (these lines are unchanged at the round-3 head), `transform.ts:1317` is `const value = id?.toLowerCase() ?? ""` — the callback iterates `[model.providerID, model.api.id]`, so one edit guards both fields — and `transform.ts:1322` is `const url = model.api.url?.toLowerCase() ?? ""`, guarding `model.api.url`. These are the exact three dereferences the v2 report named. `model.api` itself needs no guard: upstream's own opus-4.5 line (`transform.ts:1299`) and `anthropicAdaptiveEfforts(model.api.id)` already dereference `model.api` unconditionally, so a defined `api` is an upstream invariant of this code path.

(b) **Guard inside the Kilo block; markers narrow and unchanged.** Both edited lines sit inside the pre-existing `// kilocode_change start` (1313) / `// kilocode_change end` (1325) block wrapping `isKimiFamily`. The call-site block at 1300-1302 is untouched. The delta changes exactly 2 lines in `transform.ts`, neither a marker line; block boundaries are byte-identical between heads. No upstream line re-marked, no marker lost.

(c) **Upstream suite green.** `bun test ./test/provider/transform.test.ts` from `packages/opencode/`: **385 pass, 0 fail**, 692 expect() calls, ~1.9s (v2 head was 382 pass / 3 fail, 689 expect()). The three extra expects vs v2 are the three recovered tests.

(d) **Regression coverage is real.** `kimi-adaptive-effort.test.ts` adds `handles partial metadata from generic Anthropic providers`: `target({ id: "claude-sonnet-4-6" })` (the helper's `providerID`/`url` params are now optional, so the mock has both fields `undefined`) and asserts `variants?.high` equals `{ thinking: { type: "adaptive" }, effort: "high" }`. This asserts both no-crash and correct fall-through to upstream's generic adaptive path (no `display: "summarized"`). At the v2 head this shape deterministically throws — `model.providerID` is the first `.some` element and `undefined.toLowerCase()` throws on the first iteration (confirmed with the differential harness below: old code threw on this exact shape). Suite: **3 pass, 0 fail** (was 2 pass).

(e) **Production semantics unchanged.** Differential harness (old vs new `isKimiFamily` logic) over 9 populated shapes — Kimi by providerID, by API id, by each host, case variations, empty strings, and the pre-existing substring-host-match edge (`api.moonshot.cn.evil.test`, still matches, pre-existing semantics) — produced **0 mismatches**. For defined strings `id?.toLowerCase() ?? ""` is identical to `id.toLowerCase()`; undefined fields now contribute `false` instead of throwing, and defined siblings are still honored (undefined `providerID` + `api.id: "kimi-k3"` → detected `true`).

## New Findings (Delta 1)

None. The delta introduces no marker regressions, no new unmarked Kilo deltas in shared files, and no accidental removals.

## Marker Hygiene Audit (Delta 1: 8-file delta)

- `transform.ts`: both guard lines inside the existing marked block; block boundaries unchanged (see F1b).
- `.github/workflows/test.yml`: the new `Run root tooling unit tests` step (~line 149) sits inside the pre-existing `# kilocode_change start - test non-CLI packages separately from sharded CLI tests` … `end` block (144-158); the junit `report_paths`/`path` multi-line expansions (~182, ~198) sit inside the pre-existing marked publish/upload block (177-201). Both changed regions use context marker lines only — no markers added, moved, or removed.
- Root `package.json` and `packages/sdk-next/package.json`: JSON cannot carry markers; the established compensation mechanism was updated in lockstep — `test:script:ci` was added to `PRESERVE_SCRIPTS["package.json"]` in `transform-package-json.ts` with test coverage, and `packages/sdk-next/package.json: ["test:ci"]` was already in `PRESERVE_SCRIPTS`, so the 10s→30s timeout bump is merge-protected.
- `script/check-test-ci.ts`: new Kilo file in a shared path; line 1 retains `// kilocode_change - new file`. The delta edits the body only, marker intact.
- `script/upstream/transforms/transform-package-json.{ts,test.ts}` and `test/kilocode/provider/kimi-adaptive-effort.test.ts`: Kilo-owned paths (merge tooling, `test/kilocode/`); correctly marker-free (kimi test grep count: 0; the 4 marker-string hits in `transform-package-json.ts` are pre-existing literals in comments/warnings).
- Inventory: v2 head `811` files / `6067` lines → delta-1 head `811` files / `6067` lines (+0/+0); per-file counts identical across all 811 files. No accidental removals.

## Delta 2 Marker Audit: af6d1ded6d..3003a302bc (14 Files)

The delta replaces the `opentui-spinner` package (which nests an incompatible OpenTUI 0.3 runtime) with a Kilo-owned spinner renderable, fills in leftover English strings in the Kilo-added it/nl locales, and updates the merge tooling so future upstream merges re-apply both changes automatically.

### Findings

None. No marker was removed, moved, or invalidated; every new Kilo divergence in a shared upstream file is correctly marked, and the merge tooling was updated in lockstep. One informational item is flagged for human verification below.

### Marker Changes (All Correct)

- `packages/tui/src/component/register-spinner.ts` (+139/-6): at `af6d1ded6d` this file was **byte-identical to upstream `v1.18.0`** (6 lines, unmarked — correctly, since there was no Kilo delta). The new head rewrites it wholesale (own `SpinnerRenderable` against `@opentui/core`, dropping the nested 0.3 runtime) and wraps the entire file in `// kilocode_change start` (line 1) / `// kilocode_change end` (line 139). Whole-file wrap is the right form here: the file exists upstream, so `- new file` would be wrong, and 100% of the content is now Kilo-divergent. Repo precedent exists for line-1 `start` wraps (5 `packages/containers/*/Dockerfile`).
- `packages/tui/src/ui/spinner.ts` (+5/-3): drops the `opentui-spinner` type import; the replacement local `ColorGenerator` type sits in a narrow `start`/`end` block (lines 4-6). Surrounding upstream code stays unmarked. Minimal footprint, correct.
- `script/upstream/transforms/transform-i18n.ts` + `script/upstream/utils/upstream.ts`: fixes a latent **marker over-injection** bug in Kilo's own merge tooling. Previously `translate()` ran `transformI18nContent(branded)` with unconditional marker injection, so any branding replacement in a non-locale file (e.g. `packages/opencode/src/session/prompt/meta.txt`) would get a literal ` // kilocode_change` appended — corrupting prompt text with marker syntax. Now markers are opt-in (`markers = false` default), `transformI18nFile` passes `true`, and `translate()` passes `isI18nFile(file)`. Two new regression tests pin this (`does not inject source markers into non-locale content`, `generic upstream translation keeps prompt text marker-free`). Kilo-owned tooling, correctly marker-free itself.
- `package.json`, `packages/opencode/package.json`, `packages/tui/package.json`, `bun.lock`: `opentui-spinner` removed from the root catalog and both dependency blocks. JSON/lockfiles cannot carry markers; the established compensation was updated in lockstep — `DELETE_UPSTREAM_CATALOG["package.json"]` gained `opentui-spinner` and a new `DELETE_UPSTREAM_DEPENDENCIES` set strips it from dependency blocks during future merges, both with test coverage. Same pattern as the `PRESERVE_SCRIPTS` mechanism validated in delta 1.

Files whose marker counts changed (whole-tree per-file inventory diff, `af6d1ded6d` vs `3003a302bc` — exhaustive, only these 3):

| File | af6d1ded6d | 3003a302bc | Why |
|---|---|---|---|
| `packages/tui/src/component/register-spinner.ts` | 0 | 2 | new whole-file `start`/`end` wrap |
| `packages/tui/src/ui/spinner.ts` | 0 | 2 | new narrow `start`/`end` block |
| `script/upstream/transforms/transform-i18n.test.ts` | 2 | 3 | new assertion literal `not.toContain("kilocode_change")`, not a marker |

### Flagged For Human Verification

- INFO: the whole-file `start`/`end` wrap on `register-spinner.ts` is precedented and justified, but `check-opencode-annotations.ts` skips on upstream-merge PRs (observed locally and the CI `Check kilocode_change annotations` job passes via the same skip path), so no job machine-validates the new markers on this PR. Recommend human sign-off on the wrap style.

### Delta 2 Non-Findings

- `packages/ui/src/i18n/it.ts` / `nl.ts`: verified **absent from upstream `v1.18.0`** (upstream ships 19 locales, no it/nl) — both are entirely Kilo-added files with the correct `// kilocode_change - new file` header at line 1. The delta translates leftover English strings only; marked lines untouched (it: 6→6, nl: 10→10, identical line numbers and content), and the new translations contain no Kilo branding, so correctly no new per-line markers.
- `packages/tui/test/kilocode/spinner-runtime.test.ts`: new file under a `kilocode` path — Kilo-owned, correctly marker-free.
- No dangling `opentui-spinner` imports remain at the new head; remaining references are the merge-tooling DELETE lists and tests, the marker comment itself, pre-existing `script/upgrade-opentui.ts` stale-lockfile handling, and a pre-existing harmless `bunfig.toml` `minimumReleaseAgeExcludes` entry.
- Whole-tree inventory: `811`→`813` files, `6067`→`6072` marker lines; per-file diff shows exactly the 3 rows in the table above. No accidental removals anywhere else; all delta-1 marker state (including the `transform.ts` blocks) untouched.

## Notable Non-Findings (Delta 1)

- `packages/sdk-next/package.json` timeout bump (10s→30s) addresses the v2 `unit (macos)` failure mode (sdk-next embedded-test 10s timeout documented in `TESTS_V2.md`); the macOS shard now passes in 3m56s. Behavior review belongs to the test reviewer; the marker posture via `PRESERVE_SCRIPTS` is correct.
- The new `test:script:ci` root script runs `bun test ./script` — locally **55 pass, 0 fail** across 10 files, matching `check-test-ci`'s report of `10 root script test file(s)`.
- `check-test-ci.ts` now enforces root script-test scheduling in addition to package scheduling and runs clean; its error message changed from "missing test:ci" to "missing CI scheduling", consistent with its widened scope.

## Exact Commands / Results

### Delta 1 (Previously Reported)

- `git diff --stat cbbbd7217f..af6d1ded6d` → 8 files, 34 insertions, 10 deletions (matches the assigned delta).
- `git diff --stat af6d1ded6d HEAD` → only the 14 v1/v2 report `.md` files; source tree identical to reviewed head.
- `bun test ./test/provider/transform.test.ts` (from `packages/opencode/`) → `385 pass`, `0 fail`, `692 expect() calls`.
- `bun test ./test/kilocode/provider/kimi-adaptive-effort.test.ts` → `3 pass`, `0 fail`.
- Differential harness (`oldF` vs `newF` over 12 shapes) → `populated mismatches: 0`; three undefined-field shapes: old `threw` / new `false|false|true`.
- Marker inventory at `af6d1ded6d` → `git grep -l -I kilocode_change` = 811 files, `git grep -I kilocode_change` = 6067 lines; per-file count diff vs `cbbbd7217f` (SHA prefix stripped) → `PER_FILE_COUNTS_IDENTICAL`.
- `bun run script/check-test-ci.ts` → `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`.
- `bun test ./script --timeout 30000` → `55 pass`, `0 fail`, 10 files.
- `bun run script/check-opencode-annotations.ts --base b135b4e10a...` → `Skipping shared upstream annotation check — upstream merge detected.` (same skip as v1/v2; the per-file audit above stands in for it).
- `bun run typecheck` (from `packages/opencode/`, `tsgo --noEmit`) → clean, no diagnostics.
- `git diff --check cbbbd7217f..af6d1ded6d` → no output, exit 0.

### Delta 2 (This Update)

- `git show 3003a302bc --stat` → 14 files, +236/-94 (matches the assigned delta).
- `git show v1.18.0:packages/tui/src/component/register-spinner.ts` → byte-identical to the `af6d1ded6d` version (6 lines, no markers); same for the `spinner.ts` import region.
- `git show v1.18.0:packages/ui/src/i18n/it.ts` → `fatal: path 'packages/ui/src/i18n/it.ts' exists on disk, but not in 'v1.18.0'` (it/nl are Kilo-added; upstream ships 19 locales without them).
- Per-file marker counts `af6d1ded6d` vs `3003a302bc` for all 14 changed files → unchanged everywhere except the 3 files in the table above.
- Whole-tree inventory → `git grep -l -I kilocode_change` 811→813 files, `git grep -I kilocode_change` 6067→6072 lines; per-file count diff (SHA prefix stripped) → exactly `register-spinner.ts:2`, `spinner.ts:2`, `transform-i18n.test.ts:2→3`.
- `git grep opentui-spinner 3003a302bc -- ':!bun.lock'` → only tooling DELETE lists/tests, the marker comment, `script/upgrade-opentui.ts`, and `bunfig.toml` (all intentional or pre-existing).
- `bun test ./script/upstream` (from root) → `54 pass`, `0 fail`, `139 expect() calls`, 9 files.
- `bun test test/kilocode/spinner-runtime.test.ts` (from `packages/tui/`) → `1 pass`, `0 fail`.
- `bun run typecheck` (from `packages/tui/`, `tsgo --noEmit`) → clean, no diagnostics.
- `bun run script/check-opencode-annotations.ts --base b135b4e10a` → `Skipping shared upstream annotation check — upstream merge detected.` (same skip as delta 1).
- `git diff --check af6d1ded6d..3003a302bc` → no output, exit 0.
- `git diff --stat 3003a302bc HEAD` → only the 14 v1/v2 report `.md` files; source tree identical to reviewed head.
- `gh pr checks 12901 -R Kilo-Org/kilocode` → all pass or skip on head `3003a302bc65a4ce0df7c544303c0898db5406e3`; zero non-passing.

## Limitations

- The "would have crashed at v2 head" claim for the new test is proven analytically (first `.some` element is `undefined`) plus via the standalone harness, not by re-running the v2 tree — the worktree was kept read-only for source.
- CI verification is the PR's own pipeline, not a local reproduction of linux/windows shards; local runs were macOS only.
- `Kilo Code Review` (AI review bot) was still pending at delta-1 report time; it is not a merge-gating CI job. It has since passed on both heads.
- Delta-1 scope was the 8-file delta plus F1; delta-2 scope was the 14-file delta through the marker lens only. Behavior of the new `SpinnerRenderable` (rendering correctness, timer lifecycle) belongs to other review lenses; verified here only via the new runtime test and `tsgo`. The v2 49-file audit and v1 baseline classification were not re-run.
- The new markers on `register-spinner.ts`/`spinner.ts` are not machine-validated on this PR: the annotation guard skips upstream-merge PRs both locally and in CI.

## Final CI State

At `af6d1ded6d` (delta-1 head): checked after the freshly queued run completed its test shards: **all green**. `unit (linux, 1/2)` pass 10m8s, `unit (linux, 2/2)` pass 9m9s, `unit (windows, 1/4-4/4)` all pass (~9m44s-10m56s), `unit (macos)` pass 3m56s, `HttpApi exerciser` pass 7m47s, plus typecheck/lint/annotation/visual-regression suites all pass; `CodeQL` and `[code]smith` skipping; only `Kilo Code Review` pending. The three v2 red shards (`linux 1/2`, `windows 1/4`, `macos`) are all resolved.

At `3003a302bc` (round-3 head): checked via `gh pr checks 12901 -R Kilo-Org/kilocode`, head OID verified `3003a302bc65a4ce0df7c544303c0898db5406e3`: **all green** — every check passes or skips (`CodeQL`, `[code]smith` skipping), zero non-passing. This includes `Check kilocode_change annotations` (pass 35s, merge-skip path), `Check forbidden strings` (pass 15s), `unit (linux, 1/2)` 11m53s, `unit (linux, 2/2)` 10m9s, `unit (windows, 1/4-4/4)` 8m34s-17m23s, `unit (macos)` 4m25s, `HttpApi exerciser` 10m20s, and `Kilo Code Review` now pass (7m38s).
