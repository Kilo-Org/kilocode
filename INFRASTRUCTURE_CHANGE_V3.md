# Infrastructure Change Review V3: PR #12901

**Verdict: all three v2-targeted infrastructure findings fixed; CI fully green at the reviewed head, including the new CI step's shard.**

## Scope and provenance

Round v3 covers the full range `cbbbd7217f..3003a302bc` (19 files, +270/-104 across both fix commits). Reviewed PR head is `3003a302bc65a4ce0df7c544303c0898db5406e3` ("fix: address pull request review comments", direct child of `af6d1ded6d`). Worktree HEAD is docs commit `6f676b6dbb`; `git diff 3003a302bc HEAD --stat` shows only the 14 root review reports, so all commands ran against byte-identical reviewed-head content. The round was reviewed in two passes:

- **Pass 1** (sections "v2 finding status" through "Final CI state (run 31055346775)" below): commit `af6d1ded6d0c42f31b2cea2b84e478f6ac10445a` ("fix: address second-round merge review findings", direct child of v2 head `cbbbd7217f`). Delta: 8 files, +34/-10 — `.github/workflows/test.yml`, root `package.json`, `packages/sdk-next/package.json`, `script/check-test-ci.ts`, `script/upstream/transforms/transform-package-json.{ts,test.ts}`, plus the out-of-lens `transform.ts` / `kimi-adaptive-effort.test.ts` product-code fix. Method: full line-by-line delta audit, in-repo runs of every new/changed command, a four-case synthetic-git fixture for the guard, a Turbo scheduling dry-run, and live CI log inspection for run 31055346775.
- **Pass 2** (section "Pass 2: af6d1ded6d..3003a302bc" below): commit `3003a302bc`. Delta: 14 files, +236/-94. Method: full delta audit, repo-wide reference greps for the removed dependency, lockfile coherence analysis, in-repo test runs of the touched suites, and live CI status inspection at the reviewed head.

## v2 finding status

### 1. P2 residual blind spot: root `script/` tests had no CI path — FIXED

- **Scheduling**: new root script `test:script:ci` (`package.json:20`): `mkdir -p .artifacts/unit && bun test ./script --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml` — same JUnit convention as the package suites. New workflow step "Run root tooling unit tests" (`test.yml:149-151`) runs `bun run test:script:ci`.
- **Every current root script test executes**: `git ls-files script` yields exactly 10 `*.test.ts` files; running the workflow's command locally produced `55 pass, 0 fail` across **10 files** — discovery is complete, including nested `script/upstream/transforms/` and `script/upstream/utils/` files. The JUnit report lands at root `.artifacts/unit/junit.xml` (verified on disk).
- **Guard covers the blind spot in both directions**: `script/check-test-ci.ts` now enumerates `git ls-files packages script`, anchors the package-dir filter to `^packages/` (necessary correctness fix — without it a `script/upstream/foo.test.ts` would manufacture a bogus `script/upstream` package dir), and fails unless root `package.json` has `test:script:ci` containing `bun test ./script`. In-repo: `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`. Fixture results (scratch git repo outside the worktree): (A) script test + no `test:script:ci` → exit 1 naming `package.json#test:script:ci`; (B) correct script → exit 0; (C) script present but repointed (`bun test ./elsewhere`) → exit 1, so content drift is caught; (D) no script tests → check skipped, exit 0.
- **Workflow wiring is correct**: step placed inside the existing kilocode_change block after the guard and before "Run non-CLI unit tests"; same condition as the guard (`matrix.settings.run && matrix.settings.packages && matrix.settings.os == 'linux'`); the matrix generator (`test.yml:67`) has exactly one `os:linux,packages:true` entry, so it runs exactly once per run. Job-level `defaults.run.shell: bash`; default cwd is repo root so the root script resolves. The `general` paths-filter includes `script/**`, so a PR touching only script tests still triggers this step. Both report steps ("Publish unit reports", "Upload unit artifacts") gained root `.artifacts/unit/junit.xml` as a second glob line; `fail_on_failure: false` / `if-no-files-found: ignore` cover shards where the root file is absent (macOS/Windows).
- **Direct CI evidence (linux 1/2, job 92471585892)**: guard printed the new format `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))` at 23:10:40Z; "Run root tooling unit tests" ran `bun run test:script:ci` → `55 pass ... across 10 files`; the publish step's JUnit summary records `55 tests run, 55 passed` — root artifact glob works in CI.
- **Recurrence prevention**: `PRESERVE_SCRIPTS["package.json"]` in `transform-package-json.ts:294` now lists `test:script:ci`, and the updated `transform-package-json.test.ts` asserts its preservation — `21 pass, 0 fail, 68 expect() calls`. Future upstream merges cannot drop the entry.

### 2. macOS sdk-next embedded-test timeout (10s, 2/2 systematic on macos-15) — FIXED

- `packages/sdk-next/package.json` `test:ci` timeout raised 10000 → **30000**; local `test` script (5000) untouched, so the change applies exactly to the CI path.
- Convention check: llm/codemode/core/tui/http-recorder/effect-drizzle-sqlite all use `--timeout 30000` (the CLI's custom runner defaults to 60000); client/httpapi-codegen/session-ui remain lower. 30000 sits squarely in the established band and is 3x the value that failed twice.
- Turbo schedules the new command verbatim: `@opencode-ai/sdk-next#test:ci → mkdir -p .artifacts/unit && bun test --timeout 30000 --reporter=junit ...`.
- Local suite health: `bun test` in `packages/sdk-next` → `5 pass, 0 fail, 19 expect() calls` in 3.33s.
- **Direct CI evidence**: run 31055346775, `unit (macos)` job 92471585888 **passed in 3m56s** (the v2 failure killed this job at 1m53s). Log shows non-CLI step `Tasks: 20 successful, 20 total` with `0 fail`, CLI shard `9 successful, 9 total`, JUnit summary `3527 tests run, 3453 passed, 74 skipped, 0 failed`.

### 3. Root `package.json` +1 line — VERIFIED, no interference

The new script is `test:script:ci` (finding 1). It is a new unique key placed adjacent to `test`; root `test` still reads `echo 'do not run tests from root' && exit 1` (verified at `af6d1ded6d:package.json:19`), and no other script or turbo task references the new name. Being Kilo-specific, it is correctly added to `PRESERVE_SCRIPTS` (finding 1) rather than `DELETE_UPSTREAM_SCRIPTS`.

## New findings

None blocking. Three minor residuals, all acceptable to ship:

1. **P3**: the guard's script-content check is a substring test (`includes("bun test ./script")`) — it catches deletion/repointing (fixture case C) but would not catch narrowing to a subdirectory (e.g. `bun test ./script/upstream`) or dropping the JUnit reporter. Sufficient for the regression it guards.
2. **P3**: the guard watches only `packages` and `script`; a future test file at another root-level path (e.g. `perf/foo.test.ts`) would still be unscheduled and uncaught. Today zero such files exist — all 1369 tracked `*.test.{ts,tsx}` live under `packages/` or `script/`.
3. **P3 cosmetic**: the ok-message count `dirs.size - exempt.size` can print negative (`-1 test-bearing package(s)`) in a degenerate repo with no packages dir; unreachable in this repo (prints 25). Also, root `.artifacts/` is not in `.gitignore` — the same pre-existing cosmetic gap v2 noted for packages, now extended to root by the new script.

## Notable non-findings

- Workflow allowlist unaffected: no workflow files added/removed; `check-workflows: ok (29 workflows).` No `script/check-workflows.ts` update needed.
- Workflow diff contains no step reordering, condition changes, or deletions — 3 hunks: +4 lines (new step), two ±2 scalar-to-list glob expansions.
- Full `--dry=text` regression: all five v1-restored suites plus sdk-next still schedule real `#test:ci` commands; remaining `<NONEXISTENT>` entries are dependency tasks and intentionally test-less packages (kilo-code by design), matching v2's established pattern.
- Cross-lens confirmation (owned by the TESTS reviewer): the delta's `id?.toLowerCase() ?? ""` guards in `isKimiFamily` fix the v2 P1 — `bun test ./test/provider/transform.test.ts` now passes **385/0** (was 382 pass / 3 fail), and `kimi-adaptive-effort.test.ts` gained a partial-metadata case.
- The macOS job's published JUnit total (3527) exceeds v2's 1683 because the CLI shard also completed this time; nothing was lost between runs.

## Commands and results

- `git diff cbbbd7217f af6d1ded6d --stat`: 8 files, +34/-10. `git diff af6d1ded6d HEAD --stat`: 14 root reports only (worktree == reviewed head for source).
- `bun run test:script:ci` (workflow's exact command): `55 pass, 0 fail, 139 expect() calls` across 10 files; wrote root `.artifacts/unit/junit.xml` (cleaned up afterwards; tree left pristine).
- `bun run script/check-test-ci.ts`: `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`.
- Guard fixture (scratch git repo, verbatim script copy): case A exit 1 `package.json#test:script:ci`; case B exit 0; case C exit 1; case D exit 0.
- `bun test ./transforms/transform-package-json.test.ts` from `script/upstream`: `21 pass, 0 fail, 68 expect() calls`.
- `bun turbo test:ci --dry=text`: sdk-next scheduled with `--timeout 30000`; all restored suites real.
- `bun run script/check-workflows.ts`: `check-workflows: ok (29 workflows).`
- `bun test` in `packages/sdk-next`: `5 pass, 0 fail` in 3.33s.
- `bun test ./test/provider/transform.test.ts` from `packages/opencode`: `385 pass, 0 fail`.
- `gh pr checks 12901` + `gh api .../jobs/{92471585888,92471585892}/logs`: macOS pass evidence and linux 1/2 new-step execution evidence as quoted above.

## Limitations

- Fixture verification ran in the session scratchpad, not the worktree; the guard's in-repo pass was verified separately.
- I did not re-run the full non-CLI turbo graph locally; the scheduling dry-run plus the real macOS/linux CI executions stand in for it.
- Windows-specific behavior of the new workflow lines was verified by shard outcome (all four windows shards pass), not by inspecting windows logs line-by-line; the new step is linux-only by condition, so windows exposure is limited to the two artifact-glob lines, which are glob-tolerant.

## Final CI state (run 31055346775, final check 23:22Z; CI queued ~23:08Z)

- **All unit shards pass**: linux 1/2 (10m8s, ran the new root-tooling step — evidence above), linux 2/2 (9m9s), macos (3m56s — sdk-next timeout fix confirmed in the environment that failed 2/2), windows 1/4-4/4 (9m44s-10m56s). `HttpApi exerciser` pass (7m47s).
- All other checks pass (typecheck, annotations, kilocode_change, markdown padding, source-links, jetbrains suite, visual regression, `unit tests` job). No pending or failing checks remained at 23:22Z except the always-pending external `Kilo Code Review` app check and skipped CodeQL/codesmith, both normal.

## Pass 2: af6d1ded6d..3003a302bc — dependency removal + merge-automation hardening

Delta: 14 files, +236/-94. Infrastructure-relevant files: `bun.lock`, root `package.json`, `packages/opencode/package.json`, `packages/tui/package.json`, and the Kilo merge automation `script/upstream/transforms/transform-i18n.{ts,test.ts}`, `script/upstream/transforms/transform-package-json.{ts,test.ts}`, `script/upstream/utils/upstream.ts`. Out-of-lens product code (noted only where it justifies the dependency removal): `packages/tui/src/component/register-spinner.ts` (+139, vendored spinner), `packages/tui/src/ui/spinner.ts`, `packages/tui/test/kilocode/spinner-runtime.test.ts` (new), `packages/ui/src/i18n/{it,nl}.ts` (pure translations).

### Findings

Both minor; neither blocks merge. Flagged for human verification per protocol.

1. **P3 — stale `opentui-spinner` entry in `bunfig.toml` (human check requested)**. `bunfig.toml:5` still lists `"opentui-spinner"` in `minimumReleaseAgeExcludes` even though the dependency is fully removed by this delta. Harmless (a release-age exclusion for a package that no longer resolves is a no-op), but it is stale package-manager config referencing a removed dependency. The delta did not touch `bunfig.toml`. Recommend a human confirm and clean it up in a follow-up.
2. **P3 — now-dead cleanup path in `script/upgrade-opentui.ts` (human check requested)**. Lines 140-174 strip stale `opentui-spinner/@opentui/*` peer entries from `bun.lock` during OpenTUI upgrades. After this delta those entries can never reappear (the dependency is gone and the merge automation now deletes it on sight), making the path dead-but-harmless defensive code. Human decision whether to keep it as legacy cleanup or remove it.

### Notable non-findings

- **Dependency removal is complete and verified.** `opentui-spinner` was removed from: root catalog (`"opentui-spinner": "0.0.7"`), `packages/opencode/package.json` deps (`catalog:`), `packages/tui/package.json` deps (`catalog:`), and every `bun.lock` entry — the catalog line, both workspace spec lines, the `opentui-spinner@0.0.7` package entry, the nested `opentui-spinner/@opentui/core@0.3.4` and `opentui-spinner/@opentui/solid@0.3.4` peer trees (including all 8 platform-specific `@opentui/core-*` binaries, `bun-ffi-structs`, nested `marked`/`@babel/core`/`semver`), and the orphaned `yoga-layout@3.2.1`. Repo-wide grep over the current tree finds **zero imports/requires** of the package — remaining mentions are only comments, test fixtures, the merge-automation deletion lists, and the two P3 items above. `bun.lock` itself contains no `opentui-spinner` string.
- **`packages/opencode` never imported the package directly.** Verified via `git grep` at `af6d1ded6d` and at HEAD: opencode imports `registerOpencodeSpinner` from `@opencode-ai/tui/component/register-spinner`; its own `opentui-spinner` dep entry was upstream-inherited dead weight. Removal from `packages/opencode/package.json` is safe.
- **Removal is intentional vendoring, not accidental breakage.** `register-spinner.ts` now vendors a `SpinnerRenderable` built against Kilo's active OpenTUI runtime (catalog `@opentui/core` + `extend()` from `@opentui/solid/components`), replacing `opentui-spinner/solid`'s nested 0.3.4 runtime; `spinner.ts` defines the `ColorGenerator` type locally. Both shared files are wrapped in `kilocode_change start/end` markers, and CI's "Check kilocode_change annotations" passes at this head. Side benefit: the nested OpenTUI 0.3.4 runtime and its 8 platform binaries leave the install graph.
- **Lockfile is internally coherent.** The dedupe reshuffle downgraded top-level `cli-spinners` 3.4.0 → 2.9.2: 3.4.0 was required only by opentui-spinner's `^3.3.0`; the sole remaining consumer is `ora@8.2.0` (`^2.9.2`), satisfied by 2.9.2 (the former `ora/cli-spinners` nested entry was removed accordingly). No `yoga-layout` remnants. Green CI installs across linux/macos/windows shards at this head empirically confirm resolution (CI uses plain `bun install`; no `--frozen-lockfile` step exists in `.github/`).
- **Merge automation now matches the manual edits exactly (recurrence prevention).** `transform-package-json.ts`: `DELETE_UPSTREAM_CATALOG["package.json"]` gains `"opentui-spinner"`, and a new `DELETE_UPSTREAM_DEPENDENCIES` set strips it from any package's dependency block in future upstream merges; `transformDependencies` is now exported for tests. Tests assert both behaviors (catalog entry removed; dep entry removed with change message `opentui-spinner: removed (incompatible OpenTUI runtime)`). Future merges cannot silently reintroduce the dependency.
- **i18n marker-injection fix is correct and scoped to Kilo-owned tooling.** `transformI18nContent` gained a `markers = false` parameter; marker injection is now opt-in. `transformI18nFile` passes `true` (locale-file path unchanged — locale files still get `// kilocode_change`), while `translate()` in `upstream.ts` passes `isI18nFile(file)` (globs `packages/*/src/i18n/*.ts`), so generic merge translation (`fix-kilocode-markers.ts`, `reset.ts`) no longer injects source markers into non-locale content such as prompt `.txt` files. New regression tests cover both directions, including a `translate()` round-trip on a prompt path. All touched files are Kilo-only merge tooling — no upstream conflict surface.
- **`.github/` untouched.** 0 files under `.github/` in this delta; `check-workflows: ok (29 workflows)` — no allowlist update needed, no CI behavior change.
- **`it.ts`/`nl.ts` diffs are pure translations** (20 strings each: `sessionReviewV2`, `lineComment.cancel`, `sessionTurn.diffs.changed` — English fallback replaced with Italian/Dutch). No marker or structural changes; not infrastructure.
- **Root catalog sort order is pre-existing noise, not a regression.** 18 out-of-order pairs at `af6d1ded6d`, 17 after (the removal deleted a misplaced entry and reduced disorder). Bun does not require sorted catalogs; no CI check enforces it.
- **CI at reviewed head `3003a302bc` is fully green**: `unit` linux 1/2 (11m53s) + 2/2 (10m9s), macos (4m25s), windows 1/4-4/4 (8m34s-17m23s), `HttpApi exerciser` (10m20s), `typecheck`/`typecheck-js`/`typecheck-jetbrains`, `Check kilocode_change annotations`, `source-links-freshness`, `Check forbidden strings`, markdown padding, visual regression, jetbrains, `unit tests`. Only CodeQL and codesmith are `skipping` (normal), and the external `Kilo Code Review` app check passed (7m38s).

### Commands and results (pass 2)

- `git diff af6d1ded6d..3003a302bc --stat`: 14 files, +236/-94. `git diff 3003a302bc HEAD --stat`: 14 root review reports only (worktree == reviewed head for source). `git diff af6d1ded6d..3003a302bc --name-only -- .github/`: empty (0 files).
- Repo-wide `grep -rn "opentui-spinner"` (excluding `node_modules`/`.git`): only `bunfig.toml:5`, `script/upgrade-opentui.ts` cleanup strings, transform deletion lists + test fixtures, and the `register-spinner.ts:1` kilocode_change comment. No import/require anywhere; zero hits in `bun.lock`.
- `git grep -n "opentui-spinner" af6d1ded6d -- packages/opencode/src`: no hits — opencode never imported it directly (only `registerOpencodeSpinner` from `@opencode-ai/tui`, unchanged).
- `bun test ./transforms/transform-i18n.test.ts ./transforms/transform-package-json.test.ts` from `script/upstream`: **25 pass, 0 fail, 78 expect() calls**.
- `bun test ./test/kilocode/spinner-runtime.test.ts` from `packages/tui`: **1 pass, 0 fail** — registered spinner is an active-runtime `Renderable`.
- `bun run test:script:ci` from root (workflow's exact command): **58 pass, 0 fail, 145 expect() calls across 10 files** — exactly +3 tests vs the 55 at `af6d1ded6d`, matching the 3 new transform tests. `.artifacts/` removed afterwards; tree left pristine.
- `bun run script/check-workflows.ts`: `check-workflows: ok (29 workflows).`
- `bun.lock` coherence greps: single `cli-spinners@2.9.2` entry consumed by `ora@8.2.0` (`^2.9.2`); no `yoga-layout` remnants; active `@opentui/core`/`@opentui/solid` resolve from the catalog.
- JSON parse of all three touched `package.json` files: valid; `opentui-spinner` absent from root catalog and both dependency blocks. Catalog sort check: 17 out-of-order pairs now vs 18 at `af6d1ded6d` (pre-existing noise).
- `gh pr checks 12901 -R Kilo-Org/kilocode`: all checks pass at head `3003a302bc` as enumerated above; CodeQL/codesmith `skipping` (normal).

### Limitations (pass 2)

- I did not run `bun install --frozen-lockfile` locally — this review worktree is restricted to one editable file and I avoided mutating `node_modules`; additionally no CI job uses `--frozen-lockfile`, so there is no such enforcement to reproduce. Lockfile coherence is argued from the diff-level analysis (no dangling references; sole cli-spinners consumer satisfied) plus green CI installs on three OSes. A human may run a frozen install locally if extra assurance is wanted.
- I did not diff the vendored `SpinnerRenderable` line-by-line against the published `opentui-spinner@0.0.7` source (product-code/behavior lens); the vendoring is marker-annotated, typechecks in CI, and the new runtime test passes.
- The two P3 findings (`bunfig.toml` stale exclusion, `upgrade-opentui.ts` dead cleanup path) predate/exist outside the delta's touched files; they are flagged for human decision rather than asserted as defects.

## Artifact hygiene

Only `INFRASTRUCTURE_CHANGE_V3.md` authored. Local `.artifacts/` created by the scheduling probe was removed; `git status` shows no source modifications — only other reviewers' untracked V3 reports.
