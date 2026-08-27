# Tests review — PR #13513

## Scope and method

Reviewer 7 of 7; this report covers removal, weakening, or disconnection of Kilo-specific test coverage, not the overall merge verdict. All commands ran inside `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports` or its package directories. No commands ran in the caller worktree.

Reviewed exact HEAD `6a7d6bc002319ac2987bcde3d6c63efcafc07021` against actual stacked base / merge base `bf1cf502a3c511e9daf6a43244568ae4e83473a8` (`johnnyeric/kilo-opencode-v1.18.18`). Controls were pinned main `62998965e9fb0d9ed89011c62498b39801dbbb4f`, pristine upstream v1.18.18 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`, v1.18.19 `2b72179c663cadcb54f54d9f19221b3fb3d11fb6`, and v1.18.20 `7248bc1964b13fa67e601733f89ee9dc6dfa0563`.

Read root `AGENTS.md`, `REVIEW.md`, `TESTING.md`, the upstream-review command, CLI/package/test/server-test instructions, test preloads and runner selection, and the requested skills. Obtained full changed/deleted/renamed path inventories; inspected all 18 changed test-file diffs, including every removed line in seven files; compared upstream and both merge parents; enumerated Kilo-named test/fixture blobs; and checked shared tests containing Kilo identifiers, fixtures, imports, or markers. Inspected main-only missing tests separately so unrelated main development was not attributed to this stacked PR. Ran focused existing tests using the parent-installed dependencies, without installing or editing source.

Verified inventory:

- Entire PR: **59 files = 3 added / 56 modified; zero deleted or renamed**. **95 reachable commits; two first-parent merges**.
- Test delta: **18 files = 2 added / 16 modified; 902 inserted / 140 deleted lines**. The two additions are Cerebras and provider-stream-error tests.
- **1,243 tracked Kilo-named test/fixture paths from the actual base remain byte-identical at HEAD**. This is a broad path inventory, including fixtures and support files, not a count of executable tests.
- Thirteen modified shared test files contain Kilo identifiers in their base contents; those were not excluded merely because their paths are upstream-owned.
- Upstream merge `91ca95bad927436131ea4783a470885a381ce6ad` has parents actual base and pristine v1.18.20. HEAD has parents that merge and transformed upstream `9563af96a012effc25df5a11eaa1f7633161a742`. All 18 final test changes are present in the first-parent-to-HEAD adaptation delta.

## Findings and scoped verdict

**No confirmed Kilo-specific test removal, assertion weakening, or scheduling disconnection introduced by this PR. Safe to merge for this review lens.** No severity-ranked remediation is required by this audit; other reviewers own product correctness and the overall merge verdict.

## Notable non-findings

### 1. The upstream “remove flaky subagent test” commit does not remove a test from the final PR delta

`62cb3f77bd2b4eb3721f286022066de1abe04432` removes the 44-line `answers requested permissions from subagents` case from `packages/opencode/test/cli/run/run-process.test.ts`. That case was first added by upstream `08faeb3893` inside the same v1.18.18 → v1.18.20 range. It is absent from both pristine endpoints and from both Kilo endpoints; the pristine file blobs match each other, and the Kilo base/HEAD blobs match each other.

The removed intermediate case has no Kilo-specific assertions or fixtures. Kilo's existing auto-reject/nonzero-exit, dangerous-flag, and explicit-deny coverage remains at `packages/opencode/test/cli/run/run-process.test.ts:327-361`, unchanged. **Provenance: temporary upstream-only addition and removal; not a final-diff Kilo coverage regression.** This does not claim the surviving parent-permission test is equivalent to the removed subagent subprocess test; that heavier end-to-end path was not run here.

### 2. Cloudflare assertion removals follow an upstream API replacement, not removal of Kilo coverage

The four old max-output-token hook tests at base `packages/opencode/test/plugin/cloudflare.test.ts:43-68` are replaced by auth registration and explicit absence-of-hook assertions at HEAD `packages/opencode/test/plugin/cloudflare.test.ts:16-25`. The production `chat.params` hook itself is removed: OpenAI uses native Responses passthrough rather than the unified chat-completions workaround (`packages/opencode/src/provider/provider.ts:874-889`).

The old wire assertions are replaced rather than silently dropped: Responses reasoning effort/summary are asserted at `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts:208-237`; the compatibility-route `reasoning_effort` assertion and wrong-key negative control remain for Workers AI at lines 258-273. Native Anthropic and token-scoping checks are added at lines 240-255 and 277-306. All 12 tests executed, with 32 assertions.

**Provenance control:** both test files are byte-identical across base/main/pristine v1.18.18, and their HEAD versions are byte-identical to pristine v1.18.20. No Kilo overlay was removed. The helper still reconstructs gateway routing rather than calling production `Provider.getModel`; see limitations below.

### 3. Shared Kilo Codex, websearch, task, and credential assertions survive

- `packages/opencode/test/plugin/codex.test.ts:138-214`: the Kilo OAuth model-filter block changes only formatting/trailing commas. All **nine** filter assertions and their model fixtures are preserved. The refresh assertion at line 502 replaces a literal access token with a generated JWT and adds residency checks; it does not stop checking the refreshed token or request authorization. The model-filter and surrounding plugin tests executed successfully.
- `packages/opencode/test/tool/websearch.test.ts:33-40`: the test is renamed and an `opencode-go` case is added, but the Kilo-enabled and OpenCode-disabled assertions remain exactly as before. No skip or eligibility gate was added. The full file executed successfully.
- `packages/opencode/test/tool/task.test.ts:103-126`: the Kilo prompt stub still persists assistant cost through the real session service. New optional error fixtures do not replace the existing cost branch. Forked-session resume, platform attribution, failure resume hints, background/extended costs, delta-only costs, and partial-abort costs remain. The two new cases at lines 398-489 retain upstream child-error checks while asserting Kilo's resumable `task_id` message. Thirteen selected tests executed, including the preserved Kilo coverage; 19 unrelated cases were deliberately filtered by this review command, not skipped by the PR.
- `packages/opencode/test/server/httpapi-provider.test.ts:354-383`: the Kilo-auth fixture is unchanged and gains an assertion that persisted Google credentials appear in `connected`; existing response, nonserialized-fetch, and nonzero-cost assertions remain. Static verification only in this lens.

**Provenance:** existing Kilo coverage preserved; upstream additions adapted to Kilo error text, plus an additional Kilo credential assertion. No new `skip`, `only`, `todo`, timeout, environment gate, or `mock.module` change occurs in the actual PR test hunks.

### 4. Apparent missing main tests are not PR deletions

Comparing pinned main directly to HEAD produces **13 absent test/fixture paths**: 12 tests and one worktree-reference fixture. Every one is also absent from the actual stacked base. Their addition history belongs to unrelated main commits, including `62998965e9` (plan-mode ruleset stacking), `45202c0764` (snapshot cleanup/auth and provider lifecycle), `648fa0a6a7` (failed-turn retry), `13a9673d08` (worktree references/recency), and other JetBrains/VS Code UI work. They must not be described as tests removed by this PR.

The more subtle shared-file case is pinned main's `packages/opencode/test/tool/task.test.ts:503-568`, which checks that synthetic/ignored trailing text does not replace the real subagent answer. Its three output assertions were added by main commit `bf7848cb48` and are already absent at the actual base. Likewise, compaction's `<previous-summary>` and retry's two-argument delay assertions differ between main and the actual base before this PR; the base has alternative compaction assertions and explicit deterministic jitter arguments. **Provenance: pre-existing stack/main divergence, not a merge-caused test loss.** Reconcile unrelated main changes in their appropriate later integration, not as a purported deletion fix here.

### 5. The omitted new upstream projector test conflicts with Kilo's retained compatibility contract

Pristine v1.18.20 adds `projects moved sessions without the transitional context epoch table` at upstream `packages/core/test/session-projector.test.ts:48-79`; it explicitly drops `session_context_epoch`. Kilo's projector test file is byte-identical across actual base, pinned main, and HEAD. Kilo still retains and resets that table for released-client compatibility (`packages/core/src/session/projector.ts:16,276,475`), and existing compatibility coverage still asserts released writes at `packages/core/test/kilocode/database-migration-compat.test.ts:137-181`.

**Provenance: a new upstream-only test not adopted for a deliberately different Kilo schema contract; no pre-existing Kilo test removed or weakened.** Static compatibility rationale only; this report does not validate the complete migration policy.

### 6. Test discovery and CI eligibility are preserved

The actual PR changes no workflows, runner/profile/shard helpers, preloads, Bun test configuration, or package test scripts. CLI package changes are dependency versions, not scheduling changes. `packages/opencode/script/test-runner.ts:154-186` still discovers `test/**/*.test.{ts,tsx}`, selects all tests by default, and retains its pre-existing OAuth-browser exclusion only. New Cerebras/error files match discovery. The runner's unsafe-file demotion changes isolation, not whether those files run (`packages/opencode/script/test-runner.ts:343-375`).

`.github/workflows/test.yml:212-228` continues to use the Kilo CLI `test:ci` runner, its existing Darwin profile, and full Linux/Windows shards. No new platform/profile gate disconnects Kilo tests. This was a static scheduling audit, not a complete CI execution.

## Command evidence and outputs

### Git inventories and controls

Commands below ran at the isolated review root. All Git comparisons use immutable commits, not a moving local `main`.

```sh
git diff --name-status --find-renames bf1cf502a3c511e9daf6a43244568ae4e83473a8 6a7d6bc002319ac2987bcde3d6c63efcafc07021
git diff --diff-filter=DR --name-status --find-renames bf1cf502a3c511e9daf6a43244568ae4e83473a8 6a7d6bc002319ac2987bcde3d6c63efcafc07021
git merge-base bf1cf502a3c511e9daf6a43244568ae4e83473a8 6a7d6bc002319ac2987bcde3d6c63efcafc07021
```

The deletion/rename command produced **no output**; the merge-base command returned:

```text
bf1cf502a3c511e9daf6a43244568ae4e83473a8
```

Read-only Python wrappers over `git diff`, `git ls-tree -r`, `git show`, and `git rev-parse` produced these exact summary/control outputs:

```text
All changed paths: {'M': 56, 'A': 3}
Test paths: {'M': 16, 'A': 2}
Reachable commits: 95
First-parent merges: 2
Kilo-named tracked test/fixture paths at base: 1243
Absent at HEAD: 0
Changed at HEAD: 0
Main-only absent test paths: 13
Codex Kilo model-filter assertions base/head: 9 9
Assertions byte-identical: True
Whole Kilo block identical ignoring whitespace/trailing commas: True
Flaky subagent case present at base/head: [False, False]
Retained Kilo auto-reject case present at base/head: [True, True]
Changed test-line totals: 18 files changed, 902 insertions(+), 140 deletions(-)
```

The formatting normalization above ignores whitespace and trailing commas, not assertion values or fixture identifiers. The assertion comparison is independently byte-identical.

```sh
git show --stat --oneline 62cb3f77bd
```

```text
62cb3f77bd test(opencode): remove flaky subagent test (#43819)
 packages/opencode/test/cli/run/run-process.test.ts | 44 ----------------------
 1 file changed, 44 deletions(-)
```

The complete removal hunk and its earlier addition were inspected. Endpoint blob control:

```sh
git rev-parse bf1cf502a3c511e9daf6a43244568ae4e83473a8:packages/opencode/test/cli/run/run-process.test.ts 6a7d6bc002319ac2987bcde3d6c63efcafc07021:packages/opencode/test/cli/run/run-process.test.ts 31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d:packages/opencode/test/cli/run/run-process.test.ts 7248bc1964b13fa67e601733f89ee9dc6dfa0563:packages/opencode/test/cli/run/run-process.test.ts
```

```text
5841afa60432b9409835f944586d2ded4d654e8a
5841afa60432b9409835f944586d2ded4d654e8a
bd5847e2723cfca944ef6f97e6d6fe3ff986c042
bd5847e2723cfca944ef6f97e6d6fe3ff986c042
```

### Focused execution

All commands below ran from `packages/opencode/` in the isolated review tree, with Bun **1.3.14 (0d9b296a)**. The unchanged test preload redirects XDG/test home and enforces an in-memory database. No live provider credentials or model calls were needed.

```sh
bun test ./test/tool/websearch.test.ts ./test/plugin/cloudflare.test.ts ./test/plugin/codex.test.ts
```

```text
bun test v1.3.14 (0d9b296a)
INFO  2026-08-27T14:16:39 +892ms service=plugin.codex refreshing codex access token

 38 pass
 0 fail
 78 expect() calls
Ran 38 tests across 3 files. [1.51s]
```

The refresh log is from the test's local fake OAuth server, not a real account refresh.

```sh
bun test ./test/provider/cf-ai-gateway-e2e.test.ts
```

```text
bun test v1.3.14 (0d9b296a)

 12 pass
 0 fail
 32 expect() calls
Ran 12 tests across 1 file. [1358.00ms]
```

```sh
bun test ./test/tool/task.test.ts --test-name-pattern 'resumable|platform attribution|forked|cost propagation|child cost|extended run|experiment is disabled|child prompt returns assistant error'
```

```text
bun test v1.3.14 (0d9b296a)

 13 pass
 19 filtered out
 0 fail
 34 expect() calls
Ran 13 tests across 1 file. [4.01s]
```

**Total: 63 passing tests, 144 `expect()` calls, zero failures; 19 intentionally filtered cases.** There were no failing tests requiring an isolated rerun or base failure-control execution. Historical controls were Git-object comparisons, not execution of historical checkouts.

### Final report validation

```sh
bun run script/check-md-table-padding.ts && git diff --exit-code && git rev-parse HEAD && git status --short
```

```text
check-md-table-padding: 403 file(s) checked, no padded tables found.
6a7d6bc002319ac2987bcde3d6c63efcafc07021
?? .review-config-r6/
?? OPENCODE_MENTIONS.md
?? TESTS.md
```

The tracked diff was empty. Other reviewers' untracked artifacts were left untouched.

## Limitations and integrity

- Static removal audit was primary. Did not run full package suites, subprocess permission tests, HTTP API exercisers, SDK generation/builds, lint/typecheck, or platform matrices; no source implementation was changed, and heavy pipeline verification belongs to other reviewers.
- Cloudflare tests use real transforms and SDK serialization but reconstruct routing in `gatewayModel` / `cfNpm` and stub the network boundary. They prove the stated wire assertions execute, not that every production routing/configuration path is covered. This limitation is not evidence of a removed Kilo test.
- Task tests use the existing prompt-operation stub while exercising the real task/session boundary. Their passing assertions do not substitute for the removed intermediate upstream subagent subprocess scenario.
- Local pinned refs and ancestry were verified. This lens did not independently fetch authoritative tags, refresh GitHub CI, or re-resolve a moving PR head; the parent reviewer owns those checks. Conclusions apply only to the exact reviewed SHA.
- Initial tracked and untracked status was clean. No source edits, dependency installs, commits, pushes, GitHub mutations, branch switches, or git-config changes were made by this reviewer. Only `TESTS.md` was intentionally written. A concurrent reviewer's `.review-config-r6/` directory appeared during review and was left untouched; shared-worktree untracked files are not evidence of this review modifying source.
