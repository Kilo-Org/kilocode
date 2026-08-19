# PR #13002 Merge Review (Round 3): Broken Pipeline Chains Audit

**Target PR:** [Kilo-Org/kilocode#13002](https://github.com/Kilo-Org/kilocode/pull/13002) — Merging OpenCode `v1.18.14..v1.18.15` into Kilo  
**Base Commit:** `aca225fcfd2ad5146f142a5d582f62c1dff12c35` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed PR Branch Head:** `6d8876045d4cf06272cfb355f2b18c74cdf3e967` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Base Branch:** `origin/main`  
**Date:** 2026-08-10  

---

## 1. Scope and Methodology

This specialized Round 3 review audits PR #13002 for **broken end-to-end pipeline chains** across all architectural layers:
- CLI Core & Effect services (`packages/opencode`)
- Server HTTP/SSE APIs, WebSocket tracking, and proxy middleware (`packages/opencode/src/server/`, `packages/opencode/src/kilocode/server/`)
- TUI SolidJS stores & reactive state synchronization (`packages/tui`)
- ACP handlers, turn draining, and event subscriptions (`packages/opencode/src/acp/`)
- Session compaction, recovery, and serialization (`packages/opencode/src/session/`, `packages/opencode/src/kilocode/session/`)
- Shared UI primitives, reactive tool state, and localization (`packages/session-ui`, `packages/kilo-ui`, `packages/ui`)
- Webview UI & VS Code extension host (`packages/kilo-vscode`)
- JetBrains plugin RPC contracts (`packages/kilo-jetbrains`)

### Review Methodology
1. **Delta & Fixup Verification:** Audited all commits up through PR head `6d8876045d` and fixup commit `c24adedfa1`, validating:
   - Git configuration environment sanitization in `nonInteractiveEnv()` and `WorktreeManager.refreshBase` (`packages/kilo-vscode`)
   - Generation-counter correlated ACP turn draining and bounded event waits in `packages/opencode/src/acp/event.ts`
   - Bounded character budget proxy 5xx error body buffering and stream draining in `proxy.ts`
   - Unified chronological message comparator and 16-digit padded key indexing in `sync.tsx`
   - Compaction payload recovery adaptation for serialized conversation history in `compaction-payload-recovery.ts`
   - Reactive `defaultOpen` state synchronization and deletion-only diff collapsing in `basic-tool.tsx` and `part-default-open.ts`
   - Persian (`fa`) localization dictionary merging and RTL text direction in `language.tsx` and `packages/kilo-ui/src/i18n/fa.ts`
2. **End-to-End Tracing:** Traced dataflow, error bubbling, promise cancellations, event subscriptions, binary search indices, and dictionary fallbacks across cross-package boundaries.
3. **Automated Test & Static Analysis:** Executed test suites across `packages/opencode`, `packages/tui`, `packages/session-ui`, `packages/kilo-ui`, and `packages/kilo-vscode`, alongside architecture guards (`check-opencode-annotations`, `check-workflows`, `check-opencode-promise-facades`, `check-md-table-padding`, `knip`, and `check-kilocode-change`).

---

## 2. Prior Rounds Findings Resolution Status

| Finding ID | Severity | Description | Round 3 Status | Notes |
|---|---|---|---|---|
| **Round 1 - Finding 1** | Critical | `@ai-sdk/openai-compatible` patch version mismatch (`2.0.41.patch` vs `2.0.48` in `bun.lock`), causing syntax errors in `dist/index.mjs` | **RESOLVED** | Fixed in `d2b37efbe5`. Added `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` and registered in `package.json` / `bun.lock`. Verified cleanly in Round 2 and Round 3. |
| **Round 1 - Finding 2 / Round 2 - Finding 1** | Medium | `WorktreeManager.resolveStartPoint` in `packages/kilo-vscode` fails remote tracking fetch when shell environment contains `GIT_CONFIG_COUNT` | **RESOLVED** | Fixed in `c24adedfa1`. `nonInteractiveEnv()` in `GitOps.ts` explicitly deletes `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_*`, and `GIT_CONFIG_VALUE_*`. `WorktreeManager.ts` routes fetch operations through `refreshBase(branch, remote)`. All 88 tests in `worktree-manager.test.ts` pass cleanly. |
| **Round 1 - Finding 3** | Informational | Sunsetting of `/kilocode/command/files` and command file management across CLI and JetBrains RPC | **RESOLVED / MAINTAINED** | Addressed in `c24adedfa1`. Restored `/kilocode/command/files` and `/kilocode/command/remove` endpoints in `packages/opencode/src/kilocode/server/httpapi/groups/kilocode.ts` and `packages/opencode/src/kilocode/command-files.ts` with full test coverage (`command-files.test.ts`), maintaining backwards compatibility for JetBrains RPC callers. |

---

## 3. Findings (Broken or Degraded Chains)

**No open broken pipeline chains or regressions found in Round 3.**  
All critical, medium, and informational findings from Rounds 1 and 2 have been fully resolved and verified.

---

## 4. Notable Non-Findings (Verified Intact Chains)

### 1. OpenAI-Compatible Streaming Error Preservation & Retry Pipeline
- **Chain:** `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` $\rightarrow$ `packages/opencode/src/session/processor.ts` (`KiloSessionProcessor.blockRetry`) $\rightarrow$ `packages/opencode/src/session/retry.ts` (`retryable` & `policy`) $\rightarrow$ Session UI error handling.
- **Verification Details:**
  - `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` preserves raw provider error objects in the stream controller enqueue.
  - `KiloSessionProcessor.blockRetry` sets `isRetryable: false` when an error occurs after partial text, reasoning, or tool output.
  - `SessionRetry.retryable` prevents futile retry loops on interrupted turns, Kilo authentication errors (`isKiloError`), and `FreeUsageLimitError`, while retrying 5xx server errors, rate limits, and network disconnects (`SessionNetwork.disconnected`).
  - **Verdict:** Fully intact. `bun test ./test/session/retry.test.ts ./test/session/processor-effect.test.ts` (70 pass) executes cleanly.

### 2. Server Workspace Proxying & 5xx Error Body Streaming Pipeline
- **Chain:** `packages/opencode/src/server/shared/workspace-routing.ts` $\rightarrow$ `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts` $\rightarrow$ `HttpServerResponse.text` / `HttpServerResponse.stream`.
- **Verification Details:**
  - Upstream 5xx error responses from remote workspace sandboxes are buffered using `Stream.decodeText()` and `Stream.runFold` bounded strictly by a 65,536-character budget.
  - Stream continues draining to avoid dangling socket connections.
  - The first 2,000 characters are logged to the host's log via `Effect.logError`, content type is preserved/inferred, and headers (`content-encoding`, `content-length`) are sanitized.
  - `workspaceProxyURL` in `workspace-routing.ts` strips host `directory` and `workspace` query parameters to prevent remote path corruption.
  - **Verdict:** Fully intact. `workspace-routing.test.ts` (18 pass), `httpapi-pty.test.ts` (9 pass), and `httpapi-ui.test.ts` (10 pass) pass cleanly.

### 3. Message Chronological Sorting and Sync Live Hydration Pipeline
- **Chain:** `packages/opencode/src/session/message-v2.ts` $\rightarrow$ `packages/tui/src/context/sync.tsx` $\rightarrow$ `packages/tui/src/routes/session/index.tsx` $\rightarrow$ `packages/session-ui/`.
- **Verification Details:**
  - `compareMessage` sorts by `time.created` with ID tie-breaker: `a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)`.
  - `messageKey` formats the timestamp with 16-digit zero padding: `String(message.time.created).padStart(16, "0") + message.id`.
  - Binary search key comparisons (`search(messages, messageKey(info), messageKey)`) strictly align with comparator sorting, ensuring deterministic insert order during live SSE sync hydration.
  - 100-message sliding window eviction, live streaming part updates, and session switching are fully coordinated.
  - **Verdict:** Fully intact. All 219 tests in `packages/tui` pass cleanly.

### 4. ACP Service Turn Draining & Event Subscription Wait Bounding Pipeline
- **Chain:** `packages/opencode/src/acp/event.ts` $\rightarrow$ `packages/opencode/src/acp/service.ts` $\rightarrow$ `packages/opencode/src/acp/usage.ts`.
- **Verification Details:**
  - `Subscription.runUntilIdle` correlates idle waiters with per-session generation counters (`this.idleCounters`), preventing race conditions where an idle event emitted during request execution is missed.
  - Idle waiting is bounded by a 60,000ms timeout in `Promise.race`, and connection waiting (`waitUntilConnected`) is bounded by 5,000ms; all timers are cleared in `finally` blocks.
  - Signal promises attach `.catch(() => {})` handlers to prevent unhandled rejection crashes when the stream disconnects.
  - Token usage accounting in `usage.ts` correctly includes input tokens, cache reads, and cache writes.
  - **Verdict:** Fully intact. All 129 tests across 10 files in `packages/opencode/test/acp/` pass cleanly.

### 5. Compaction Payload Recovery and Serialization Pipeline
- **Chain:** `packages/opencode/src/session/compaction.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-payload-recovery.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-chunks.ts`.
- **Verification Details:**
  - Upstream compaction prompt serialization (`serialize(message)`) is supported by `KiloCompactionPayloadRecovery.process`.
  - On 4MB payload overflow (`matches(error)`), `strip` marks completed tool parts with `part.state.time.compacted = Date.now()` and strips media. On retry, `serialize` outputs `"[Old tool result content cleared]"`, shrinking the request body below provider limits.
  - `KiloCompactionChunks.needed` / `KiloCompactionChunks.eligible` continues to provide chunked summarization fallback for oversized contexts.
  - **Verdict:** Fully intact. `bun test ./test/session/compaction.test.ts` (61 pass, 1 skip) passes cleanly.

### 6. Reactive `defaultOpen` Synchronization in `basic-tool.tsx`
- **Chain:** `packages/session-ui/src/components/part-default-open.ts` $\rightarrow$ `packages/session-ui/src/components/basic-tool.tsx` $\rightarrow$ `packages/kilo-ui/src/components/basic-tool.tsx` $\rightarrow$ `packages/session-ui/src/components/message-part.tsx`.
- **Verification Details:**
  - `packages/session-ui/src/components/basic-tool.tsx` synchronizes `props.defaultOpen` into `state.open` via `createEffect(on(() => props.defaultOpen, ...))` when `!userToggled && val !== undefined && props.open === undefined`.
  - When tool parts transition from running/pending to completed or receive asynchronous metadata, the open state updates reactively without overriding explicit user toggle actions.
  - `partDefaultOpen` automatically collapses deletion-only diffs (`file.type === "delete"` or `additions === 0 && deletions > 0`) while keeping edit and shell tools open.
  - `packages/kilo-ui/src/components/basic-tool.tsx` integrates with `tool-open-state` and renders `ToolApprovalLine` seamlessly.
  - **Verdict:** Fully intact. All 86 tests in `packages/session-ui` and 60 tests in `packages/kilo-ui/src/` pass.

### 7. Persian Localization Dictionary Merging in Webview UI
- **Chain:** `packages/ui/src/i18n/fa.ts` $\rightarrow$ `packages/kilo-ui/src/i18n/fa.ts` $\rightarrow$ `packages/kilo-vscode/webview-ui/src/context/language.tsx`.
- **Verification Details:**
  - Upstream Persian dictionary in `@opencode-ai/ui/i18n/fa` is re-exported via `packages/kilo-ui/src/i18n/fa.ts`.
  - In `packages/kilo-vscode/webview-ui/src/context/language.tsx`, `dicts.fa` merges `{ ...base, ...appFa, ...uiFa, ...amEn, ...amFa }`, providing complete dictionary coverage with English fallback for un-overridden Kilo keys.
  - `LOCALE_LABELS.fa = "فارسی"`, and `RTL_LOCALES.has("fa")` sets `<html dir="rtl">` and `lang="fa"`.
  - **Verdict:** Fully intact. Extension typecheck and ESLint checks pass with 0 errors.

### 8. Agent Manager Branch Start Point Resolution Pipeline
- **Chain:** `packages/kilo-vscode/src/agent-manager/WorktreeManager.ts` $\rightarrow$ `packages/kilo-vscode/src/agent-manager/GitOps.ts` (`nonInteractiveEnv`) $\rightarrow$ `simpleGit.fetch`.
- **Verification Details:**
  - `nonInteractiveEnv()` in `GitOps.ts` sanitizes `GIT_CONFIG_COUNT` as well as all keys matching `GIT_CONFIG_KEY_*` and `GIT_CONFIG_VALUE_*`.
  - `WorktreeManager.ts` routes fetch operations through `refreshBase(branch, remote)` using `nonInteractiveEnv()`.
  - When executed in environments with injected Git configuration variables, `simpleGit.fetch` succeeds without triggering security validator errors, populating `WorktreeManager.fetchCache` and resolving remote tracking refs (`{ source: "remote" }`).
  - **Verdict:** Fully intact. All 88 tests in `packages/kilo-vscode/tests/unit/worktree-manager.test.ts` pass cleanly.

---

## 5. Command Outputs and Verification Evidence

### CLI Session & Retry Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/session/retry.test.ts ./test/session/processor-effect.test.ts
bun test v1.3.14 (0d9b296a)

 70 pass
 0 fail
 149 expect() calls
Ran 70 tests across 2 files. [29.72s]
```

### Server Workspace Routing & PTY Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test --timeout 30000 ./test/server/workspace-routing.test.ts ./test/server/httpapi-pty.test.ts ./test/server/httpapi-ui.test.ts
bun test v1.3.14 (0d9b296a)

 37 pass
 0 fail
 87 expect() calls
Ran 37 tests across 3 files. [37.29s]
```

### Compaction Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test --timeout 30000 ./test/session/compaction.test.ts
bun test v1.3.14 (0d9b296a)

 61 pass
 1 skip
 0 fail
 165 expect() calls
Ran 62 tests across 1 file. [66.03s]
```

### ACP Service Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/acp/
bun test v1.3.14 (0d9b296a)

 129 pass
 0 fail
 277 expect() calls
Ran 129 tests across 10 files. [3.10s]
```

### Full TUI Test Suite (`packages/tui`)
```
$ cd packages/tui && bun test
bun test v1.3.14 (0d9b296a)

 219 pass
 1 skip
 0 fail
 8 snapshots, 523 expect() calls
Ran 220 tests across 50 files. [7.80s]
```

### Session UI Tests (`packages/session-ui`)
```
$ cd packages/session-ui && bun test
bun test v1.3.14 (0d9b296a)

 86 pass
 0 fail
 189 expect() calls
Ran 86 tests across 14 files. [193.00ms]
```

### Kilo UI Source Tests (`packages/kilo-ui`)
```
$ cd packages/kilo-ui && bun test src/
bun test v1.3.14 (0d9b296a)

 60 pass
 0 fail
 100 expect() calls
Ran 60 tests across 8 files. [141.00ms]
```

### VS Code Extension Worktree Manager Tests (`packages/kilo-vscode`)
```
$ cd packages/kilo-vscode && bun test tests/unit/worktree-manager.test.ts
bun test v1.3.14 (0d9b296a)

 88 pass
 0 fail
 202 expect() calls
Ran 88 tests across 1 file. [27.99s]
```

### VS Code Extension Full Unit Test Suite (`packages/kilo-vscode`)
```
$ cd packages/kilo-vscode && bun test tests/unit/
bun test v1.3.14 (0d9b296a)

 3809 pass
 0 fail
 16531 expect() calls
Ran 3809 tests across 322 files. [103.88s]
```

### VS Code Extension Typecheck & Lint (`packages/kilo-vscode`)
```
$ cd packages/kilo-vscode && bun run typecheck && bun run lint
$ bun run --parallel check-types check-types:webview
check-types         | Done in 1.12s
check-types:webview | Done in 1.79s
$ eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint src webview-ui
```

### Repository Guards & Architecture Validation
```
$ bun run script/check-opencode-annotations.ts --worktree
No shared upstream source files changed — nothing to check.

$ bun run script/check-workflows.ts
check-workflows: ok (29 workflows).

$ bun run script/check-opencode-promise-facades.ts
check-opencode-promise-facades: 6 classified runtime site(s), 77 classified test reference(s), no runtime drift found.

$ bun run script/check-md-table-padding.ts
check-md-table-padding: 405 file(s) checked, no padded tables found.

$ cd packages/kilo-vscode && bun run knip
$ knip
(0 unused exports)

$ cd packages/kilo-vscode && bun run check-kilocode-change
(0 unannotated changes in Kilo code)
```

---

## 6. Limitations

1. **JetBrains Plugin Compilation:** Live execution of `./gradlew typecheck` requires Java 21; because the Java runtime is not pre-installed in this headless environment, Kotlin DTO mappings and RPC interfaces were verified via static analysis and mock backend tests.
2. **Live Remote Cloud Workspaces:** Workspace proxying against remote cloud sandboxes (e.g. Daytona / Modal) was verified via unit tests, mock servers, and static analysis rather than live remote network instances.

---

## 7. Summary Verdict

The Round 3 audit confirms that **all pipeline chains across all architectural layers are fully intact and functional**:
- **All previous findings are resolved**:
  - Patch version compatibility (`@ai-sdk/openai-compatible@2.0.48.patch`) is fixed and verified.
  - `WorktreeManager.resolveStartPoint` Git config environment variable sanitization is implemented and passes all unit tests.
  - `/kilocode/command/files` compatibility routes and tests are restored.
- **Critical pipelines verified**:
  - Streaming error preservation and retry backoff operate correctly.
  - 5xx error body buffering in the workspace proxy is bounded and leak-free.
  - TUI chronological message ordering, binary search indexing, and live SSE sync hydration are unified.
  - ACP turn draining and connection wait bounding operate cleanly with per-session generation tracking.
  - Compaction payload recovery and chunking fallback seamlessly handle serialized conversation histories.
  - Reactive `defaultOpen` synchronization in `BasicTool` and deletion-only diff collapsing function as intended.
  - Persian localization dictionary merging and RTL direction are wired across webview UI and UI libraries.

**Overall Verdict: Ready for Merge.** PR #13002 is verified clean with zero broken pipeline chains.
