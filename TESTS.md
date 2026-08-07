# Kilo-specific test preservation review

## Method

Reviewed PR #12901 at exact head `c69ce6caf638617169509f09e3f5d620eb702146`, merge base `b135b4e10a9028983497bf69cded47b6ce4572ff`, and pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`. The v1.18.0 tag peels to the stated commit, which is the second parent of merge commit `2847475275e2eb68bdefda2296c38a96c0d76c68` and an ancestor of head.

I compared executable tests and broader test/fixture paths with rename detection; searched removed assertions, fixtures, markers, environment, branding, config, model/provider, MCP, permission, and sandbox coverage; traced rewritten cases to replacements; and inspected package, Turbo, runner, and workflow registration. The executable-test delta is **52 files: 14 added, 38 modified, 0 deleted, 0 renamed**. Broader test/fixture paths are **57 files: 17 added, 40 modified, 0 deleted, 0 renamed**.

## Finding

### P1: CI silently omits 28 changed or new executable test files

`.github/workflows/test.yml:144-150` runs non-CLI unit tests only through `bun turbo test:ci`. Four retained packages lost Kilo's `test:ci` scripts while keeping local `test` scripts: `packages/client/package.json:11-16`, `packages/httpapi-codegen/package.json:9-12`, `packages/sdk-next/package.json:10-13`, and `packages/session-ui/package.json:23-26`. Turbo resolves all four `test:ci` commands to `<NONEXISTENT>` and an actual filtered run reports `No tasks were executed`, `0 successful, 0 total`. This removes **20 executable files** from CI (4 client, 2 HTTP API codegen, 2 SDK-next, 12 session UI).

The merge also introduces `packages/codemode` with **7 executable test files** but only a local `test` script (`packages/codemode/package.json:12-15`), and adds root `script/translate-app.test.ts` while root `test` deliberately exits (`package.json:20`). No workflow invokes either suite. These are also absent from `test:ci`, making **28 unscheduled changed/new files** total.

Direct execution proves this is live coverage, not dead fixtures: the six omitted suite groups pass **423 tests / 1,163 assertions** at head: client 16/75, HTTP API codegen 67/123, SDK-next 5/19, session UI 60/138, codemode 263/784, and translation 12/24. The lost coverage includes client import boundaries; Windows-safe generation; embedded SDK Kilo database/events; `@kilocode/sdk` session rendering; code-mode schema/parity, confinement, and secret-sanitization boundaries; and translation edit confinement/config safety.

Provenance is mixed but actionable. The four removed scripts are present at merge base and raw merge `2847475275`, absent from pristine upstream and adaptation `76783409bf`, and remain absent at resolution `88083fb5c5` and head: stage matrix `YYYY`, `NNNN`, `YYYY`, `NNNN`, `NNNN`, `NNNN`. `script/upstream/transforms/transform-package-json.ts:281-295` already warns that omitted preservation "silently schedules zero tests" but preserves only six other shared packages; its test at lines 90-108 encodes that incomplete list. Codemode and translation arrive from upstream already without Kilo `test:ci` registration, so their omission is an unadapted upstream integration gap.

**Direction:** restore the four merge-base `test:ci` commands and preserve them in the package transform; add a `test:ci` entry for codemode; explicitly schedule the root translation test without enabling root-wide `bun test`; and add a CI guard that expected test-bearing packages cannot resolve to `<NONEXISTENT>` or zero tasks.

## Stall-test force update

The requested claim that `packages/opencode/test/kilocode/issue-8656-stall.test.ts` changed an expected message count from 3 to 2 is **not present at the specified immutable head**. Neither the merge-base-to-head diff, previous reviewed head `425f5f3b36`, full local file history, nor the head file contains a message-count assertion. `c69ce6c` changes only the readiness polling budget at line 130 from 30 seconds to 60 seconds.

That actual change is a valid flake-budget adaptation, not assertion loss. The test still asserts both behavior branches and passed **2 tests / 14 assertions**. Its bounded case observed three provider calls (`calls:3`, one stalled and one recovered) and the complete logical timeline `tool:bash:completed | step-finish:tool-calls | step-start | text | step-finish:stop`; the opt-out case remained busy at `step-finish:tool-calls`, then was aborted and returned idle. No expectation was removed or relaxed. Human verification is needed if the stated 3-to-2 change exists on another unpublished or later SHA; it cannot be attributed to `c69ce6c` from available Git evidence.

## Notable non-findings

- No executable test file was deleted or renamed. Kilo-owned test paths are unchanged except the stall test's 30-to-60-second budget; `packages/llm/test/kilocode`, `packages/tui/test/kilocode`, `packages/ui/src/kilocode`, and `packages/kilo-vscode/tests` are byte-identical to merge base.
- Removed provider/config assertions were behavior adaptations with replacement coverage: stale Anthropic/Grok IDs and compaction headings were updated; cost/options and explicit/generated variants gained assertions; Kilo config directory, models cache isolation, provider fixtures, environment, Windows path, sandbox, and permission coverage remains or increased. No uncovered branding or Kilo fixture deletion was found.
- The rewritten MCP lifecycle/OAuth suites replace module mocks with real protocol servers/transports and preserve coverage for roots, cached notifications, pagination/cursor failures, disconnect/reconnect/replacement cleanup, partial failure, schema-ref fallback, capability-only servers, unknown/failed servers, sanitization, local/remote timeout cleanup, callback cancellation, OAuth state, credential rollback/commit, URL-scoped auth, browser failures, authorization URLs, and headers. Focused execution passed **34 tests / 95 assertions**.
- CLI discovery still scans every `test/**/*.test.{ts,tsx}`: **649 files**, including **390** under `test/kilocode`. `mcp/oauth-browser.test.ts` is deliberately excluded from parallel broad execution because it owns a fixed callback port and passed when invoked directly. The footer renderer adaptation passed **24 tests / 117 assertions**, with 3 explicit unrelated skips.

## Commands and results

- `git rev-parse HEAD`; `git merge-base HEAD main`; `git rev-parse 'refs/tags/v1.18.0^{}'`; `git show -s --format='%H %P %s' 2847475275`: exact requested head/base/tag and merge parent verified.
- `git diff --name-status --find-renames b135b4e... c69ce6c... -- <test globs>`: executable 14 A / 38 M / 0 D / 0 R; broader test/fixture 17 A / 40 M / 0 D / 0 R.
- `bun turbo test:ci --dry --filter=<four packages>`: four `<NONEXISTENT>` commands. Same command without `--dry`: warning `No tasks were executed`; 0 total.
- Direct `bun run test`: client 16/16 (75 assertions), HTTP API codegen 67/67 (123), SDK-next 5/5 (19), session UI 60/60 (138), codemode 263/263 (784). `bun test ./script/translate-app.test.ts`: 12/12 (24).
- From `packages/opencode`, `bun test ./test/kilocode/issue-8656-stall.test.ts`: 2/2, 14 assertions; `bun test ./test/mcp/lifecycle.test.ts ./test/mcp/oauth-auto-connect.test.ts ./test/mcp/oauth-browser.test.ts`: 34/34, 95 assertions; `bun test ./test/cli/run/footer.view.test.tsx`: 24 pass, 3 skip, 117 assertions.
- A combined config/provider/session run was attempted but exceeded 180 seconds amid repeated live model-catalog fetches; it did not produce a final test summary and is classified as incomplete/environmental, not a failure.
- Final `git rev-parse HEAD` and tracked diff check remained at `c69ce6c`; only this assigned report was authored.

## Limitations

This was a focused coverage-preservation and registration audit, not a full repository CI rerun. Tests ran on macOS; Windows-specific assertions were inspected but not executed. Live model fetching made one broad focused command inconclusive. GitHub CI/mergeability was not queried in this report pass, and no manual UI or remote OAuth test was performed. Other untracked reviewer reports pre-existed or were authored concurrently and were not edited. No source, test, manifest, workflow, GitHub state, credentials, or real user data was changed.
