fixed, with one delta-caused product-code CI failure outside this scope

# Infrastructure Change Review V2: PR #12901

## Scope and provenance

Reviewed exact PR head `cbbbd7217f940b59b1b29964264536c567065327` on `johnnyeric/kilo-opencode-v1.18.0` (v1 reviewed head `c69ce6caf638617169509f09e3f5d620eb702146` is superseded and not an ancestor). Worktree HEAD was `c5b1427314` ("docs: add upstream merge review reports"); `git diff cbbbd7217f c5b1427314 --stat` shows only the seven root review reports, so the checked-out source tree is byte-identical to the reviewed head and all commands below ran against reviewed-head content.

The v1-to-v2 delta is 49 files (`+282/-756`) from commits `25f4b58d93` and `cbbbd7217f`. Method: re-verified each v1 infrastructure finding statically and dynamically at the new head, audited every infrastructure-relevant file in the delta (`.github/workflows/test.yml`, `script/check-test-ci.ts`, `script/upstream/transforms/*`, `script/upstream/utils/config.ts`, root and package manifests, `.changeset/`), and pulled the live CI logs for run 31053081178 to classify the failing shards.

## v1 finding status

### 1. P2: CI silently skipped five package test suites — FIXED

- All five `test:ci` scripts exist and match Kilo's JUnit convention (`mkdir -p .artifacts/unit && bun test ... --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml`): `packages/client/package.json:15`, `packages/httpapi-codegen/package.json:11`, `packages/sdk-next/package.json:12`, `packages/session-ui/package.json:26`, `packages/codemode/package.json:15`.
- `bun turbo test:ci --dry=text` now schedules real tasks for all five (`@opencode-ai/client#test:ci`, `@opencode-ai/codemode#test:ci`, `@opencode-ai/httpapi-codegen#test:ci`, `@opencode-ai/sdk-next#test:ci`, `@opencode-ai/session-ui#test:ci`); no `<NONEXISTENT>` entries.
- The new guard `script/check-test-ci.ts` (marked `// kilocode_change - new file`) is invoked by `.github/workflows/test.yml:147` ("Verify package test scheduling") inside the existing kilocode_change block, conditioned `matrix.settings.run && matrix.settings.packages && matrix.settings.os == 'linux'` — exactly one invocation per run, on the same events as the non-CLI test step it protects (push to main, PRs with general changes, workflow_dispatch; the paths-filter can still skip all unit tests on docs/changeset-only PRs, by design). Platform restriction is sound because the guard only inspects `package.json` contents.
- Guard verified in both directions: passes in the repo (`check-test-ci: ok (25 test-bearing package(s))`), and fails with exit 1 (`error: Test-bearing packages missing test:ci:\npackages/foo/package.json`) when run against a synthetic git fixture containing a test-bearing package without `test:ci`. Live CI evidence: the step passed on the linux shard of run 31053081178 (`check-test-ci: ok (25 test-bearing package(s))`).
- Recurrence prevention: `PRESERVE_SCRIPTS` in `script/upstream/transforms/transform-package-json.ts:284-309` now covers all five packages plus the previously preserved six, and `transform-package-json.test.ts` asserts preservation for each.
- Report chain is complete: `turbo.json:22-25` declares `test:ci` outputs `.artifacts/unit/junit.xml`, and the "Publish unit reports" step globs `packages/*/.artifacts/unit/junit.xml`, covering all five restored suites. The macOS shard's published JUnit summary for run 31053081178 (`1683 tests run, 1642 passed, 40 skipped, 1 failed`) includes sdk-next results — direct proof the restored suites now execute in CI.

### 2. P2: inherited `translate:app` automation — FIXED

- Root `package.json` no longer contains `translate:app`; `script/translate-app.ts`, `script/translate-app.test.ts`, and `script/translate-app.md` are deleted (756 of the delta's deletions).
- `git grep -n 'translate:app\|translate-app' cbbbd7217f -- . ':!script/upstream'` returns nothing: no dangling references in AGENTS.md, CONTRIBUTING.md, kilo-docs, workflows, or turbo config. Remaining hits are only the merge tooling itself and the untracked v1 review reports.
- Recurrence prevention is two-layered and test-covered: `defaultConfig.skipFiles` in `script/upstream/utils/config.ts:140-143` lists all three paths (asserted by new cases in `skip-files.test.ts`), so future merges skip the files; and `DELETE_UPSTREAM_SCRIPTS["package.json"]` in `transform-package-json.ts:323` now includes `translate:app` (asserted by the updated "removes upstream-only dead scripts" test), so the root script entry cannot be resurrected by a future transform run even though upstream still defines it.

### 3. P3: `extension:isolated` / `extension:isolated:clean` root scripts — FIXED (verified statically)

- Both scripts are present in root `package.json:21-22` with the exact baseline commands, are listed in root `PRESERVE_SCRIPTS` (`transform-package-json.ts:287-288`), and are asserted by the updated "preserves Kilo-only root scripts" transform test.
- Launch smoke deliberately not run: `packages/kilo-vscode/script/launch.ts` has no `--help` handler, so invoking the script would build and launch a VS Code instance. Script resolution is trivially guaranteed by the manifest entries; preservation through future merges is covered by the transform test.

### 4. P3: missing changeset — FIXED

- `.changeset/opencode-v1-18-0.md` exists with frontmatter `"@kilocode/cli": patch` and `"kilo-code": patch` — identical package targeting and bump level to the previous upstream-sync changeset `.changeset/opencode-v1-17-9-to-v1-17-13.md`. The description ("Adopt OpenCode v1.18.0 improvements, including code mode, expanded model reasoning controls, MCP reliability updates, and TUI enhancements.") is user-facing and concise per `.changeset/README.md`.

## New infrastructure changes in the delta (audited, no regressions found)

- `script/check-test-ci.ts` + the new workflow step (covered under finding 1). The guard enumerates test-bearing packages via `git ls-files packages`, exempts `packages/kilo-vscode` (which CI drives through `test:unit`), and counts 25 packages.
- `script/upstream/transforms/transform-i18n.ts:203-204` now appends `// kilocode_change` to each line it brands; `shouldPreserveLine` (line 158-164) skips already-marked lines, making the transform idempotent. The 20 touched `packages/ui/src/i18n/*.ts` files each gained exactly that marker on their Kilo-branded line, keeping the working tree consistent with future transform output. New `transform-i18n.test.ts` passes.
- `takeTheirsAndTransform` (`config.ts:181-182`) gains `packages/opencode/src/session/prompt/meta.txt`. Verified the mechanism end-to-end: applying `applyBrandingTransforms` to pristine upstream v1.18.0's `meta.txt` (`git show 32696c425f:...meta.txt`) produces the committed file byte-for-byte (`replacements: 6`, `matches committed: true`), so future merges will auto-resolve this prompt with correct Kilo branding.
- Workflow allowlist unaffected: no workflow files added/removed; `check-workflows: ok (29 workflows).`

## New findings

None infrastructure-blocking. One out-of-scope observation for coordination: on run 31053081178 three unit shards failed. `unit (linux, 1/2)` and `unit (windows, 1/4)` fail three `ProviderTransform.reasoningVariants` tests in the shared upstream test file `packages/opencode/test/provider/transform.test.ts`, consistent with the delta's new `isKimiFamily` branch in `anthropicEffort` (`packages/opencode/src/provider/transform.ts`, kilocode_change-marked) — a delta-caused product-code/test-compat issue for the relevant reviewer, not infrastructure. `unit (macos)` fails `packages/sdk-next` `test/embedded.test.ts > embedded client uses the real router and handlers` by 10s timeout on the first-ever CI execution of this restored suite; it does not reproduce locally on macOS (`5 pass, 0 fail` in 2.76s with the same 10000ms timeout), so classify as probable runner-timing flake pending a rerun — if it repeats, sdk-next's embedded test needs a CI-realistic timeout, which would be a follow-up to finding 1's fix rather than a flaw in it.

## Notable non-findings

- The v1 supply-chain follow-up (double Node 24 setup, mutable `actions/setup-node@v6` at `test.yml`) is unchanged by this delta and remains a maintenance note, not a blocker.
- `bun install --frozen-lockfile --ignore-scripts` passes at the new head (`Checked 2056 installs across 2317 packages (no changes)`); the manifest changes are script-only, and `git status` stayed clean afterwards.
- Minor pre-existing cosmetic gap, not delta-introduced: `.gitignore` covers `.artifacts/` only for `packages/app` and `packages/opencode`, so local `test:ci` runs in the restored packages leave untracked `.artifacts/` directories — same as the six packages that already had `test:ci`.

## Commands and results

- `git diff c69ce6ca cbbbd7217f --stat`: 49 files, +282/-756; `git diff cbbbd7217f c5b1427314 --stat`: docs-only (7 root reports), confirming worktree source == reviewed head.
- `bun run script/check-workflows.ts`: `check-workflows: ok (29 workflows).`
- `bun run script/check-test-ci.ts`: `check-test-ci: ok (25 test-bearing package(s))`.
- Guard failure-mode fixture (temp git repo, package with `test` but no `test:ci`): exit 1, `error: Test-bearing packages missing test:ci:\npackages/foo/package.json`.
- `bun test ./transforms/transform-package-json.test.ts ./transforms/skip-files.test.ts ./transforms/transform-i18n.test.ts` from `script/upstream`: `30 pass, 0 fail, 86 expect() calls` (up from 21 in v1 for the first file alone).
- `bun turbo test:ci --dry=text`: all five previously `<NONEXISTENT>` tasks now listed as scheduled `#test:ci` tasks with correct directories.
- `bun install --frozen-lockfile --ignore-scripts`: pass, no changes.
- Branding round-trip: upstream v1.18.0 `meta.txt` + `applyBrandingTransforms` == committed `meta.txt` (6 replacements).
- `git grep 'translate:app\|translate-app' cbbbd7217f -- . ':!script/upstream'`: no matches.
- `gh run view 31053081178` + per-job logs (`gh api .../jobs/{92464599041,92464599061,92464599098}/logs`): guard step passed on linux; failures classified above.
- `bun test --timeout 10000` in `packages/sdk-next` (local macOS): `5 pass, 0 fail, 19 expect() calls, [2.76s]`.

## Limitations

- I did not execute `extension:isolated` end-to-end (would launch a real VS Code instance); verification is static plus transform-test coverage.
- The macOS embedded-test timeout was not reproducible locally; flake-vs-real classification requires a CI rerun I cannot trigger (read-only GitHub posture).
- I did not re-run the full five restored suites' JUnit paths in a pristine CI-like environment; scheduling, guard, and report-glob wiring were verified instead, plus one direct local suite run.
- The ProviderTransform failure root-cause was classified from logs and the diff, not by a local reproduction run; it belongs to the product-code review scope.
- No tracked source file was modified; `INFRASTRUCTURE_CHANGE_V2.md` is the only file authored by this review. Fixture work happened in the session scratchpad outside the worktree.
