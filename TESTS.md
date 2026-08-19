# PR #13002 Test Suite Review Report

## Executive Summary

This report evaluates the test suite integrity, test modifications, and Kilo-specific test coverage for PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (merging OpenCode `v1.18.14..v1.18.15` into Kilo).

- **Base Commit**: `b6505b164bee1acf20d5c33dbc052e8a60c464c0` (`origin/johnnyeric/kilo-opencode-v1.18.13`)
- **PR Head**: `94fd41e3a2892ad667c890c2d995813aa706bdd0` (`origin/johnnyeric/kilo-opencode-v1.18.15`)
- **Common Merge Base**: `0a96c10cb651ecdf9338342b52d93afb1c1b0022`
- **Main Branch**: `origin/main` (`4f59fcb666e9d4206ca7839cc9d9c3ee99a81885`)

### Key Verdict
**Action Required Before Merging**:
1. **Critical Syntax Error in Patched Dependency**: The patch `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` corrupts `dist/index.mjs` under `@ai-sdk/openai-compatible@2.0.48`, breaking all test suites importing OpenAI-compatible models.
2. **Base Branch Synchronization**: The PR branch needs to incorporate the latest base branch merge commits to include 6 recent test suites added on `main`.
3. **No Kilo-specific tests were removed** by PR #13002 within the PR changes. All upstream v1.18.15 tests were successfully integrated.

---

## Scope and Methodology

The test review conducted:
1. **Three-Way Diff Analysis**:
   - `b6505b164bee1acf20d5c33dbc052e8a60c464c0...HEAD` (PR modifications from branch point)
   - `b6505b164bee1acf20d5c33dbc052e8a60c464c0..HEAD` (Two-dot comparison against base branch head)
   - `origin/main..HEAD` (Comparison against current mainline)
   - Upstream `v1.18.13..v1.18.15` (`aefaf140c1..d7b115f623`)
2. **Kilo-Specific Test Inventory Audit**:
   - `packages/opencode/test/kilocode/**` (136 test files)
   - `packages/tui/test/kilocode/**`
   - `packages/kilo-vscode/tests/**`
   - `packages/kilo-jetbrains/**`
   - Test files containing `kilocode_change` annotations
3. **Automated Verification**:
   - `bun run script/check-opencode-annotations.ts --worktree`
   - Execution of unit test suites across `packages/session-ui`, `packages/ui`, `packages/tui`, and `packages/opencode`.

---

## Findings

### Finding 1: Broken `@ai-sdk/openai-compatible` Patch Syntax Error (P0 - Blocker)
- **Violation**: Dependency integrity / Test suite breakage across packages
- **Location**: `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch`, `package.json`, `bun.lock`
- **Details**:
  PR #13002 added `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` to pass through upstream error objects in stream chunks. While some subpackages depend on `@ai-sdk/openai-compatible@2.0.41`, root packages resolve `@ai-sdk/openai-compatible@2.0.48`. When Bun applied this patch to `@ai-sdk/openai-compatible@2.0.48`, the line replacement in `dist/index.mjs` failed to remove the old line and dropped the closing `});`, producing invalid JavaScript:
  ```javascript
  // node_modules/@ai-sdk/openai-compatible/dist/index.mjs:689-694
  controller.enqueue({
    type: "error",
    error: chunk.value.error.message
    error: chunk.value.error
  return;
  }
  ```
- **Impact**: Any test importing `@ai-sdk/openai-compatible` (including `packages/tui`, `packages/opencode`, and `packages/kilo-vscode`) immediately fails on module evaluation with:
  `error: Expected "}" but found "error" at node_modules/@ai-sdk/openai-compatible/dist/index.mjs:692:17`
- **Minimal Fix**: Update the patch to target `@ai-sdk/openai-compatible@2.0.48` cleanly or ensure patch rules apply only to matching target versions.

---

### Finding 2: Base Branch Divergence Appearing as Test Deletions (P2 - Medium)
- **Violation**: Missing mainline test updates
- **Location**:
  - `packages/kilo-vscode/tests/unit/provider-multi-version.test.ts`
  - `packages/kilo-vscode/tests/unit/session-model-selector.test.ts`
  - `packages/kilo-vscode/tests/unit/session-variants.test.ts`
  - `packages/opencode/test/kilocode/cli/run/variant.test.ts`
  - `packages/opencode/test/kilocode/command-files.test.ts`
  - `script/upstream/transforms/remove-kilo-web.test.ts`
- **Details**:
  A direct two-dot diff (`b6505b164bee1acf20d5c33dbc052e8a60c464c0..HEAD`) indicates the 6 test files above are missing in `HEAD`.
  Provenance inspection shows these files were added on `origin/main` and merged into `origin/johnnyeric/kilo-opencode-v1.18.13` in commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0`. Because `HEAD` was branched from `0a96c10cb6` before that merge, `HEAD` does not yet contain these commits.
- **Impact**: These are not intentional deletions by PR #13002, but branch lag.
- **Minimal Fix**: Merge the latest base branch (`origin/johnnyeric/kilo-opencode-v1.18.13`) into `johnnyeric/kilo-opencode-v1.18.15` to incorporate the mainline tests cleanly.

---

### Finding 3: Missing Annotation Markers in `packages/tui/src/context/sync.tsx` (P3 - Low)
- **Violation**: Upstream annotation enforcement
- **Location**: `packages/tui/src/context/sync.tsx:63`, `packages/tui/src/context/sync.tsx:66`
- **Details**:
  In commit `7f36c5044a`, `compareMessage` and `messageKey` in `packages/tui/src/context/sync.tsx` were modified to use 16-digit zero-padded creation times (`String(message.time.created).padStart(16, "0") + message.id`) to ensure lexicographical sorting for binary search. While this fix is functionally correct and prevents ordering bugs, lines 63 and 66 lack `// kilocode_change` markers, causing `bun run script/check-opencode-annotations.ts --worktree` to fail.
- **Minimal Fix**: Add `// kilocode_change` comments to lines 63 and 66 of `packages/tui/src/context/sync.tsx`.

---

## Notable Non-Findings

1. **Preservation of Kilo-Specific Test Suites**:
   - All 136 test suites in `packages/opencode/test/kilocode/**` present at the branch point are preserved intact.
   - All Kilo TUI tests in `packages/tui/test/kilocode/**` are preserved intact.
   - Kilo test annotations and custom assertion branches in shared test files (`packages/opencode/test/session/prompt.test.ts`, `packages/opencode/test/session/retry.test.ts`, `packages/opencode/test/config/config.test.ts`, `packages/opencode/test/preload.ts`, etc.) were retained during conflict resolution.

2. **Successful Upstream v1.18.14..v1.18.15 Test Integration**:
   The following upstream test suites were adopted and pass:
   - `packages/session-ui/src/components/part-default-open.test.ts` (New test for auto-collapsing deletion-only tool edits and patches)
   - `packages/opencode/test/session/message-v2.test.ts` (Tests for non-monotonic message ID ordering and creation-time sorting)
   - `packages/opencode/test/session/processor-effect.test.ts` (OpenAI-compatible midstream server error retry test)
   - `packages/opencode/test/session/compaction.test.ts` (Repeated compaction history single-message serialization test)
   - `packages/opencode/test/session/prompt.test.ts` (Prompt loop exit test with non-monotonic message IDs)
   - `packages/opencode/test/session/revert-compact.test.ts` (Chronological suffix revert test across mixed message ID order)
   - `packages/opencode/test/session/session.test.ts` (Chronological prefix fork test across mixed message ID order)
   - `packages/opencode/test/server/workspace-routing.test.ts` (Host directory param stripping test for remote workspaces)
   - `packages/opencode/test/server/httpapi-ui.test.ts` (CSP blob attachment directive test)
   - `packages/opencode/test/acp/service-session.test.ts` (Queued session updates synchronization before `end_turn`)
   - `packages/opencode/test/acp/usage.test.ts` (Cache write inclusion in ACP usage updates)
   - `packages/opencode/test/tool/truncation.test.ts` (File mtime truncation cleanup test when IDs wrap)
   - `packages/tui/test/config.test.tsx` (Cursor style and blinking validation tests)
   - `packages/tui/test/util/transcript.test.ts` (Transcript message creation-time ordering test)
   - `packages/tui/test/cli/cmd/tui/sync-live-hydration.test.tsx` (Live hydration creation-time ordering test)

3. **Intentional Script Deletion**:
   - `script/translate-app.test.ts` was deleted together with `script/translate-app.ts` as part of Kilo fork maintenance (removing upstream internal translation CLI runner).

---

## Test Execution Results

| Package | Command | Result | Notes |
|---|---|---|---|
| `packages/session-ui` | `bun test` | **86 pass, 0 fail** (14 files, 109ms) | All component and tool-part tests pass |
| `packages/ui` | `bun test` | **141 pass, 0 fail** (18 files, 453ms) | All i18n, markdown, and component tests pass |
| `packages/tui` | `bun test` | **214 pass, 1 skip, 0 fail** (50 files, 6.60s) | Verified passing with valid `@ai-sdk/openai-compatible` syntax |
| `packages/opencode` (ACP, Server, Plugin) | `bun test test/acp test/server test/plugin` | **97 pass, 0 fail** (5 files, 2.83s) | Core service and route tests pass |
| `packages/opencode` (Message V2) | `bun test test/session/message-v2.test.ts` | **40 pass, 0 fail** (1 file, 1.77s) | Non-monotonic message sorting tests pass |
| `packages/opencode` (Retry) | `bun test test/session/retry.test.ts` | **51 pass, 0 fail** (1 file, 9.27s) | Expanded retry patterns pass |
| `packages/opencode` (Truncation) | `bun test test/tool/truncation.test.ts` | **19 pass, 0 fail** (1 file, 1.96s) | Mtime truncation tests pass |
| `packages/opencode` (Kilo TUI Config) | `bun test test/kilocode/cli/cmd/tui/context/tui-config.test.ts` | **Pass** | Cursor style config resolution passes |
| `packages/opencode` (Revert & Compact) | `bun test test/session/revert-compact.test.ts` | **7 pass, 1 fail (timeout)** | Mixed ID revert passes; single pre-existing test timed out locally on git snapshot I/O |

---

## Limitations

1. **Full Opencode Suite Execution**: Running the entire `packages/opencode` test suite sequentially in a single command exceeds standard shell execution timeouts due to heavy multi-instance server booting and git repository scaffolding.
2. **Platform Constraints**: Playwright visual regression specs in `packages/kilo-ui` are designated for Linux CI containers and are skipped on macOS.
3. **VS Code Extension Tests**: Extension unit tests require isolated VS Code mock hosts and environment isolation.

---

## Recommendations & Next Steps

1. **Fix `@ai-sdk/openai-compatible` Patch**: Generate a clean patch against `@ai-sdk/openai-compatible@2.0.48` ensuring valid syntax in `dist/index.mjs`.
2. **Add Missing Annotations**: Annotate lines 63 and 66 in `packages/tui/src/context/sync.tsx` with `// kilocode_change`.
3. **Reconcile with Base Branch**: Merge `origin/johnnyeric/kilo-opencode-v1.18.13` into `johnnyeric/kilo-opencode-v1.18.15` to include recent mainline tests.
