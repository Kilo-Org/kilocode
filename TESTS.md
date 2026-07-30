# Kilo Test Coverage Review

## Methodology

- Compared base `70eeaff3837e29529e26c7c090767df0a3768249` directly with head `518501a994bcd660e8c6d061b450c32412104004`, using rename detection and focused diffs for test/spec/fixture paths, paths containing `kilo`/`kilocode`, and shared tests containing `kilocode_change`.
- Reviewed 18 deleted, 390 modified, and 49 added test paths. For substantive removals, traced the tested symbol/behavior into head and searched for equivalent assertions before recording a finding.
- Cross-checked the merge parents (`db1eae3583535d9b7a61ec8af9702e1580471056`, `898f0dc40b4549bb4160ed3cb53d19a6a39243dc`) to distinguish upstream moves and deliberate feature replacement from Kilo coverage dropped during reconciliation.

## Findings

1. **High: queued prompt handoff regression lost both backend and client tests.** `packages/opencode/test/kilocode/session-prompt-queue.test.ts` no longer asserts that a drained turn handing off to a queued follow-up closes as `superseded`, and `packages/kilo-vscode/tests/unit/session-outcome.test.ts` no longer asserts that clients suppress that non-error outcome. Head changes `packages/opencode/src/session/prompt.ts` from `superseded` to `interrupted` and removes the corresponding client guard. This is not an intentional test move; surviving queue tests cover `hasFollowup`, not the close reason/UI contract.

2. **High: Run-script startup/removal race coverage was deleted while the implementation was weakened.** `packages/kilo-vscode/tests/unit/run-script-manager.test.ts` removed `stops and disposes once when removal races startup`. Head's `RunScriptManager.remove()` no longer awaits an in-flight `start()`, and a late handle is only disposed, not stopped. No equivalent test exists.

3. **Medium: worktree import rollback and ordering coverage was replaced by a structural assertion.** `packages/kilo-vscode/tests/unit/agent-manager-arch.test.ts` previously executed both branch and PR imports and verified setup ordering, rollback of state/disk, retryability, and duplicate-branch messages. Head only checks that `WorktreeImporter` source contains selected names, while duplicating the branch/PR implementations. No behavioral replacement test exists.

4. **Medium: session mention search has no tests after its behavior changed.** `packages/kilo-vscode/tests/unit/session-search.test.ts` was deleted, but `handleSessionSearch()` remains. The removed tests covered directory fallback, filtering, error fallback, family-wide `worktrees: true` queries, and `worktreeName`; head changed to directory-scoped `client.session.list()` and drops `worktreeName`. Server family-list coverage does not exercise this extension adapter or payload. Restore adapter tests for the intended contract.

5. **Medium: Agent Manager diff-detail state coverage was deleted without an equivalent move.** `packages/kilo-vscode/tests/unit/agent-manager-worktree-diffs.test.ts` covered identical-list deduplication, per-file replacement, loading flags, duplicate request suppression, and stale-file refresh. The logic was inlined into the large `AgentManagerApp.tsx`; searches found no surviving tests for `requestWorktreeDiffFile`, `diffFileLoading`, or stale refresh behavior.

6. **Medium: telemetry contracts lost all direct coverage and some behavior.** `packages/kilo-telemetry/src/__tests__/identity.test.ts` and the host-OS assertion in `telemetry.test.ts` were removed. Head also removes the hashed, owner-only profile cache and `os_name`/`os_version`/`os_arch` event fields. No replacement tests cover `updateFromKiloAuth()` or those event properties. Restore tests if these Kilo privacy/performance/analytics contracts remain required.

7. **Human verification: confirm the config and release behaviors were intentionally retired.** Kilo tests for layered null-sentinel propagation, `web_search` schema/overlay handling, and stable-to-`rc` npm aliases were removed together with `KilocodeConfig.propagateUnset`/`unsetPaths`, overlay `web_search`, and `NpmPublish.aliases`. Because implementation and tests disappeared together, this may be deliberate product simplification; verify release/config owners approved it rather than a conflict resolution choosing upstream behavior.

8. **Human verification: confirm legacy PTY process-tree guarantees were intentionally dropped.** `packages/core/test/kilocode/pty-termination.test.ts` and Kilo assertions in `packages/core/test/pty/pty-session.test.ts` were removed with `KiloPtyTermination`. Surviving cross-spawn tests cover killing the direct process and escalation, but not Windows hidden `taskkill`, detached descendants, direct-signal fallback, explicit PTY args, or exited-output replay. Verify the replacement PTY stack guarantees these behaviors or restore integration coverage.

9. **Human verification: confirm the Kilo-authenticated Exa proxy was intentionally replaced.** `packages/opencode/test/kilocode/tool/websearch-kilo-exa.test.ts` was removed with its implementation. `packages/core/test/tool-websearch.test.ts` is a real move for general Exa/Parallel request and no-result coverage, but it does not preserve the old Kilo gateway bearer-auth, 401/403 login guidance, 10-result cap, or highlighted-result formatting contracts. Verify the provider migration intentionally drops those Kilo-specific semantics.

## Notable Non-Findings

- Most modified `packages/core/test/kilocode/**` and `packages/opencode/test/kilocode/**` files retained their assertions; their diffs are mechanical Effect layer-node migrations.
- OAuth branding coverage survived an implementation move: `packages/opencode/test/kilocode/oauth-branding.test.ts` now checks `core/src/plugin/provider/openai.ts` plus `core/src/kilocode/oauth/page.ts` instead of the removed `openai-auth.ts` path.
- Deleted Prompt Rail, diff-scope, and old embedded Run-terminal tests tracked production modules/features removed in the same diff; they were not counted as accidental test-only losses. New core websearch tests substantially replace the general portions of the deleted Kilo Exa tests, subject to finding 9.
- Marker-bearing test files decreased from 173 to 170, but reviewed marker assertion removals were either represented above or tied to broader architecture retirement; retained marker tests generally changed only service construction.

## Commands

- `git diff --name-status --find-renames 70eeaff3837e29529e26c7c090767df0a3768249 518501a994bcd660e8c6d061b450c32412104004 -- <test/spec/fixture pathspecs>`
- `git diff --numstat ...`, `git diff -G'kilocode_change' ...`, and focused `git diff --unified=... -- <paths>`
- `git grep -l kilocode_change <revision> -- <test/spec pathspecs>` and repository searches for deleted test names, assertions, and implementation symbols
- `git diff db1eae3583535d9b7a61ec8af9702e1580471056 518501a994bcd660e8c6d061b450c32412104004 -- <focused paths>` to inspect merge-resolution outcomes

## Limitations

- The supplied base is not an ancestor of head. Their merge base is `f844790ed7e0220146d0b5d650a57fce6ecc79d5`; base and head are 108 and 506 commits ahead of it, respectively. Findings therefore describe requested base-to-head coverage loss and may include base-side work omitted before this merge rather than edits made solely in the merge commit.
- This was a static coverage audit. Tests were not run because the review concerns deleted/weakened tests and the requested output is a report; human-verification findings require product/merge intent not inferable from the tree.
