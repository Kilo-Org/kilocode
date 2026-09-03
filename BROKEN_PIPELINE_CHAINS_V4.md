# PR #13002 Merge Review (Round 4): Broken Pipeline Chains Audit

**Target PR:** [Kilo-Org/kilocode#13002](https://github.com/Kilo-Org/kilocode/pull/13002) — Merging OpenCode `v1.18.14..v1.18.15` into Kilo  
**Base Commit:** `aca225fcfd2ad5146f142a5d582f62c1dff12c35` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed PR Branch Head:** `860f5d9e680fb2a1b7c77913ba706419e44124b3` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Base Branch:** `origin/main`  
**Date:** 2026-08-19  

---

## 1. Scope and Methodology

This specialized Round 4 review audits PR #13002 for **broken end-to-end pipeline chains** across all architectural layers, with specific focus on recent invariant preservation fixes in commit `860f5d9e68` and core cross-layer execution pipelines:
- CLI Core & Effect services (`packages/opencode`)
- Server HTTP/SSE APIs, WebSocket tracking, and proxy middleware (`packages/opencode/src/server/`, `packages/opencode/src/kilocode/server/`)
- TUI SolidJS stores, keymap lookups, dialog selection, and reactive state synchronization (`packages/tui`, `packages/opencode/src/kilocode/cli/cmd/tui/`)
- ACP handlers, turn draining, and event subscriptions (`packages/opencode/src/acp/`)
- Session compaction, payload recovery, chunking fallbacks, and serialization (`packages/opencode/src/session/`, `packages/opencode/src/kilocode/session/`)
- Shared UI primitives, reactive tool state, and diff collapsing (`packages/session-ui`, `packages/kilo-ui`, `packages/ui`)
- Model-tool network sandbox enforcement (`script/check-model-tool-network.ts`)
- Upstream merge annotations, CI scripts, and transform tooling (`script/upstream/`, `script/check-opencode-annotations.ts`)

### Review Methodology
1. **Delta & Invariant Verification (Commit `860f5d9e68`):**
   - Verified reference identity scroll logic in `packages/tui/src/ui/dialog-select.tsx` when selecting duplicate item representations (`flat()[0] === selected()`).
   - Verified type and property access (`body.effective.permission.edit`) in `packages/opencode/test/kilocode/server/config-overlay.test.ts`.
   - Verified standalone TUI startup without OpenTUI dependencies in `packages/opencode/test/kilocode/cli/tui/thread.test.ts`.
   - Verified native MCP remote authority classification in `script/check-model-tool-network.ts` matching `SandboxPolicy.executeMcp(ctx.sessionID, entry, ...)`.
   - Verified upstream annotation check script regex updates and test cases in `packages/script/tests/check-opencode-annotations.test.ts`.
2. **End-to-End Tracing:**
   - Traced raw error propagation from `@ai-sdk/openai-compatible@2.0.48.patch` through `KiloSessionProcessor.blockRetry`, `SessionRetry.retryable`, `MessageV2.fromError`, and UI error toasts/displays (`isKiloError`).
   - Traced workspace proxying, bounded stream folding (65,536 char budget), and 5xx error body forwarding in `workspace-routing.ts` and `proxy.ts`.
   - Traced chronological message comparator sorting, 16-digit padded timestamp keys, and binary search hydration in `message-v2.ts`, `sync.tsx`, and `transcript.ts`.
   - Traced ACP turn draining, per-session generation counters, connection wait bounding, and promise rejection handling in `packages/opencode/src/acp/event.ts`.
   - Traced compaction payload recovery, prompt re-wrapping, tool output stripping (`part.state.time.compacted`), and serialization in `compaction-payload-recovery.ts` and `compaction.ts`.
   - Traced reactive cursor style propagation from declarative configuration (`packages/tui/src/config/index.tsx`, `tui-config.tsx`) and vim mode suppression in `packages/tui/src/component/prompt/index.tsx`.
   - Traced reactive `defaultOpen` synchronization in `basic-tool.tsx` and deletion-only diff auto-collapsing in `part-default-open.ts`.
3. **Automated Test & Static Analysis:**
   - Executed test suites across `packages/opencode`, `packages/tui`, `packages/session-ui`, `packages/kilo-ui`, `packages/kilo-vscode`, and root scripts.
   - Verified architecture guards (`check-model-tool-network`, `check-opencode-annotations --worktree`, `check-workflows`, `check-opencode-promise-facades`, `check-md-table-padding`, `knip`, and `check-kilocode-change`).

---

## 2. Prior Rounds Findings Resolution Status

| Finding ID | Severity | Description | Round 4 Status | Notes |
|---|---|---|---|---|
| **Round 1 - Finding 1** | Critical | `@ai-sdk/openai-compatible` patch version mismatch (`2.0.41.patch` vs `2.0.48` in `bun.lock`), causing syntax errors in `dist/index.mjs` | **RESOLVED** | Registered in `package.json` (`patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch`) and lockfile. Tested cleanly in all subsequent rounds. |
| **Round 1 - Finding 2 / Round 2 - Finding 1** | Medium | `WorktreeManager.resolveStartPoint` in `packages/kilo-vscode` fails remote tracking fetch when shell environment contains `GIT_CONFIG_COUNT` | **RESOLVED** | Fixed in `c24adedfa1`. `nonInteractiveEnv()` in `GitOps.ts` cleans all `GIT_CONFIG_*` environment variables. All 91 unit tests in `worktree-manager.test.ts` pass cleanly. |
| **Round 1 - Finding 3** | Informational | Sunsetting of `/kilocode/command/files` and command file management across CLI and JetBrains RPC | **RESOLVED / MAINTAINED** | Addressed in `c24adedfa1`. Backwards compatibility endpoints `/kilocode/command/files` and `/kilocode/command/remove` remain active and covered by tests. |

---

## 3. Findings (Broken or Degraded Chains)

**No open broken pipeline chains or regressions found in Round 4.**  
All critical, medium, and informational findings remain resolved, and commit `860f5d9e68` introduces no pipeline breakage.

---

## 4. Notable Non-Findings (Verified Intact Chains)

### 1. OpenAI-Compatible Streaming Error Preservation & Retry Pipeline
- **Chain:** `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` $\rightarrow$ `KiloSessionProcessor.blockRetry` $\rightarrow$ `SessionRetry.retryable` $\rightarrow$ `MessageV2.fromError` $\rightarrow$ UI error rendering.
- **Verification Details:**
  - `patches/@ai-sdk%2Fopenai-compatible@2.0.48.patch` replaces `error: chunk.value.error.message` with `error: chunk.value.error` across CJS, ESM (`dist/index.mjs`), and TypeScript source, preserving the full error payload.
  - Regarding other providers / unpatched copies: Only `@ai-sdk/openai-compatible` suffered from error object stringification that truncated nested code/type properties. Downstream providers (Alibaba, DeepInfra, TogetherAI, Venice, etc.) resolve through the patched `@ai-sdk/openai-compatible@2.0.48` instance in `bun.lock`.
  - In `packages/opencode/src/session/processor.ts`, `KiloSessionProcessor.blockRetry` sets `isRetryable: false` if output streaming already occurred (`attempt.text || attempt.reasoning || attempt.tool`).
  - In `packages/opencode/src/session/message-v2.ts`, `fromError` unwraps provider errors via `ProviderError.parseStreamError`, converting known status/code patterns to `APIError` or `ContextOverflowError`.
  - `SessionRetry.retryable` correctly suppresses retries on `isRetryable: false`, Kilo auth errors (`isKiloError`), and `FreeUsageLimitError`, while allowing retries for network disconnects (`SessionNetwork.disconnected`) and 5xx/429 rate limits.
  - **Verdict:** Fully intact. `bun test ./test/session/retry.test.ts ./test/session/processor-effect.test.ts` (70 pass) executes cleanly.

### 2. Server Workspace Proxying & 5xx Error Body Streaming Pipeline
- **Chain:** `packages/opencode/src/server/shared/workspace-routing.ts` $\rightarrow$ `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts` $\rightarrow$ `HttpServerResponse.text` / `HttpServerResponse.stream`.
- **Verification Details:**
  - Upstream 5xx error responses from remote workspace sandboxes are buffered using `Stream.decodeText()` and bounded strictly by a 65,536-character budget in `Stream.runFold`.
  - Stream draining avoids leaking connections.
  - The first 2,000 characters are logged via `Effect.logError` with method, URL, and status. Content-type is preserved or inferred, while transfer framing headers (`content-encoding`, `content-length`) are sanitized.
  - `workspaceProxyURL` in `workspace-routing.ts` strips host `directory` and `workspace` query parameters to prevent remote path corruption.
  - **Verdict:** Fully intact. `workspace-routing.test.ts` (18 pass), `httpapi-pty.test.ts` (9 pass), and `httpapi-ui.test.ts` (10 pass) pass cleanly.

### 3. Message Chronological Sorting and Sync Live Hydration Pipeline
- **Chain:** `packages/opencode/src/session/message-v2.ts` $\rightarrow$ `packages/tui/src/context/sync.tsx` $\rightarrow$ `packages/tui/src/util/transcript.ts` $\rightarrow$ `packages/session-ui/`.
- **Verification Details:**
  - `compareMessage` in `sync.tsx` sorts messages chronologically by `time.created` with an ID tiebreaker (`a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)`).
  - `messageKey` zero-pads timestamps to 16 digits (`String(message.time.created).padStart(16, "0") + message.id`), guaranteeing binary search alignment (`search(messages, messageKey(info), messageKey)`).
  - `formatTranscript` in `transcript.ts` enforces the same ordering contract using `messages.toSorted((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id))`.
  - **Verdict:** Fully intact. All 227 tests across 52 files in `packages/tui` pass cleanly.

### 4. ACP Service Turn Draining & Event Subscriptions Pipeline
- **Chain:** `packages/opencode/src/acp/event.ts` $\rightarrow$ `packages/opencode/src/acp/service.ts` $\rightarrow$ `packages/opencode/src/acp/usage.ts`.
- **Verification Details:**
  - `Subscription.runUntilIdle` correlates idle waiters with per-session generation counters (`this.idleCounters`), preventing race conditions where an idle event emitted during request execution is missed.
  - Idle waiting is bounded by a 60,000ms timeout in `Promise.race`, and connection waiting (`waitUntilConnected`) is bounded by 5,000ms; all timers are cleared in `finally` blocks.
  - Signal promises attach `.catch(() => {})` handlers to prevent unhandled rejection crashes when the stream disconnects.
  - Token usage accounting in `usage.ts` correctly tracks input tokens, cache reads, and cache writes.
  - **Verdict:** Fully intact. All 129 tests across 10 files in `packages/opencode/test/acp/` pass cleanly.

### 5. Compaction Payload Recovery and Serialization Pipeline
- **Chain:** `packages/opencode/src/session/compaction.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-payload-recovery.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-chunks.ts`.
- **Verification Details:**
  - `KiloCompactionPayloadRecovery.process` handles 4MB payload overflows matching `matches(error)` (`request entity too large|function_payload_too_large`).
  - `strip` marks completed tool parts with `part.state.time.compacted = Date.now()` and converts media files to placeholders.
  - On retry, serialization replaces compacted parts with `"[Old tool result content cleared]"`, shrinking the prompt below provider payload limits.
  - `KiloCompactionChunks` provides fallback chunked summarization when single-pass compaction cannot fit.
  - **Verdict:** Fully intact. `bun test --timeout 30000 ./test/session/compaction.test.ts` (61 pass, 1 skip) executes cleanly.

### 6. TUI Cursor Style Configuration & Vim Modal Interaction Pipeline
- **Chain:** `packages/tui/src/config/index.tsx` $\rightarrow$ `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` $\rightarrow$ `packages/tui/src/component/prompt/index.tsx`.
- **Verification Details:**
  - `TuiConfig.Cursor` schema supports `style` (`"block" | "underline" | "line" | "default"`) and `blinking` (`boolean`).
  - `KiloTuiConfig.makeStore` preserves and reconciles cursor settings during live config hot-reloading.
  - In `packages/tui/src/component/prompt/index.tsx`, `createEffect` and the prompt mount callback conditionally apply `input.cursorStyle = tuiConfig.cursor` only when `!vim.vimEnabled()`, ensuring vim modal cursor state transitions (`insert` vs `normal` mode) are not overridden.
  - **Verdict:** Fully intact. TUI configuration unit tests and TUI component test suites pass.

### 7. Reactive `defaultOpen` Synchronization & Deletion-Only Collapsing Pipeline
- **Chain:** `packages/session-ui/src/components/part-default-open.ts` $\rightarrow$ `packages/session-ui/src/components/basic-tool.tsx` $\rightarrow$ `packages/session-ui/src/components/message-part.tsx`.
- **Verification Details:**
  - `BasicTool` synchronizes `props.defaultOpen` into `state.open` via `createEffect(on(() => props.defaultOpen, (val) => { if (!userToggled && val !== undefined && props.open === undefined) setState("open", val) }))`.
  - `partDefaultOpen` inspects diff metadata and automatically collapses deletion-only diffs (`file.type === "delete"` or `filediff.additions === 0 && filediff.deletions > 0`) while leaving edit and write operations open.
  - **Verdict:** Fully intact. All 86 tests in `packages/session-ui` and 71 tests in `packages/kilo-ui/src/` pass.

### 8. Commit `860f5d9e68` Changes Verification
- **Verification Details:**
  - `packages/tui/src/ui/dialog-select.tsx`: `if (flat()[0] === selected()) scroll.scrollTo(0)` correctly verifies reference identity for the top item in select dialogs where values may be duplicated.
  - `packages/opencode/test/kilocode/server/config-overlay.test.ts`: Type assertion `body.effective.permission.edit` correctly resolves the overlay payload schema without null-coalescing workarounds.
  - `packages/opencode/test/kilocode/cli/tui/thread.test.ts`: Verified headless TUI thread execution without platform skips.
  - `script/check-model-tool-network.ts`: Verified regex matching `SandboxPolicy.executeMcp(ctx.sessionID, entry, ...)` to classify native MCP entry authority correctly under OpenCode v1.18.
  - `packages/script/tests/check-opencode-annotations.test.ts`: Added unit tests verifying regex matching for upstream merge compatibility branches.
  - **Verdict:** Fully verified. `check-model-tool-network.ts` reports 3 classified sites with 0 drift, and all touched test files pass.

---

## 5. Command Outputs and Verification Evidence

### Model-Tool Network Architecture Guard
```
$ bun run script/check-model-tool-network.ts
check-model-tool-network: 3 classified client site(s), policy-aware tool and MCP boundaries verified.
```

### CLI Session Retry & Processor Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/session/retry.test.ts ./test/session/processor-effect.test.ts
bun test v1.3.14 (0d9b296a)

 70 pass
 0 fail
 149 expect() calls
Ran 70 tests across 2 files. [36.79s]
```

### Server Workspace Routing & PTY Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/server/workspace-routing.test.ts ./test/server/httpapi-pty.test.ts ./test/server/httpapi-ui.test.ts
bun test v1.3.14 (0d9b296a)

 37 pass
 0 fail
 87 expect() calls
Ran 37 tests across 3 files. [22.26s]
```

### ACP Service Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/acp/
bun test v1.3.14 (0d9b296a)

 129 pass
 0 fail
 277 expect() calls
Ran 129 tests across 10 files. [2.41s]
```

### Session Compaction Tests (`packages/opencode`)
```
$ cd packages/opencode && bun test --timeout 30000 ./test/session/compaction.test.ts
bun test v1.3.14 (0d9b296a)

 61 pass
 1 skip
 0 fail
 165 expect() calls
Ran 62 tests across 1 file. [48.49s]
```

### Headless TUI Thread Test (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/kilocode/cli/tui/thread.test.ts
bun test v1.3.14 (0d9b296a)

 9 pass
 0 fail
 20 expect() calls
Ran 9 tests across 1 file. [5.96s]
```

### TUI Full Test Suite (`packages/tui`)
```
$ cd packages/tui && bun test
bun test v1.3.14 (0d9b296a)

 227 pass
 1 skip
 0 fail
 8 snapshots, 545 expect() calls
Ran 228 tests across 52 files. [5.96s]
```

### Session UI Tests (`packages/session-ui`)
```
$ cd packages/session-ui && bun test
bun test v1.3.14 (0d9b296a)

 86 pass
 0 fail
 189 expect() calls
Ran 86 tests across 14 files. [165.00ms]
```

### Kilo UI Source Tests (`packages/kilo-ui`)
```
$ cd packages/kilo-ui && bun test src/
bun test v1.3.14 (0d9b296a)

 71 pass
 0 fail
 133 expect() calls
Ran 71 tests across 9 files. [180.00ms]
```

### VS Code Worktree Manager Unit Tests (`packages/kilo-vscode`)
```
$ cd packages/kilo-vscode && bun test tests/unit/worktree-manager.test.ts
bun test v1.3.14 (0d9b296a)

 91 pass
 0 fail
 208 expect() calls
Ran 91 tests across 1 file. [29.97s]
```

### VS Code Extension Typecheck, Lint, Knip & Marker Checks
```
$ cd packages/kilo-vscode && bun run typecheck && bun run lint && bun run knip && bun run check-kilocode-change
check-types         | Done in 577ms
check-types:webview | Done in 1.01s
$ eslint --cache --cache-strategy content --cache-location node_modules/.cache/eslint src webview-ui
$ knip
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
```

### CI Guard Scripts & OpenCode Annotations
```
$ bun run script/check-workflows.ts
check-workflows: ok (29 workflows).

$ bun run script/check-opencode-promise-facades.ts
check-opencode-promise-facades: 6 classified runtime site(s), 79 classified test reference(s), no runtime drift found.

$ bun run script/check-md-table-padding.ts
check-md-table-padding: 415 file(s) checked, no padded tables found.

$ bun run script/check-opencode-annotations.ts --worktree
No shared upstream source files changed — nothing to check.

$ bun test ./packages/script/tests/check-opencode-annotations.test.ts
 174 pass
 0 fail
 215 expect() calls
Ran 174 tests across 1 file. [2.49s]
```

---

## 6. Limitations

1. **JetBrains Plugin Java Compilation:** Executing `./gradlew typecheck` requires Java 21; in this headless environment without pre-installed JDK 21, Kotlin RPC and model data bindings were validated via static interface and DTO structure analysis.
2. **Remote Live Sandboxes:** Cloud sandbox workspace routing (e.g., Daytona / Modal backends) was validated using integration unit tests, mock servers, and HTTP proxy stream fold tests rather than remote network instances.

---

## 7. Summary Verdict

The Round 4 audit confirms that **all pipeline chains across all architectural layers are fully intact and functional**:
- Commit `860f5d9e68` cleanly preserves merge invariants across `dialog-select.tsx`, `config-overlay.test.ts`, `thread.test.ts`, `check-model-tool-network.ts`, and upstream annotation tools without regressions.
- Streaming error preservation and retry backoff operate correctly with `@ai-sdk/openai-compatible@2.0.48.patch` and `SessionRetry.retryable`.
- Workspace proxying buffers 5xx upstream bodies within a strict 65,536-character budget without memory leaks.
- TUI chronological message ordering, 16-digit padded keys, and live binary search hydration are unified.
- ACP turn draining and connection wait bounding operate cleanly with per-session generation tracking.
- Compaction payload recovery and chunking fallback seamlessly handle serialized conversation histories.
- Cursor styling respects declarative user settings and yields cleanly to vim modal mode.
- Reactive `defaultOpen` synchronization and deletion-only diff collapsing function as intended.

**Overall Verdict: Ready for Merge.** PR #13002 is verified clean with zero broken pipeline chains.
