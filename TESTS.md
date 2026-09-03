# TESTS Review: PR #13368

## Scope and Method

Reviewed only test preservation for base `6175210c0fd0092a86aa475e4d8d7616711a1464`, head `5d120f0696a83b354804e0848f1c1af4b0088a4f`, and pristine upstream v1.18.18 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`. The merge base is the stated Kilo base, and the upstream commit is a parent of merge commit `6b9a826e03cd8a5716e73d25596fa6199cf25d59` and an ancestor of head.

Compared base-to-head and upstream-to-head test diffs, every one of the 17 changed test files, deleted assertion hunks, neighboring Kilo/kilocode tests, and test scheduling through package scripts, `turbo.json`, `.github/workflows/test.yml`, `script/check-test-ci.ts`, and the CLI isolated runner. No test file was deleted or renamed base-to-head. Static registrations increased from 7,398 to 7,413 and static `expect(` sites from 19,513 to 19,579 across `packages/core/test` and `packages/opencode/test`.

**Result: no Kilo-specific test removal was found.** One upstream coverage gap needs human verification.

## Human Verification

### Upstream MCP system-context regression coverage was not adopted

Pristine upstream v1.18.18 contains three tests that are absent at head:

- `packages/opencode/test/session/system.test.ts`: `MCP output includes connected server instructions` asserts exact `<mcp_instructions>` formatting.
- `packages/opencode/test/session/system.test.ts`: `MCP output omits servers when all advertised tools are denied` asserts permission filtering.
- `packages/opencode/test/session/prompt.test.ts`: `loop includes MCP instructions in model system context` asserts end-to-end injection into the LLM request.

The production seams remain at `packages/opencode/src/session/system.ts:173-188` and `packages/opencode/src/session/prompt.ts:1731`, but head has no equivalent assertions. The neighboring `packages/opencode/test/mcp/lifecycle.test.ts:300-312` verifies only that connected-server instructions are discovered; it does not cover formatting, permission filtering, or prompt-loop injection. `packages/opencode/test/session/prompt.test.ts` is unchanged from the Kilo base, while `packages/opencode/test/session/system.test.ts` was adapted without carrying the two upstream cases.

This is not a Kilo-specific test removal: none of the three tests existed at the Kilo base. The test-only risk is that a future merge or Kilo adaptation could silently stop injecting MCP guidance or expose guidance for fully denied servers without CI detecting it. A human should confirm whether omitting this upstream coverage was intentional; otherwise restore/adapt the two `SystemPrompt.mcp` unit tests and the prompt-loop integration test using the head service graph and Kilo model/provider fixtures.

## Notable Non-Findings

- No Kilo-specific base test file, test case, or assertion was removed without an equivalent or stronger head assertion. Changed config tests now assert that unknown keys are omitted while Kilo warnings retain the unknown field name; renamed compaction tags and retry jitter use updated deterministic expectations.
- All four changed tests under `packages/opencode/test/kilocode/` gained or strengthened assertions. Kilo assertions in shared provider, retry, compaction, system-prompt, and instance-context files remain present.
- No new `skip`, `todo`, `only`, environment gate, or conditional exclusion was introduced in the changed tests. The one executed skip, `projects a compaction message to v2 (v2 projector disabled)`, already existed at base and was untouched.
- No scheduling logic changed. `package.json#test:script:ci` was only reordered; the CLI remains scheduled through `packages/opencode/package.json#test:ci` and its isolated runner. `bun run script/check-test-ci.ts` reported `ok (25 test-bearing package(s), 11 root script test file(s))`; no changed script can newly schedule zero tests.
- The Kilo-marked removal of 250 ms cancellation bounds and optionalized readiness wait in `packages/opencode/test/session/compaction.test.ts` is weaker than pristine upstream, but it is identical in the supplied Kilo base and therefore not introduced by this PR.

## Executed Tests

- `packages/core`: `bun test test/provider-groq.test.ts test/provider-mistral.test.ts test/provider-xai-responses.test.ts test/session-compaction.test.ts test/session-runner.test.ts --timeout 60000` -> 98 pass, 0 fail, 290 `expect()` calls across 5 files.
- `packages/opencode`: isolated runner over all 12 changed CLI test files -> 13 runner selections, 13 passed, 0 failed, 0 flaky in 66.8s. The extra selection is `kilocode/config/config.test.ts`, matched by the substring `config/config.test.ts`; it also passed.
- Direct isolated per-file runs for the 12 changed CLI files -> 814 registered tests: 813 pass, 1 pre-existing skip, 0 fail, 1,669 `expect()` calls. Per-file counts were: config 108/176; payload recovery 3/26; config resilience 13/26; config validation 10/22; compaction chunks 12/67; Copilot models 7/14; provider 100/239; transform 432/810; instance context 9/20; compaction 62 pass + 1 skip/173; retry 53/70; system 4/26.
- Neighbor control: `bun test test/mcp/lifecycle.test.ts --timeout 60000` -> 22 pass, 0 fail, 53 `expect()` calls; confirms MCP discovery coverage exists but not the three omitted seams.
- `bun run script/check-test-ci.ts` -> `check-test-ci: ok (25 test-bearing package(s), 11 root script test file(s))`.

## Limitations

This was a TESTS-only review; production correctness, broad suites, CI status, mergeability, and non-test conflicts were not assessed. The pristine-upstream-to-head tree is intentionally very large, so upstream comparison was narrowed to the affected test concepts and production seams rather than treated as a flat repository-wide deletion list. A direct 12-file Bun run was intentionally excluded as semantic evidence because it violated the repository's required process isolation and produced 240 `ManagedRuntime disposed` contamination failures (573 pass, 1 skip, 1,462 assertions); the same files passed under the repository runner and in individual processes.

No GitHub state was mutated. Other reviewers' untracked reports were left untouched.
