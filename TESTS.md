# PR 12204 Kilo Test-Coverage Audit

## Scope and method

Reviewed checked-out branch `review/upstream-12204-latest` at current PR head `472247daa9063cf7dfea423bec64c46cea44ba36` against requested base `c49560af0f94459015d3fa4e1efa23ad9b291955`. The audit covered changed/deleted files under `test/kilo*` and `test/kilocode`, shared tests whose diff or base content contained Kilo assertions, fixtures, imports, or `kilocode_change` markers, all newly added skips, test scripts/profiles, and the TUI package extraction. Deleted tests were compared semantically with current replacements rather than treated as losses solely because paths changed. Revalidation also compared the prior reviewed head `2ca787fa4de21f0d00eb16f95b38e214d2e18242` to current HEAD; the force-push changed only `packages/http-recorder/package.json`, `packages/opencode/src/mcp/catalog.ts`, and `packages/opencode/src/mcp/index.ts`, so none of the test-coverage evidence below changed.

CI was inspected with `gh pr checks` and job logs for the current PR. Focused local commands were attempted without modifying dependencies; this checkout's dependency tree is incomplete, so source/diff inspection and CI logs provide most execution evidence.

## Findings

### 1. High: the macOS CLI suite exits before running any tests

`packages/opencode/script/kilocode/test-profile.ts:25` still requires `reference/*.test.ts`, but this PR deletes the only matching CLI file, `packages/opencode/test/reference/reference.test.ts`, as part of moving Reference ownership into `packages/core`. `TestProfile.resolve` deliberately rejects any unmatched pattern at `packages/opencode/script/kilocode/test-profile.ts:86-100`. Although `packages/opencode/test/kilocode/test-profile.test.ts:10-14` is intended to catch exactly this drift, the Darwin profile is resolved before any test subprocess starts, so that guard cannot run in the affected macOS job.

Current `unit (macos)` logs reproduce the result:

```text
$ bun run script/test-runner.ts
Invalid test profile "darwin":
- Unmatched patterns: reference/*.test.ts
```

The job then reports `No test results found!` and uploads no JUnit artifact. This means the macOS-only Kilo sandbox/confinement tests selected at `packages/opencode/script/kilocode/test-profile.ts:30-41`, along with the rest of the curated Darwin CLI suite, currently provide zero coverage. Remove or replace the stale pattern and make profile validation run independently of the profile it validates, so future drift cannot suppress its own test.

### 2. High: three Kilo V2 hydration-race regressions were dropped during the TUI data-context replacement

The deleted Kilo-annotated suite `packages/opencode/test/cli/tui/sync-v2.test.tsx` contained seven tests. Its new counterpart, `packages/tui/test/cli/tui/data.test.tsx:216-514`, preserves the pending-tool failure, prompt promotion, missed admission, and context-update cases, but has no equivalent for the deleted cases at base lines 323, 371, and 438:

- Preserve a live event while snapshot hydration is in flight.
- Replace stale cached rows while preserving in-flight live rows.
- Preserve snapshot order and metadata when live updates arrive during hydration.

This is not merely an obsolete API assertion. The replacement still combines live event mutation with snapshot refresh, but `packages/tui/src/context/data.tsx:450-453` now overwrites the entire message array with the HTTP response. A live message received while that request is pending can therefore be lost, exactly the race the removed tests guarded. Port those three scenarios to `DataProvider`; the expected merge/order semantics should be retained or intentionally redefined and tested.

### 3. Medium: two new direct-mode skill workflows are committed as skipped tests

`packages/opencode/test/cli/run/footer.view.test.tsx:801-835` and `:839-868` are new tests, but `test.skip` makes them ineffective. They are the only end-to-end assertions that selecting synthetic `/skills` inserts an editable bound Kilo skill command and that closing the panel clears the synthetic draft. The source uses Kilo-specific slash-command handling (`packages/opencode/src/cli/cmd/run/footer.prompt.tsx:409-450`) even though these two test blocks do not carry markers.

The base already had three documented OpenTUI skips, and this PR replaces one old command-panel skip while retaining the other two. These two skill tests are additional skipped coverage, not moves. Avoid merging dead regression tests: isolate the transition from the crashing renderer teardown, split interaction from cleanup, or add a non-renderer state-level test that executes in CI. Track the OpenTUI crash separately if an integration skip must remain.

### 4. Medium: Kilo's repeated logger-initialization regression lost all coverage

The deleted `packages/opencode/test/util/log.test.ts:51-76` verified that calling `Log.init({ dev: true })` twice during one `KILO_RUN_ID` does not truncate `dev.log`. That behavior remains explicitly Kilo-specific in `packages/core/src/util/log.ts:73-91`, including `KILO_LOG_INITIALIZED_RUN_ID`, but no current test mentions either run-ID variable or the retained log content. The unrelated timestamp-retention test from base lines 31-49 was also removed.

Move the same-run reinitialization regression to `packages/core/test` alongside the extracted logger. At minimum assert that content written between two `init` calls survives; retaining the newest-ten cleanup assertion would also cover `packages/core/src/util/log.ts:127-140`.

### 5. Medium: Reference extraction lost service-to-cache materialization and refresh integration coverage

The deleted `packages/opencode/test/reference/reference.test.ts:200-290` exercised the complete Reference service against a real local Git remote: initial materialization and refresh on the next initialization. The replacement `packages/core/test/reference.test.ts:11-13` installs a cache stub whose `ensure` deliberately dies, while its Git tests only derive paths (`:45-95`). `packages/core/test/repository-cache.test.ts:18-88` covers cache operations in isolation, but no test now verifies that `Reference` invokes `RepositoryCache.ensure({ refresh: true })` or that the asynchronous fork at `packages/core/src/reference.ts:114-123` updates an existing checkout.

Restore at least one focused integration test in `packages/core/test/reference.test.ts` using the local Git fixture. It should add a Git source, wait for initial content, update the remote, rebuild or reapply the Reference transform, and wait for refreshed content. This verifies the extraction's wiring rather than duplicating cache internals.

### 6. Medium: unit CI stopped producing JUnit reports

`.github/workflows/test.yml:134-150` still publishes and uploads `packages/*/.artifacts/unit/junit.xml`, but this PR changes both Turbo invocations from `test:ci` to `test`. For the CLI, `packages/opencode/package.json:10,17` shows that only `test:ci` passes `--ci` to the isolated test runner; `packages/opencode/script/test-runner.ts:184-209` creates and merges JUnit output only in that mode. The PR also removes the root Turbo `test:ci` task/output declarations.

Every latest unit job consequently reports `No test results found!` and `No files were found with the provided path`, including shards that executed hundreds of files and failed. This makes test failures harder to review and leaves the check annotations/report artifacts ineffective. Restore `bun turbo test:ci` and the Turbo task, or pass equivalent reporter/output settings through the new `test` task and declare its outputs.

## Notable non-findings

- No Kilo-owned test file under `packages/core/test/kilocode` or `packages/opencode/test/kilocode` was deleted. Most changes there are import/layer updates. `account-auth-v2-migration.test.ts:40-96` still verifies two Kilo accounts, active selection, OAuth access, and organization metadata after the Credential migration. The removed assertion that the source JSON stayed byte-for-byte unchanged does not correspond to current migration behavior that writes only to SQLite.
- The TUI package extraction preserves many tests as recognized renames, including notifications (99%), prompt-submit-race (97%), thinking (94%), diff viewer (82-90%), keymap (83%), slot replacement (62%), and transcript (99%). Kilo-specific provider priority remains asserted at `packages/tui/test/cli/cmd/tui/provider-options.test.ts:26`, Kilo tools at `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx:189-193`, project-wide event routing at `packages/tui/test/cli/tui/use-event.test.tsx:119-134`, and Kilo epilogue branding at `packages/tui/test/app-lifecycle.test.tsx:121`.
- The removed `createLeadingTrailingSignal` case in `packages/opencode/test/kilocode/tui/signal.test.ts` is legitimate: the session preview-pane implementation it tested was removed, and no current source exports or calls that helper.
- No newly added skip was found in Kilo-owned test paths. The existing platform/performance skips there are unchanged. The extracted file-tree renderer skip at `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx:30` also existed at the base. Newly skipped tests are confined to the direct footer issue described above.
- Credential migration coverage was adapted rather than removed, and the new direct-mode branding, Kilo OAuth branding, CLI auth-command branding, and TUI plugin-registry tests add useful Kilo-specific assertions.

## Commands, CI, and limitations

Commands used for the audit included:

```text
git diff --name-status --find-renames c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD
git diff --unified=2 c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD -- packages/opencode/test/kilocode packages/core/test/kilocode
git diff --find-renames --summary c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD -- packages/tui/test packages/opencode/test/cli/tui packages/opencode/test/cli/cmd/tui
git diff --unified=0 c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD -- '**/*test*.ts' '**/*test*.tsx'
KILO_TEST_PROFILE=darwin bun run script/test-runner.ts --dots
gh pr checks 12204 --repo Kilo-Org/kilocode
gh api repos/Kilo-Org/kilocode/actions/jobs/87178926380/logs
gh run view 29360349529 --repo Kilo-Org/kilocode --job <unit-job-id> --log-failed
```

The Darwin profile command locally produced the same unmatched `reference/*.test.ts` error as CI. In latest run `29360349529`, non-CLI macOS package tests passed, then the CLI profile failed before launching a single CLI test. Both Linux shards and all four Windows shards executed but failed; the HTTP API exerciser passed. Linux summaries were `287 files | 274 passed | 13 failed | 1 flaky` and `288 files | 280 passed | 8 failed | 0 flaky`. Windows summaries ranged from two to five failed files per shard. Representative failures include:

- `packages/opencode/test/kilocode/test-profile.test.ts:12,37` directly confirms the stale Darwin profile on Linux and Windows.
- Many CLI subprocess tests cannot start because Bun resolves `packages/tui/src/config/index.tsx` through `react/jsx-dev-runtime` instead of the configured OpenTUI JSX runtime. This affected run/serve/ACP and Kilo serve tests on Linux.
- `packages/opencode/test/provider/transform.test.ts` has three deterministic OpenRouter variant assertion failures on Linux and Windows.
- Other failures include Kilo compaction, local-model, memory, plan-followup, and repo-clone tests; Windows-specific filesystem/SDK assertions; `AppRuntime.dispose is not a function` during some preload teardowns; and Bun crashes. These broad failures do not replace or invalidate the coverage-removal findings above.

All unit jobs, including the macOS zero-test job, produced no JUnit report because of finding 6. The aggregate `unit (linux)` and `test (linux)` jobs then failed only because their required unit result was `failure`.

Focused local Bun tests could not start because this checkout resolves neither `@opentui/solid/preload` nor several core dependencies (`effect`, `@effect/sql-sqlite-bun`). No `bun install` was run because this review was restricted to writing `TESTS.md`; CI used a complete install and supplied the authoritative macOS failure. No repository files other than this report were modified.
