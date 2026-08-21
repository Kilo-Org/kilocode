# Kilo-specific test preservation review (v3)

## Scope and method

Round v3 reviews the full post-v2 range `cbbbd7217f..3003a302bc65a4ce0df7c544303c0898db5406e3`, which landed as two fix commits: `af6d1ded6d` ("fix: address second-round merge review findings", 8 files) and `3003a302bc` ("fix: address pull request review comments", 14 files). The review worktree sits at docs commit `6f676b6dbb` on top of the reviewed head; `git merge-base --is-ancestor 3003a302bc HEAD` holds and `git diff --name-only 3003a302bc..HEAD` lists only root `*_V2.md`/v1 review reports, so the working tree is test-equivalent to the reviewed head. Everything from here through "Limitations" covers the first fix commit (written when `af6d1ded6d` was the head, originally verified at docs commit `6d6c4eb730` before the report-branch rebase); the second fix commit is covered in the final section, "Delta review: second fix commit 3003a302bc".

Delta under review vs. v2 head `cbbbd7217f` (first fix commit): exactly the 8 named files (`test.yml`, root `package.json`, `transform.ts`, `kimi-adaptive-effort.test.ts`, `packages/sdk-next/package.json`, `check-test-ci.ts`, `transform-package-json.{ts,test.ts}`), confirmed via `git diff --name-status`. I read the full delta and the complete workflow file, ran every previously failing/newly extended suite, ran the exact new CI command locally, proved the extended guard's failure mode in a scratch git replica, re-ran the v2 test inventory at both heads, and pulled the live logs for CI run 31055346775.

## v2 finding status: all three FIXED, each with local + CI proof

### 1. P1 — isKimiFamily crash (3 pre-existing transform.test.ts failures) — FIXED

**Guard implementation** (`packages/opencode/src/provider/transform.ts:1314-1325`): both crash sites are covered — `const value = id?.toLowerCase() ?? ""` for the `[model.providerID, model.api.id].some(...)` branch (line 1317) and `const url = model.api.url?.toLowerCase() ?? ""` for the host branch (line 1322). The fixture root cause is confirmed at `test/provider/transform.test.ts:3130-3131`: the shared `target()` helper builds `{ id, api: {...} }` with **no `providerID` field at all**, so `model.providerID` is `undefined` — exactly what the optional-chain now absorbs.

**Local run at head:** `bun test ./test/provider/transform.test.ts` from `packages/opencode` → **385 pass / 0 fail / 692 expect() calls** (v2 head: 382 pass / 3 fail). The three crashed tests (`converts effort for @ai-sdk/anthropic`, `converts effort for @ai-sdk/google-vertex/anthropic`, `leaves legacy Anthropic effort options to budget fallback`) pass.

**New coverage** (`test/kilocode/provider/kimi-adaptive-effort.test.ts`, +7 lines): the `target()` input type was widened to `{ providerID?: string; id: string; url?: string }` and the new test "handles partial metadata from generic Anthropic providers" passes only `{ id: "claude-sonnet-4-6" }` — exercising **both** undefined `providerID` and undefined `api.url` through the real public entry point `ProviderTransform.reasoningVariants` → `anthropicEffort` → `isKimiFamily`. The assertion is exact-shape, not vacuous: `expect(variants?.high).toEqual({ thinking: { type: "adaptive" }, effort: "high" })` (no `display` key — the non-Kimi generic Anthropic branch, distinct from the Kimi branch asserted in the sibling tests). Without the guard the test throws `TypeError` before reaching the assertion, so it is genuinely crash-sensitive. Run: **3 pass / 0 fail** (file grew from 2 to 3 tests).

**CI proof:** the two legs that crashed at v2 head — `unit (linux, 1/2)` (job 92471585892) and `unit (windows, 1/4)` (job 92471585939) — both **pass** (10m8s, 9m53s); the linux 1/2 log contains zero `(fail)`/`error:` lines and its CLI shard reports "9 successful, 9 total".

### 2. P2 — guard blind spot (root script/ tests unscheduled) — FIXED

**Mechanism:** root `package.json` gains `test:script:ci`: `mkdir -p .artifacts/unit && bun test ./script --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml` (same JUnit/artifact convention as the package scripts, same 30s timeout as the heaviest packages). The workflow runs it via a new step "Run root tooling unit tests" (`.github/workflows/test.yml:149-151`), and both the junit-report action (`report_paths`, lines 182-184) and the artifact upload (lines 198-200) now include the root `.artifacts/unit/junit.xml` alongside `packages/*/.artifacts/unit/junit.xml`.

**Exact CI command run locally:** `bun run test:script:ci` from repo root → **55 pass / 0 fail / 139 expect() calls, "Ran 55 tests across 10 files"** — the 10 files matching `git ls-files script | grep -E '\.test\.tsx?$'` exactly (release-notes, opencode-changesets, keep-ours, preserve-versions, skip-files, **transform-i18n** (delta-added), **transform-package-json** (delta-modified), config, git, report). Root `.artifacts/unit/junit.xml` is written to the path the workflow now collects.

**Guard coverage:** `script/check-test-ci.ts` now enumerates `git ls-files packages script`, and lines 24-28 fail the run unless root `package.json` has `scripts["test:script:ci"]` containing `bun test ./script`. At head it prints `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`. Failure-mode proof in a scratch git replica (verbatim script copy, sandbox tmp dir, files staged): (a) script test present + no `test:script:ci` → **exit 1**, `Test suites missing CI scheduling:\npackage.json#test:script:ci`; (b) proper script added → exit 0; (c) `test:script:ci` present but with unrelated content (`"echo hi"`) → **exit 1**, same message — so the content check, not just key presence, is enforced. A future `transform-i18n`-class addition cannot regress silently: the file is auto-discovered by `bun test ./script`, and deleting/neutering the script trips the guard.

**Preserve-list coverage:** `script/upstream/transforms/transform-package-json.ts` `PRESERVE_SCRIPTS` for the root package.json now includes `"test:script:ci"`, and `transform-package-json.test.ts` extends the `fixScripts preserves Kilo-only root scripts from base` fixture + assertion accordingly. Run: **21 pass / 0 fail / 68 expects** — future upstream merges cannot strip the scheduling script.

**CI proof (linux 1/2 log):** guard step ran and passed at 23:10:40.124 (`check-test-ci: ok (25 package(s), 10 root script test file(s))`); the new step executed `bun run test:script:ci` at 23:10:40.132 and reported `55 pass` / `Ran 55 tests across 10 files`; the junit action summarizes "55 tests run, 55 passed, 0 skipped, 0 failed".

**Residual micro-gaps (observations, below finding threshold):** the content check is a substring match, so a *narrowed* discovery path such as `bun test ./script/upstream` would still contain `bun test ./script` and evade the guard; and the guard verifies the package.json script, not the workflow step — deleting the 3-line step would unschedule the suite without tripping the guard (unlike packages, where turbo auto-discovers any `test:ci`). v2's minor secondary note also stands (a test-bearing package with no `scripts` block is silently skipped; no such package exists today). Root script tests run only on the linux leg — same placement as the guard; the suites are platform-agnostic merge tooling, so this is acceptable.

### 3. macOS sdk-next embedded timeout (2/2 systematic at 10s) — FIXED

`packages/sdk-next/package.json` `test:ci` is now `mkdir -p .artifacts/unit && bun test --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml` — the 10s timeout raised to **30000**, byte-aligned with the existing core, llm, and codemode conventions (verified side-by-side in all four package.json files). It applies to the CI path directly: the non-CLI step `bun turbo test:ci ... --filter='!@kilocode/cli' --filter='!@kilocode/kilo-jetbrains'` schedules `@opencode-ai/sdk-next#test:ci` on all three OS legs (`bun turbo test:ci --dry` from `packages/sdk-next` confirms the package in scope with its `#test:ci` task).

**Local:** `bun test` in `packages/sdk-next` → **5 pass / 0 fail / 19 expects in 2.71s**; `bun run test:ci` (the 30s CI script) → 5 pass / 0 fail in 2.74s with the junit artifact written.

**CI proof:** `unit (macos)` — the leg that failed 2/2 at v2 head with the embedded test timing out at 10s — **passes in 3m56s** (job 92471585888). Its log shows the non-CLI step "Tasks: 20 successful, 20 total" with `@opencode-ai/sdk-next` in scope, the Darwin profile validation passing (3 tests), and the macOS CLI shard completing "9 successful, 9 total" — the shard that never even executed at v2 head because the job died at the non-CLI step.

## Test inventory re-run at the new head

`git diff --name-status --find-renames b135b4e...af6d1ded -- '*.test.ts' '*.test.tsx'` → **56 files: 16 A / 40 M / 0 D**, byte-identical to the same command at v2 head `cbbbd7217f` (no test file entered or left the merge diff in v3; the delta only modified two files already in the inventory). Note: v2 reported 54 (16 A / 38 M); re-running its exact command at `cbbbd7217f` today also yields 56 (16 A / 40 M), so v2's count was 2 short — immaterial, and every v2 per-file conclusion was re-verified today. Buckets and CI paths, all confirmed scheduled:

| Bucket | Files | CI path |
|---|---|---|
| `packages/opencode` | 24 | sharded `@kilocode/cli#test:ci` runner (all 7 legs green) |
| `packages/core` | 16 | turbo `test:ci` (non-CLI step) |
| `packages/codemode` | 7 | turbo `test:ci` |
| `packages/ui` | 2 | turbo `test:ci` (`bun test src` + junit, package.json:68) |
| `packages/session-ui` | 2 | turbo `test:ci` (restored script, v2-verified) |
| `packages/llm` | 2 | turbo `test:ci` |
| `script` | 3 | **root `test:script:ci` + new workflow step (v2 gap closed)** |

Every changed/new executable test file has a CI path, root script tests included.

## Workflow delta line-by-line

Only three hunks vs. v2 head, no reordering or condition regressions: (1) the inserted step at lines 149-151 carries a condition **identical to the guard step** (`matrix.settings.run && matrix.settings.packages && matrix.settings.os == 'linux'`) and sits after the guard (145-147) and before the non-CLI step (153-158) — the guard provably ran before the step it protects in the live log (23:10:40.124 → 23:10:40.132); (2) `report_paths` gains the root junit path; (3) the artifact upload `path` gains the same. On legs where the root file is absent (all but linux 1/2) nothing breaks: the macOS job's junit-report and upload steps succeeded with the root path missing (`if-no-files-found: ignore`, and the junit action's defaults tolerate absent paths), verified in the macOS log. Existing step conditions (non-CLI, Darwin validation, CLI shards, rollups `unit (linux)` / `test (linux)`) are untouched.

## New findings

None. All three v2 findings are fixed with real (non-vacuous) coverage and end-to-end CI proof.

## Notable non-findings

- The `-1 test-bearing package(s)` in scratch-replica case (b) is fixture arithmetic (0 package dirs − 1 exempt), not a guard bug; the real repo prints 25.
- The `Merge made by the 'ours' strategy.` line in the local root test output is fixture output of an upstream-merge script test performing a real merge; benign.
- Root `test` still prints `do not run tests from root` and exits 1 — `test:script:ci` is a separate script name, so the AGENTS.md root-test prohibition is intact.
- Skipped steps emit no lines in raw job logs; the absence of "Run root tooling unit tests" from the macOS log is expected, not evidence of non-scheduling (the step is linux-only by design).
- `.artifacts/` and `packages/sdk-next/.artifacts/` are untracked junit outputs of local runs — the same paths CI uploads; no source files were touched.
- `Kilo Code Review` (pending) and CodeQL / `[code]smith` (skipping) are external/conditional checks, not CI gates.

## Commands and results

- `git diff --name-status cbbbd7217f..af6d1ded6d`: exactly the 8 named files. `git merge-base --is-ancestor af6d1ded HEAD` + `git diff --name-only af6d1ded..HEAD`: worktree is the reviewed head plus docs-only report commits.
- From `packages/opencode`: `bun test ./test/provider/transform.test.ts` → **385 pass / 0 fail / 692 expects** (v2 head: 382/3); `bun test ./test/kilocode/provider/kimi-adaptive-effort.test.ts` → **3 pass / 0 fail** (new partial-metadata test included).
- From repo root: `bun run test:script:ci` (exact CI command) → **55 pass / 0 fail / 139 expects across exactly the 10 tracked script test files**; root `.artifacts/unit/junit.xml` written. `git ls-files script | grep -E '\.test\.tsx?$'` → 10 files, matching bun's executed-file count.
- `bun run script/check-test-ci.ts` → `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`. Scratch replica: missing `test:script:ci` → exit 1 naming `package.json#test:script:ci`; proper script → exit 0; content-less script (`echo hi`) → exit 1.
- `bun test ./script/upstream/transforms/transform-package-json.test.ts` → **21 pass / 0 fail / 68 expects** (preserve-list now covers `test:script:ci`).
- From `packages/sdk-next`: `bun test` → **5 pass / 0 fail / 2.71s**; `bun run test:ci` → 5/0 in 2.74s; `bun turbo test:ci --dry` lists `@opencode-ai/sdk-next#test:ci` in scope. `test:ci` timeout 30000, byte-aligned with core/llm/codemode.
- Inventory: `git diff --name-status --find-renames b135b4e...{af6d1ded,cbbbd7217f} -- '*.test.ts' '*.test.tsx'` → identical 56-file lists (16 A / 40 M / 0 D) at both heads.
- CI (run 31055346775, final state via `gh pr checks 12901`): **29 pass / 0 fail / 1 pending (`Kilo Code Review`, external) / 2 skipping (CodeQL, `[code]smith`)**. All 7 unit legs pass: linux 1/2 (10m8s), linux 2/2 (9m9s), macos (3m56s), windows 1/4-4/4 (9m44s-10m56s); HttpApi exerciser 7m47s pass; rollups `unit (linux)` and `test (linux)` pass. This is the round CI went green — verified.
- `gh api .../jobs/92471585892/logs` (linux 1/2): guard ok 23:10:40.124; `bun run test:script:ci` 23:10:40.132 → `55 pass`, `Ran 55 tests across 10 files`; non-CLI "20 successful"; CLI shard "9 successful"; junit "55 tests run, 55 passed"; zero `(fail)`/`error:` lines.
- `gh api .../jobs/92471585888/logs` (macos): non-CLI "20 successful, 20 total" with sdk-next in scope; Darwin profile 3 pass; CLI shard "9 successful, 9 total"; artifact uploaded.
- Final `git status --short`: only other reviewers' `*_V3.md` reports; `TESTS_V3.md` is my sole authored file. (The untracked `.artifacts/` junit dirs produced by my local runs were subsequently removed by another process in this shared worktree; they were test outputs, not source changes.)

## Limitations

Windows-specific assertions were inspected, not executed locally — relied on the four green windows CI legs. The full CLI `bun test` was not re-run end-to-end locally; coverage rests on the targeted suites above plus all seven CI shards passing. The scratch replica proves the guard's logic, while the workflow wiring is proven by the live CI run rather than by local simulation. The two residual guard micro-gaps (substring content match; workflow step not verifiable by the guard) are documented observations, not exploitable defects at this head.

## Delta review: second fix commit 3003a302bc (af6d1ded6d..3003a302bc)

Scope: 14 files, +236/-94 via `git diff --name-status af6d1ded6d..3003a302bc`; **zero deletions** (`--diff-filter=D` empty). Three test files touched — one added, two modified; none removed or renamed. Method: full delta read; every changed/added assertion traced to its source hunk; weakening scan over the whole delta (no `it.skip`/`test.skip`/`describe.skip`/`.only(` added, no timeout strings touched, no expects commented out); all three suites run locally plus both affected package suites; CI state pulled for the exact head (PR headRefOid confirmed `3003a302bc65a4ce0df7c544303c0898db5406e3`).

### Test-file changes — all justified, none weakening

- `packages/tui/test/kilocode/spinner-runtime.test.ts` — newly ADDED (+11; no prior content existed to lose). Imports `registerOpencodeSpinner` from the real source `../../src/component/register-spinner` (the new vendored `SpinnerRenderable extends Renderable` from `@opentui/core`), registers, and asserts the catalogue class's prototype is `instanceof Renderable` of Kilo's active runtime (0.4.3 in this install). The only `opentui-spinner` string left in `packages/tui/src` is the `kilocode_change` comment itself — the test exercises the new vendored code, not a stale copy of the removed dependency.
- `script/upstream/transforms/transform-i18n.test.ts` (+14): the existing test's call gained explicit `(…, false, true)` matching the new `markers = false` third parameter (transform-i18n.ts:151); its four original assertions are byte-identical — passing `true` keeps covering the marker path `transformI18nFile` still uses (transform-i18n.ts:226). Two ADDED tests pin the new marker-free default and the `translate()` non-locale path (`prompt/meta.txt` → `isI18nFile` false → no `kilocode_change`; upstream.ts:194). No assertion removed.
- `script/upstream/transforms/transform-package-json.test.ts` (+20): one hunk is pure reflow of a `fixScripts` call (same args); the renamed test "fixCatalog removes unsupported upstream entries" extends fixture + assertions exactly with the source change (`DELETE_UPSTREAM_CATALOG` gains `"opentui-spinner"`; `changes.length` 2→3 — strengthened, not weakened); one ADDED test covers the newly exported `transformDependencies`, and its expected change string byte-matches the source (`opentui-spinner: removed (incompatible OpenTUI runtime)`).
- The single skip in the full tui run is pre-existing (`test/cli/tui/diff-viewer-file-tree.test.tsx:30`, last touched by `fd60036e4a`; file untouched by this delta).

### Checked-in artifacts match the new transform code

- Root `package.json` catalog, `packages/tui/package.json`, `packages/opencode/package.json`: `opentui-spinner` removed from all three — exactly what `DELETE_UPSTREAM_CATALOG` / `DELETE_UPSTREAM_DEPENDENCIES` now prescribe.
- `bun.lock`: every `opentui-spinner` entry removed, including the nested `@opentui/core@0.3.4` / `@opentui/solid@0.3.4` closure that caused the runtime split.
- `packages/ui/src/i18n/it.ts`/`nl.ts`: pure translation completion (English fallbacks → Italian/Dutch); `kilocode_change` marker counts unchanged across the delta (it 6→6, nl 10→10), consistent with `transformI18nFile` still emitting markers. No ui test references these dicts (grep empty); ui suite green.

### Runs at the reviewed head (this worktree)

- `bun test test/kilocode/spinner-runtime.test.ts` from `packages/tui` → **1 pass / 0 fail / 2 expects**.
- Full tui suite `bun test` from `packages/tui` → **211 pass / 1 skip (pre-existing) / 0 fail / 510 expects + 8 snapshots; 212 tests across 49 files**.
- `bun test ./script/upstream/transforms/transform-i18n.test.ts ./script/upstream/transforms/transform-package-json.test.ts` from root → **25 pass / 0 fail / 78 expects** (3 i18n + 22 pkg-json).
- Full root script suite `bun test ./script --timeout 30000` from root → **58 pass / 0 fail / 145 expects across 10 files** (55 at af6d1ded6d + 3 new).
- `bun test src` from `packages/ui` → **121 pass / 0 fail / 194 expects across 15 files**.
- `bun run script/check-test-ci.ts` → `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`; `bun turbo test:ci --dry --filter='@opencode-ai/tui'` schedules `@opencode-ai/tui#test:ci` — the new spinner test rides the existing non-CLI CI step.
- Merge-level inventory re-run at 3003a302bc: **57 test files (17 A / 40 M / 0 D)** = the 56-file inventory above plus the added spinner test; still zero deletions.

### CI at head 3003a302bc (unit run 31094000345, via `gh pr checks 12901 -R Kilo-Org/kilocode`)

All checks pass; CodeQL and `[code]smith` skip (conditional/external, as before); `Kilo Code Review` now passes (was pending at af6d1ded6d). All 7 unit legs green: linux 1/2 (11m53s), linux 2/2 (10m9s), macos (4m25s), windows 1/4–4/4 (8m34s–17m23s); rollups `unit (linux)` / `test (linux)` pass. Linux 1/2 log (job 92597238501): guard `check-test-ci: ok (25, 10)`; root script suite `58 pass`, `Ran 58 tests across 10 files` (matches local exactly); non-CLI step `20 successful, 20 total` (tui in scope); CLI shard `9 successful, 9 total`; zero `(fail)` lines — the single `error:` substring match is the junit action's `fail_on_parse_error: false` config line.

### Findings (3003a302bc)

None. No Kilo-specific test was deleted, weakened, skipped, or orphaned; every expectation change is justified by its source change and confirmed green locally and in CI.

### Notable non-findings / observations (3003a302bc)

- Control experiment on the spinner test's discrimination power: this worktree still holds a stale flat-installed `opentui-spinner@0.0.7` in `packages/tui/node_modules` (no nested `node_modules`; its `@opentui/core` peer resolves to the top-level 0.4.3), and through it the OLD `registerSpinner()` path also yields `instanceof Renderable === true`. Under this particular stale install the new test alone would not distinguish old vs new registration. The durable guarantees are: (a) at a fresh install of the new lockfile `opentui-spinner` no longer exists, so any revert to `import { registerSpinner } from "opentui-spinner/solid"` fails at module resolution and the test errors; (b) under the old lockfile the nested `@opentui/core@0.3.4` (present in the old `bun.lock`, removed in the new one) is a distinct class identity, so `instanceof` fails there. Flagged for human verification; not a defect at this head.
- The delta stat listing describes the spinner test as "modified (+11)"; git name-status shows it as newly added (A) in this commit. Immaterial.
- `it.ts`/`nl.ts` translation completions are product content outside the test-preservation lens; verified only for marker-count stability and suite greenness.

### Limitations (3003a302bc)

Local `node_modules` is stale relative to the new `bun.lock` (`opentui-spinner` still on disk), so guarantee (a) above rests on the lockfile diff rather than a reinstall. Windows assertions inspected, not executed locally — relied on the four green windows legs. The tui package's `--only-failures` script mode was bypassed intentionally by invoking `bun test <file>` directly.
