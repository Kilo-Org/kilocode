# Kilo-Specific Test Preservation Review

## Review target

- PR: `#11090`
- Reviewed head: `6a1377abaa88902b741f3ffff276aa6b743f3a3c`
- Reviewed base: `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`
- Range: complete `b90ab85c3b4ad5097fe11e431d0319f31f935d6e...6a1377abaa88902b741f3ffff276aa6b743f3a3c`
- Revision check: `HEAD` was the requested head, `origin/main` and the merge base were both the requested base.

## Scope and methodology

The review enumerated every changed test file in the complete range, then inspected deleted test declarations and assertions rather than relying only on path names. Dedicated Kilo tests under `packages/opencode/test/kilocode/` were reviewed together with shared tests containing Kilo branding, package names, fixtures, runtime flags, or `kilocode_change` markers. Test fixtures, package scripts, the isolated test runner, Turbo configuration, and the CI unit-test workflow were also checked for discovery regressions.

- Reviewed 109 changed test files: 107 modified, 2 added, 0 deleted, and 0 renamed.
- Semantically reviewed all 51 changed dedicated Kilo test files and 39 changed shared test files with Kilo signals. The remaining 19 changed test files were scanned for removed declarations, assertions, skips, and discovery changes.
- Compared test names across revisions. Six names disappeared, all from shared paths; five are semantic replacements or name-only updates. One replacement drops negative coverage, described below.
- Compared skip/focus state. No changed test introduced `test.skip`, `it.skip`, `test.only`, or `it.only`. Dedicated changed Kilo tests increased from 324 to 327 declarations.
- Inspected assertion-level changes in Kilo tests. Most changes migrate `WithInstance.provide` to `provideTestInstance`, move the compatibility `Instance` import to `src/kilocode/instance.ts`, or supply newly required Effect layers without changing assertions.

## Findings

### [Low] Raw instance loading no longer asserts that legacy context remains uninstalled

The base test explicitly checked twice that `InstanceStore.load()` and bootstrap did not install ambient legacy instance context for the caller:

- Removed assertion: `b90ab85c3b4ad5097fe11e431d0319f31f935d6e:packages/opencode/test/project/instance.test.ts:48`
- Removed assertion after bootstrap: `b90ab85c3b4ad5097fe11e431d0319f31f935d6e:packages/opencode/test/project/instance.test.ts:66`
- The retained positive load test at `packages/opencode/test/project/instance.test.ts:40` now checks only the returned directory and worktree.

This weakens a Kilo-relevant isolation invariant. A future change that makes a raw load leak legacy AsyncLocalStorage context into its caller could pass the current suite, potentially allowing the wrong directory to be observed by compatibility code. The new tests at `packages/opencode/test/cli/effect-cmd-instance-als.test.ts:18` and `packages/opencode/test/cli/effect-cmd-instance-als.test.ts:39` correctly verify that context is available inside Effect bridge and `effectCmd` callbacks, but they do not verify that a raw `InstanceStore.load()` leaves ambient legacy context untouched.

Human verification is warranted because `src/kilocode/instance.ts` now falls back from legacy local context to the Effect `InstanceRef`, so the old `Instance.current` assertion cannot be copied blindly. A replacement should distinguish raw legacy local context from the intentional Effect-fiber fallback and assert non-leakage after a plain store load.

## Replacement mapping

- The static source check `effect-cmd.ts wraps the handler body in Instance.restore` and the indirect Promise test were replaced by direct behavioral coverage at `packages/opencode/test/cli/effect-cmd-instance-als.test.ts:18` and `packages/opencode/test/cli/effect-cmd-instance-als.test.ts:39`. This is stronger coverage of the production command and bridge paths.
- `provides legacy Promise callers with instance ALS` is covered by the Effect bridge test at `packages/opencode/test/cli/effect-cmd-instance-als.test.ts:18`. The old post-callback assertion also depended on the pre-merge `Instance.current` semantics, which now intentionally include an Effect-fiber fallback.
- `installs Instance ALS around bootstrap for Kilo bootstrap compatibility` became `provides InstanceRef during bootstrap for Kilo bootstrap compatibility` at `packages/opencode/test/project/instance.test.ts:270`. This follows the migrated Effect-native bootstrap contract; legacy Promise crossings are separately exercised through `EffectBridge`.
- `no-ops for paths inside Instance.directory` is a name-only update to `no-ops for paths inside the instance directory` at `packages/opencode/test/tool/external-directory.test.ts:51`; its setup and assertion are retained.
- The dedicated Kilo error and overflow suites gained coverage at `packages/opencode/test/kilocode/cli/error.test.ts:5`, `packages/opencode/test/kilocode/session-overflow.test.ts:90`, and `packages/opencode/test/kilocode/session-overflow.test.ts:98`.

## Notable non-findings

- No Kilo test file was deleted, renamed away, or moved outside test discovery.
- No dedicated Kilo test declaration was removed. The 51 changed files under `packages/opencode/test/kilocode/` retain their prior tests and add three declarations.
- Kilo assertions for configuration branding, indexing startup, permission behavior, session processing, compaction, suggestions, snapshots, project IDs, and tool behavior remain present. Fixture migrations preserve the test directory context and add explicit initialization where bootstrap side effects are no longer implicit.
- The Kilo model-not-found assertion was strengthened to require `kilo.json` and reject `opencode.json` at `packages/opencode/test/kilocode/cli/error.test.ts:16`.
- The test runner and package test scripts were not modified in the reviewed range. `packages/opencode/script/test-runner.ts:86` still discovers `test/**/*.test.{ts,tsx}`, and `packages/opencode/script/test-runner.ts:97` excludes only the pre-existing OAuth browser test during unfiltered runs.
- Core tests remain reachable through `packages/core/package.json:9` and `packages/core/package.json:10`. CLI tests remain reachable through `packages/opencode/package.json:10` and `packages/opencode/package.json:11`. CI invokes workspace `test:ci` scripts at `.github/workflows/test.yml:77`.
- Both added test files are discoverable: `packages/core/test/event.test.ts` through Bun's package test discovery and `packages/opencode/test/cli/cmd/tui/prompt-history.test.ts` through the CLI runner glob.

## Commands and outputs

- `git rev-parse HEAD`, `git rev-parse origin/main`, and `git merge-base <base> HEAD`: returned the requested head and base revisions.
- `git diff --name-status --find-renames <base>...<head>` plus test-file classification: `109` test files, `107` modified, `2` added, `0` deleted, `0` renamed.
- Declaration comparison across all changed tests: `855` declarations at the base and `870` at the head; the single existing `test.todo` count stayed unchanged, and no skip/focus declaration was added.
- `bun run script/test-runner.ts kilocode/ --concurrency 4 --retries 0` from `packages/opencode`: `212` Kilo test files passed, `0` failed, `0` flaky. This includes all 51 changed dedicated Kilo test files and confirms that the runner discovers them.
- Targeted replacement run for `cli/effect-cmd-instance-als.test.ts`, `project/instance.test.ts`, and `tool/external-directory.test.ts`: `3` files passed, `0` failed, `0` flaky.
- Targeted run of 13 substantively changed shared Kilo-sensitive files, including runtime flags, watcher, LSP, bootstrap, compaction, instruction, processor, skill, storage, and tool tests: `13` files passed, `0` failed, `0` flaky.
- `bun test test/catalog.test.ts test/event.test.ts test/plugin/provider-opencode.test.ts` from `packages/core`: `24` tests passed, `0` failed.
- `git diff --check` over changed tests, fixtures, and test configuration: no output.

## Limitations

- The full non-Kilo CLI suite was not run. Dynamic validation covered every dedicated Kilo test plus the shared files with the most substantive Kilo-specific assertion changes and all changed core tests.
- The low-severity finding is a coverage gap, not evidence of a current runtime context leak. Confirming the intended distinction between legacy local context and the new Effect-fiber fallback requires a purpose-built assertion in the test harness.
