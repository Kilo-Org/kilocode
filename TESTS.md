# Review: Removed Kilo-specific tests in PR #9978

> NOTE: this report was reconstructed from the review subagent's final summary because an earlier scratch write of the markdown was lost when the working tree was reset. The findings below match what the agent reported. A human should re-run the spot-checks for any line items they care about.

## Methodology

1. Listed deleted files in the PR:
   `git log --diff-filter=D --name-only --pretty=format: c1ea8100e..pr-9978 | sort -u | grep -E '\.test\.(ts|tsx)$'`
2. For every test file touched by the PR (`git diff --name-only c1ea8100e..pr-9978 -- '**/*.test.*'`), diffed BEFORE vs AFTER test names:
   ```
   git show c1ea8100e:<file> | grep -E '^\s*(it|test|describe)\(' > /tmp/before
   git show pr-9978:<file>   | grep -E '^\s*(it|test|describe)\(' > /tmp/after
   diff /tmp/before /tmp/after
   ```
3. Looked for new `*.skip` / `*.todo` / `xit` markers in the diff:
   ```
   git diff c1ea8100e..pr-9978 -- '**/*.test.*' | grep -E '^\+.*\b(skip|todo|xit)\b'
   ```
4. Cross-referenced with explicit skip commits (`0c1be058e`, `8cdfaea01`, plus `a1b0923a3`).

## Deleted test files

| File | Verdict |
|---|---|
| `packages/opencode/test/control-plane/sse.test.ts` | OK — upstream removed alongside its source in PR #25018. |
| `packages/opencode/test/plugin/workspace-adaptor.test.ts` | OK — renamed to `workspace-adapter.test.ts` (rename surfaces in the diff as delete+add); Kilo's `KILO_DISABLE_DEFAULT_PLUGINS` / `Flag.KILO_EXPERIMENTAL_WORKSPACES` setup was preserved. |
| `packages/opencode/test/control-plane/adaptors.test.ts` | OK — replaced by `adapters.test.ts` (the rename Kilo source already adopted). |
| `packages/opencode/test/kilocode/session-message-metadata.test.ts` | **Suspicious** — see Findings #4. |

No other Kilo-only test files were deleted.

## Kilo tests removed from shared files (all properly ported)

| Source file | Migration |
|---|---|
| `test/session/instruction.test.ts` | `KILO_CONFIG_DIR` trio ported into `it.live` form inside `Instruction.systemPaths global config`, with `kilocode_change` marker preserved. |
| `test/server/httpapi-instance.test.ts` | Four Kilo Hono-bridge tests moved into the new `test/server/httpapi-instance.legacy.test.ts`. |
| `test/config/agent-color.test.ts` | Kilo-marker assertions (`code` agent rename, `#FFA500` color) preserved in the structural rewrite. |
| `test/server/httpapi-workspace.test.ts` | Kilo tests ported to `it.live`; three new tests added. The dropped `test.todo("proxies remote workspace websocket through real Effect listener")` is now covered by `httpapi-workspace-routing.test.ts`. |
| `explore agent asks for external directories…` | Renamed and tied to the `external_directory` whitelist fix commit. |

## Newly-skipped suites

Three `describe.skip`s introduced — all skip upstream-added tests, not pre-existing Kilo tests:

1. **`Workspace.sessionRestore`** — entire suite skipped via commit `0c1be058e`. "Tracked for follow-up" in the commit message but no ticket. Suite contains some Kilo-flavored coverage. **Medium severity.**
2. **`HttpApi JSON parity`** — skipped (`8cdfaea01`); upstream parity test incompatible with Kilo's `NullOr` schemas. **Low severity.**
3. **`ModelsDev Service`** — skipped; Kilo's provider filtering has no replacement Kilo-side test. **Low severity.**

One test was intentionally rewritten in `instance.test.ts` (commit `a1b0923a3`) to match Kilo's contract; properly marked with `kilocode_change`.

## Findings

1. **`Workspace.sessionRestore` whole suite is silently `describe.skip`'d** with no ticket linked. Some of its assertions covered Kilo-flavored behavior (workspace adapter restore). A human should decide whether to file a follow-up to re-enable or replace it.
2. **`ModelsDev Service` skip** leaves Kilo's provider-filtering coverage at zero. Consider adding a Kilo-side replacement test.
3. **`HttpApi JSON parity` skip** is justified by the `NullOr` schema diff but should be revisited if/when schemas re-converge.
4. **`packages/opencode/test/kilocode/session-message-metadata.test.ts` was deleted.** This file lives in `test/kilocode/` and is therefore Kilo-only. The agent did not surface a clear migration target. A human should confirm: (a) was the production code it covered also removed, (b) was the coverage moved to another `test/kilocode/` file, or (c) is this an accidental deletion?
5. The `proxies remote workspace websocket through real Effect listener` `test.todo` was dropped without leaving a placeholder. Coverage is asserted to live in `httpapi-workspace-routing.test.ts` — verify this is true end-to-end for the Kilo-specific remote-workspace path.

## Conclusion

No Kilo test file was clearly accidentally deleted as part of merge auto-resolution. The Kilo tests removed from shared files were all ported. The biggest follow-up concerns are the silently-skipped suites (especially `Workspace.sessionRestore`) and the one Kilo-only deletion flagged in Finding #4.
