# PR #13002 Merge Review: Broken Pipeline Chains Audit

**Target PR:** [Kilo-Org/kilocode#13002](https://github.com/Kilo-Org/kilocode/pull/13002) — Merging OpenCode `v1.18.14..v1.18.15` into Kilo  
**Base Commit:** `b6505b164bee1acf20d5c33dbc052e8a60c464c0` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch:** `HEAD` / `origin/johnnyeric/kilo-opencode-v1.18.15`  
**Base Branch:** `origin/main`  
**Date:** 2026-08-07  

---

## 1. Scope and Methodology

This specialized code review audits PR #13002 for **broken end-to-end pipeline chains** — subtle regressions where custom Kilo functionality spans multiple architectural layers (CLI core, Effect services, server HTTP/SSE APIs, TUI SolidJS stores, ACP handlers, and the VS Code extension), and where upstream merge changes or partial refactors may have severed an intermediate link while still allowing TypeScript compilation.

### Methodology
1. **Upstream Delta Analysis:** Examined all upstream commits in `v1.18.14..v1.18.15` (e.g., compaction history serialization `#40800`, stream error preservation `#40718`, ACP turn drain `#40422`, cursor style configuration `#32295`, chronological message ordering `#40990`/`#40991`/`#40994`/`#41001`/`#41006`, and workspace proxying `#40135`/`#40136`).
2. **End-to-End Tracing:** Traced data flow, parameter propagation, event emission/consumption, and type transformations across all `kilocode_change` annotations touched by the merge.
3. **Execution & Test Verification:** Executed targeted unit and integration test suites across `packages/opencode`, `packages/tui`, `packages/session-ui`, and `packages/kilo-vscode` to verify runtime behavior.
4. **Boundary Verification:** Audited critical cross-package boundaries including:
   - Compaction payload recovery, chunking, and serialization (`packages/opencode/src/session/compaction.ts`, `compaction-payload-recovery.ts`, `compaction-chunks.ts`)
   - TUI configuration resolution, reactive store reconciliation, and terminal cursor styling (`packages/tui/src/config/`, `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`)
   - Message chronological sorting, revert boundaries, and transcript exports (`packages/session-ui/`, `packages/tui/`, `packages/opencode/src/session/`)
   - ACP event subscription, drain-until-idle synchronization, and interactive permission reply routing (`packages/opencode/src/acp/`)
   - Server workspace proxying, directory parameter sanitization, and worktree routing (`packages/opencode/src/server/`)

---

## 2. Findings (Broken or Degraded Chains)

### Finding 1 (Critical): Patch `@ai-sdk/openai-compatible@2.0.41.patch` Incompatible With Resolved Version `2.0.48`, Producing Corrupted `dist/index.mjs` Syntax Error

- **Chain Affected:** OpenAI-compatible streaming error preservation & retry pipeline (`patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` $\rightarrow$ `@ai-sdk/openai-compatible` $\rightarrow$ `packages/opencode/src/session/retry.ts` / `processor-effect.ts`).
- **Where Introduced:** Upstream PR #40718 / commit `709c195905` added a patch file targeting `@ai-sdk/openai-compatible@2.0.41` to pass raw error objects to the stream controller.
- **Root Cause & Mechanism:**
  1. `package.json` specifies `"@ai-sdk/openai-compatible@2.0.41": "patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch"` in `patchedDependencies`.
  2. However, the root workspace resolves `@ai-sdk/openai-compatible@2.0.48` in `bun.lock`.
  3. When Bun applies `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` against `@ai-sdk/openai-compatible@2.0.48`, the diff hunk fails to match cleanly. Bun inserts `error: chunk.value.error` without deleting `error: chunk.value.error.message` and omits the closing `});`, generating invalid JavaScript in `node_modules/@ai-sdk/openai-compatible/dist/index.mjs`:
     ```javascript
     if ("error" in chunk.value) {
       finishReason = { unified: "error", raw: void 0 };
       controller.enqueue({
         type: "error",
         error: chunk.value.error.message
         error: chunk.value.error
       return;
     }
     ```
  4. **Impact:** Any module importing `@ai-sdk/openai-compatible` (or modules that transitively import provider definitions, including `packages/opencode/src/index.ts` and test runners) immediately throws a `SyntaxError: Expected "}" but found "error"`, crashing test suites and breaking OpenAI-compatible streaming provider initialization.
- **Recommended Fix:** Update the patch file for `@ai-sdk/openai-compatible@2.0.48` (or update `package.json` / `bun.lock` to ensure patch version matches the resolved package version).

---

### Finding 2 (Medium): `WorktreeManager.resolveStartPoint` In `packages/kilo-vscode` Fails Remote Tracking Fetch When Shell Environment Contains `GIT_CONFIG_COUNT`

- **Chain Affected:** Agent Manager branch start point resolution pipeline (`WorktreeManager.resolveStartPoint` $\rightarrow$ `simpleGit.fetch` $\rightarrow$ `WorktreeManager.refExistsLocally` $\rightarrow$ remote branch selection).
- **Where Introduced:** `packages/kilo-vscode/src/agent-manager/WorktreeManager.ts` (lines 771–789).
- **Root Cause & Mechanism:**
  1. `resolveStartPoint(branch)` builds a non-interactive environment using `nonInteractiveEnv()`:
     ```typescript
     const env = nonInteractiveEnv()
     await simpleGit(this.root, { unsafe: { allowUnsafeSshCommand: isKiloOwnedSshCommand(env) } })
       .env(env)
       .fetch(remote, branch, { "--quiet": null, "--no-tags": null })
     ```
  2. When executed inside environments where Git configuration variables are passed via environment (e.g. `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_*` set by subagents, IDEs, or CI wrappers), `simple-git`'s security validator throws:
     `GitPluginError: Use of "GIT_CONFIG_COUNT" is not permitted without enabling allowUnsafeConfigEnvCount`.
  3. The `try/catch` block catches this error, logs `Failed to fetch origin/main`, and skips setting `WorktreeManager.fetchCache`.
  4. Execution then falls through to Step 2 (stale local tracking branch) returning `{ source: "local-tracking", warning: "Used stale remote tracking branch (fetch failed)" }` instead of `{ source: "remote" }`.
  5. **Impact:** When starting new worktrees in environments with Git config environment variables, Agent Manager silently falls back to stale local tracking refs and logs fetch warnings, and unit test `WorktreeManager.resolveStartPoint > returns bare branch + remote when remote exists` fails.
- **Recommended Fix:** In `packages/kilo-vscode/src/agent-manager/WorktreeManager.ts`, configure `simpleGit` with `unsafe: { allowUnsafeSshCommand: isKiloOwnedSshCommand(env), allowUnsafeConfigEnvCount: true }` or clean `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` in `nonInteractiveEnv()`.

---

### Finding 3 (Low / Informational): Sunsetting of `/kilocode/command/files` and Command File Management Endpoints Across CLI and JetBrains RPC

- **Chain Affected:** Command file configuration & management pipeline (`/kilocode/command/files`, `/kilocode/command/remove`, `KiloAgentBehaviorRpcApi.commandFiles`).
- **Where Introduced:** Commit `7f36c5044a` removed `packages/opencode/src/kilocode/command-files.ts`, `/kilocode/command/files` and `/kilocode/command/remove` routes from `packages/opencode/src/kilocode/server/httpapi/groups/kilocode.ts`, SDK generated methods in `@kilocode/sdk`, and JetBrains backend `KiloAgentBehaviorRpcApiImpl.kt` methods (`commandFiles`, `removeCommand`, `saveCommands`).
- **Chain Verification:**
  1. Traced both ends of the pipeline: the server endpoints and the client RPC callers were removed in lockstep.
  2. Standard `/command` listing and command execution pipelines remain fully functional.
  3. No dangling unhandled RPC requests or orphaned callers were found in `packages/kilo-vscode` or `packages/kilo-jetbrains`.
- **Note:** Any external or legacy scripts expecting the HTTP endpoint `/kilocode/command/files` will receive a 404.

---

## 3. Notable Non-Findings (Verified Intact Chains)

The following critical pipelines were thoroughly traced and verified to be **fully intact** after the merge:

### 1. Compaction Payload Recovery & Serialization Pipeline
- **Chain:** `packages/opencode/src/session/compaction.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-payload-recovery.ts` $\rightarrow$ `packages/opencode/src/kilocode/session/compaction-chunks.ts` $\rightarrow$ `Database.Service`.
- **Verification Details:**
  - Upstream commit `b7f9363393` changed compaction prompts from `LLM.StreamInput["messages"]` arrays to a single prompt text containing serialized conversation history (`serialize(message)`).
  - Commit `94fd41e3a2` adapted `KiloCompactionPayloadRecovery.process` to accept `prompt`, `messages`, and `serialize`.
  - In `compaction-payload-recovery.ts`, `buildPrompt(promptText, items)` maps `items` through `input.serialize`. When an oversized payload error occurs, `strip({ messages: input.recovery, update: input.updatePart })` mutates `part.state.time.compacted = Date.now()` and strips media. On the subsequent retry, `input.serialize` detects `part.state.time.compacted` and substitutes `"[Old tool result content cleared]"`, reducing the payload size.
  - If context overflow persists, `KiloCompactionChunks.needed` estimates tokens and falls back to chunked summarization via `KiloCompactionChunks.process` and `KiloCompactionChunks.replay`.
  - **Verdict:** All links in the payload recovery, serialization, and chunk fallback chain are fully preserved.

### 2. Reactive TUI Configuration & Terminal Cursor Style Pipeline
- **Chain:** `packages/tui/src/config/index.tsx` $\rightarrow$ `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` $\rightarrow$ `packages/tui/src/app.tsx` $\rightarrow$ OpenTUI input components (`Prompt`, `QuestionPrompt`, `RejectPrompt`, `DialogSelect`, `DialogPrompt`, `DialogExportOptions`).
- **Verification Details:**
  - Upstream commit `8bf5062b89` added `cursor: { style, blinking }` to `TuiConfig.Info` and `TuiConfig.resolve`.
  - Kilo's reactive TUI config store in `KiloTuiConfig.makeStore` (`packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`) was updated to map `cursor: next.cursor ? { style: next.cursor.style ?? "block", blinking: next.cursor.blinking ?? true } : undefined`.
  - `KiloApp.KiloTuiConfig.Provider` supplies `TuiConfigProvider` in `packages/tui/src/app.tsx`, allowing child components to read `useTuiConfig().cursor`.
  - `cursorStyle={tuiConfig.cursor}` is passed to all terminal text input fields across prompt, dialogs, and permission views.
  - **Verdict:** All 30 tests in `packages/tui` pass (`config.test.tsx`, `data.test.ts`, `transcript.test.ts`). The reactive cursor configuration chain is fully intact.

### 3. Chronological Message Ordering & Revert Boundaries
- **Chain:** `packages/opencode/src/session/message-v2.ts` $\rightarrow$ `packages/opencode/src/session/revert.ts` $\rightarrow$ `packages/tui/src/context/sync.tsx` $\rightarrow$ `packages/tui/src/routes/session/index.tsx` $\rightarrow$ `packages/kilo-vscode/webview-ui/src/context/session.tsx`.
- **Verification Details:**
  - Upstream `#40990` and `#40991` updated `MessageV2.latest` and `SessionRevert.revert` to sort by `time.created` (with ID tie-breaker) and use array indexing (`findIndex`) instead of assuming monotonic ID strings.
  - TUI `sync.tsx` was verified to maintain sorted message arrays via `compareMessage` and binary search on `messageKey = message.time.created + message.id`.
  - `packages/session-ui/src/components/part-default-open.ts` properly collapses deletion-only file diffs while preserving shell/edit defaults.
  - Webview session store (`packages/kilo-vscode/webview-ui/src/context/session.tsx`) sorts loaded messages by `createdAt` timestamp.
  - **Verdict:** Chronological ordering and message boundary slicing are consistent across all client surfaces.

### 4. ACP Service Idle Draining & Permission Routing
- **Chain:** `packages/opencode/src/acp/event.ts` $\rightarrow$ `packages/opencode/src/acp/service.ts` $\rightarrow$ `packages/opencode/src/acp/permission.ts` $\rightarrow$ `packages/opencode/src/permission/index.ts`.
- **Verification Details:**
  - Upstream commit `44614c79c4` added `Subscription.runUntilIdle` to ensure queued session notifications (such as agent thought deltas) are drained before prompt/command/summarize RPC calls return `end_turn`.
  - Upstream commit `9f38562237` updated `UsageService.contextTokens` to count `input + cache.read + cache.write`.
  - In `packages/opencode/src/acp/permission.ts`, Kilo's custom `SkillShellPrompt` logic is maintained, and user-confirmed approvals propagate `interactive = true` to `this.input.sdk.permission.reply({ requestID, reply, directory, interactive })`, which is verified by `packages/opencode/src/permission/index.ts` to permit non-persistent skill shell batches.
  - **Verdict:** ACP session turns, usage calculation, and interactive permission reply chains are intact.

### 5. Server Workspace Routing & Proxy Sanitization
- **Chain:** `packages/opencode/src/server/shared/workspace-routing.ts` $\rightarrow$ `packages/opencode/src/server/proxy-util.ts` $\rightarrow$ `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts` $\rightarrow$ `proxy.ts`.
- **Verification Details:**
  - Upstream commit `703d09f306` strips `directory` query parameters from proxied remote workspace requests in `workspaceProxyURL`.
  - `ProxyUtil.headers` consistently strips `x-kilo-directory`.
  - Kilo's custom `forkTargetDirectory` in `workspace-routing.ts` correctly overrides destination directory resolution for worktree fork requests.
  - Upstream commit `f0afb6750e` logs upstream 5xx response bodies from sandboxes in `proxy.ts` before streaming responses to the client.
  - **Verdict:** Workspace proxying, header stripping, and error propagation chains are intact.

---

## 4. Command Outputs and Verification Evidence

### TUI Test Suite (`packages/tui`)
```
$ cd packages/tui && bun test ./test/config.test.tsx ./test/kilocode/data.test.ts ./test/util/transcript.test.ts
bun test v1.3.14 (0d9b296a)

 30 pass
 0 fail
 69 expect() calls
Ran 30 tests across 3 files. [1013.00ms]
```

### Session UI Test Suite (`packages/session-ui`)
```
$ cd packages/session-ui && bun test
bun test v1.3.14 (0d9b296a)

 86 pass
 0 fail
 189 expect() calls
Ran 86 tests across 14 files. [119.00ms]
```

### `@ai-sdk/openai-compatible` Syntax Error Output (`packages/opencode`)
```
$ cd packages/opencode && bun test ./test/kilocode/cli/cmd/tui/context/tui-config.test.ts
bun test v1.3.14 (0d9b296a)

test/kilocode/cli/cmd/tui/context/tui-config.test.ts:
692 |                 error: chunk.value.error
                      ^
error: Expected "}" but found "error"
    at node_modules/@ai-sdk/openai-compatible/dist/index.mjs:692:17
```

### `WorktreeManager` Start Point Resolution Output (`packages/kilo-vscode`)
```
$ cd packages/kilo-vscode && bun test tests/unit/worktree-manager.test.ts
bun test v1.3.14 (0d9b296a)

tests/unit/worktree-manager.test.ts:
986 |   it("returns bare branch + remote when remote exists", async () => {
987 |     const { clone } = await createTempRepoWithOrigin()
988 |     const mgr = createManager(clone)
989 | 
990 |     const res = await mgr.resolveStartPoint("main")
991 |     expect(res.source).toBe("remote")
                             ^
error: expect(received).toBe(expected)

Expected: "remote"
Received: "local-tracking"
```

---

## 5. Limitations

1. **Full CLI Integration Suite:** End-to-end execution of `packages/opencode` test suites is blocked until Finding 1 (`@ai-sdk/openai-compatible` patch syntax error) is repaired.
2. **Interactive Remote Workspaces:** Proxying to live cloud sandboxes (e.g. Daytona / Modal remote workspaces) was verified through static analysis and unit test mocks rather than live remote network instances.
3. **JetBrains Runtime:** Kotlin RPC methods and DTO mappings were verified via static analysis and unit tests; live plugin execution inside IntelliJ IDEA was not performed in this headless audit turn.

---

## 6. Summary Verdict

The core merge integration in PR #13002 is largely sound, with critical Kilo adaptations for compaction serialization, TUI reactive configuration, chronological message sorting, ACP turn draining, and workspace routing functioning as intended.

However, **two concrete issues must be addressed before merge**:
1. **Finding 1 (Critical):** Repair `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch` to match `@ai-sdk/openai-compatible@2.0.48` to eliminate the syntax error that crashes module loading.
2. **Finding 2 (Medium):** Configure `allowUnsafeConfigEnvCount: true` or sanitize Git config environment variables in `WorktreeManager.ts` / `GitOps.ts` to prevent fetch failures under environment-injected Git configurations.
