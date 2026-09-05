# Kilo-specific test preservation review (v2)

## Scope and method

Re-verified PR #12901 at the new exact head `cbbbd7217f940b59b1b29964264536c567065327` (worktree docs commit `c5b1427314` on top contains only review reports). Delta under review: `25f4b58d93` + `cbbbd7217f` ("fix: address upstream merge review findings"), 49 files vs. v1 head `c69ce6caf638617169509f09e3f5d620eb702146`. I re-ran the v1 inventory (`git diff --name-status --find-renames b135b4e...cbbbd72 -- '*.test.ts' '*.test.tsx'`: **54 files, 16 added / 38 modified / 0 deleted**), compared restored scripts byte-for-byte against merge base, dry-ran Turbo scheduling, ran the new guard in the repo and in a scratch replica, executed every new/changed CLI suite the prompt named, and pulled the actual CI failure logs for run 31053081178 plus the prior run 31045946610.

## v1 finding status: P1 (CI silently omitted 28 test files) — FIXED, with one residual blind spot

1. **All five packages are scheduled.** `bun turbo test:ci --dry` now lists real commands for `@opencode-ai/client`, `@opencode-ai/httpapi-codegen`, `@opencode-ai/sdk-next`, `@opencode-ai/session-ui`, and `@opencode-ai/codemode` `#test:ci` tasks (no `<NONEXISTENT>` among them). The four restored scripts (`packages/client/package.json:12`, `httpapi-codegen:10`, `sdk-next:11`, `session-ui:25`) are **byte-identical to their merge-base JUnit conventions** (verified via `git show b135b4e:...`). Codemode's new script follows the same convention — `mkdir -p .artifacts/unit && bun test --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml` — and its 30s timeout matches the existing heaviest packages (core, llm), so it is consistent.
2. **The translation suite is gone, completely.** `script/translate-app.test.ts`, `script/translate-app.ts`, `script/translate-app.md`, and the root `translate:app` script were all deleted; `script/upstream/utils/config.ts:139-142` adds the three files to the upstream-merge skip list so future syncs cannot re-import them ("targets products and binaries Kilo does not ship"). No dangling references outside v1 review reports. Re-running the v1 inventory at the new head confirms **every changed/new executable test file under `packages/` now has a CI path** (turbo `test:ci` or the sharded `@kilocode/cli` runner).
3. **The guard works and is wired correctly.** `script/check-test-ci.ts` enumerates tracked `packages/**/*.test.{ts,tsx}` via `git ls-files`, exempts `packages/kilo-vscode`, and fails on any package with a `test` script but no `test:ci`. `bun run script/check-test-ci.ts` at head prints `check-test-ci: ok (25 test-bearing package(s))`. In a scratch replica (git repo + verbatim copy of the script, outside the worktree) it exited 1 with `Test-bearing packages missing test:ci:\npackages/fake/package.json` when the fixture lacked `test:ci`, and exited 0 once added. The workflow step "Verify package test scheduling" (`.github/workflows/test.yml:145-147`) runs `bun run script/check-test-ci.ts` on the `linux` shard with `packages:true`, default bash shell, after checkout/Bun setup and immediately before the non-CLI test step. It executed and passed in the real failing run (log timestamp 22:32:53).

**Residual gap (new finding, P2):** the guard scans only `git ls-files packages`. Root `script/` tests — 10 files, including `script/upstream/transforms/transform-i18n.test.ts` **added by this delta** and `skip-files.test.ts` / `transform-package-json.test.ts` modified by it — still have no CI path: root `test` exits 1 and no workflow invokes them. The delta fixed the v1-flagged root suite by deletion but simultaneously added a new unscheduled root test of the same class, and the guard would not catch a future one. Minor secondary gap: a package with test files but no `scripts` block at all is silently skipped by the guard's `continue` (no such package exists today).

## macOS unit failure analysis (run 31053081178, job 92464599061)

**Failing test:** `@opencode-ai/sdk-next` → `test/embedded.test.ts:23` → "embedded client uses the real router and handlers" — `timed out after 10000ms` (10249ms) in the "Run non-CLI unit tests" step. The job died at 1m53s; the macOS CLI shard and Darwin-profile validation never executed (0 `@kilocode/cli:test:ci` lines in the job log; later steps skip on failure).

**Classification: flaky-environmental (platform timing), systematically reproducible on macos-15 — not a code regression.**

- The identical test timed out identically in the previous run on `25f4b58d93` (job 92441488578, 11223ms at 20:52:10) — 2/2 macOS failures since `25f4b58` re-scheduled the suite. That is systematic, not random flake.
- The same suite at the same head **passes on linux** ("Tasks: 20 successful, 20 total" in job 92464599041's non-CLI step) and on windows (windows 1/4's CLI step ran, which requires its non-CLI step to have succeeded).
- Local run at head: `bun test --timeout 10000` in `packages/sdk-next` → **5 pass / 0 fail in 2.61s**. The `ModelUnavailableError: Model unavailable: test/embedded` visible in the CI log also appears in the passing local run — benign noise, not the hang cause.
- The test file is unchanged by the merge (`base...head` shows only `M packages/sdk-next/package.json`); the failure was *surfaced* by the fix commits restoring the schedule. The restored 10s timeout is simply insufficient on macos-15 CI (boot logs show ~3.2s for the first host boot alone). Direction: raise the sdk-next `test:ci` timeout (core/llm/codemode already use 30000) or give the first embedded test an explicit larger budget like its siblings have.

**The macOS failure masked a worse one — new finding (P1): the fix commits break 3 pre-existing tests on every OS.**

`unit (linux, 1/2)` (job 92464599041) and `unit (windows, 1/4)` (job 92464599098) both failed in `@kilocode/cli:test:ci` with the same three crashes:

- `ProviderTransform.reasoningVariants > converts effort for @ai-sdk/anthropic`
- `ProviderTransform.reasoningVariants > converts effort for @ai-sdk/google-vertex/anthropic`
- `ProviderTransform.reasoningVariants > leaves legacy Anthropic effort options to budget fallback`

All are `TypeError: undefined is not an object (evaluating 'id.toLowerCase')` at `packages/opencode/src/provider/transform.ts:1317` inside `isKimiFamily`, reached via the new `anthropicEffort` hook. `isKimiFamily` **did not exist at v1 head** (confirmed via `git show c69ce6c:...transform.ts`); `cbbbd7217f` added it and its call site. It runs `[model.providerID, model.api.id].some((id) => id.toLowerCase())` (and `model.api.url.toLowerCase()` two lines later) with no undefined guard, crashing on the partial model fixtures at `test/provider/transform.test.ts:3191,3207`. Locally reproduced at head: `bun test ./test/provider/transform.test.ts` from `packages/opencode` → **382 pass / 3 fail**, identical stack. Classification: **introduced by the fix commits**, deterministic, cross-platform. The new `kimi-adaptive-effort.test.ts` passes precisely because its fixtures always populate `providerID`/`id`/`url`; it never exercises the undefined case. Remaining shards (linux 2/2, windows 2/4-4/4) completed success — the file shards into index 1 on both OSes.

## New tests added by the delta — verified

`bun test ./test/kilocode/provider/kimi-adaptive-effort.test.ts ./test/kilocode/session/meta-prompt.test.ts ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts ./test/tool/code-mode-integration.test.ts` from `packages/opencode`: **79 pass / 0 fail / 200 expect() calls** in 3.8s. `bun test ./test/account/service.test.ts`: **14 pass / 34 expects**. Assertions are real, not vacuous: the Kimi tests assert full variant shapes for both the id-based and Moonshot-host-based detection branches; `meta-prompt.test.ts` asserts Muse Spark identifies as "Kilo powered by Meta Muse Spark", uses `https://kilo.ai/docs`, and contains no OpenCode identification/docs URLs. All live under `test/kilocode/**` and `test/tool/**`, inside the CLI runner's `test/**/*.test.{ts,tsx}` discovery (v1-established; none are in excluded paths).

## Notable non-findings

- The `packages/kilo-vscode` guard exemption is valid: `kilo-code#test:ci` remains `<NONEXISTENT>` by design and its tests run under `test-vscode.yml`.
- The guard step placement/conditions are correct and it genuinely ran (and passed) in the failing CI run before the test steps.
- The translate-app deletion left no dangling references; the upstream-merge skip list prevents re-import.
- The sdk-next `ModelUnavailableError` is present in passing runs; it is not a failure signal.
- Four restored `test:ci` scripts are byte-identical to merge base; codemode's matches the established JUnit/artifact convention.

## Commands and results

- `git diff --name-status --find-renames b135b4e...cbbbd72 -- '*.test.ts' '*.test.tsx'`: 16 A / 38 M / 0 D. Same command against v1 head `c69ce6c` for `script/`: only `A script/translate-app.test.ts` (v1's 28-file finding was complete for its head).
- `git show b135b4e:<pkg>/package.json` vs head for the four packages: `test:ci` scripts byte-identical. Codemode absent at merge base, new script consistent.
- `bun turbo test:ci --dry`: all five target packages scheduled with real commands; only `kilo-code` and other intentionally script-less packages show `<NONEXISTENT>`.
- `bun run script/check-test-ci.ts`: `check-test-ci: ok (25 test-bearing package(s))`. Scratch-replica failure mode: exit 1 naming `packages/fake/package.json`; pass mode: exit 0.
- `gh api repos/Kilo-Org/kilocode/actions/jobs/{92464599061,92464599041,92464599098,92441488578}/logs`: failures as analyzed above; linux non-CLI step "20 successful, 20 total"; linux CLI step "8 successful, 9 total"; macOS log contains zero CLI-shard lines; guard step passed 22:32:53.
- From `packages/opencode`: `bun test ./test/provider/transform.test.ts` → 382 pass / 3 fail (same 3 as CI); the five named new/changed files → 79 pass / 0 fail / 200 expects; `bun test ./test/account/service.test.ts` → 14 pass / 34 expects.
- From `packages/sdk-next`: `bun test --timeout 10000` → 5 pass / 0 fail in 2.61s, with the same benign `ModelUnavailableError` line as CI.
- `git log -S isKimiFamily -- packages/opencode/src/provider/transform.ts`: introduced at this head's fix commit; absent at v1 head.
- Final `git status --short`: only other reviewers' untracked `*_V2.md` reports; this file is my only authored artifact.

## Limitations

Windows-specific assertions were inspected, not executed locally. I did not verify whether sdk-next's embedded test was within its 10s budget on merge-base-era main CI runners, so I cannot fully separate "v1.18.0 core boots slower" from "macos-15 is slow" — the 2/2 failure pattern at this head stands regardless. The prior run's job list contained attempt artifacts (`test (linux)`, `unit (linux)`) I did not fully untangle; the macOS timeout in that run was verified directly from its log. The full CLI `bun test` was not re-run end-to-end; the changed-file suites and the CI-failing suite were run directly instead.
