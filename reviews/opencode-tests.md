# PR #6622 (OpenCode v1.2.16) - Test Files Review

## Files Reviewed

| File                                                                    | Status   | +/-    | Area                                        |
| ----------------------------------------------------------------------- | -------- | ------ | ------------------------------------------- |
| `packages/opencode/test/auth/auth.test.ts`                              | added    | +58    | Auth trailing-slash normalization           |
| `packages/opencode/test/config/config.test.ts`                          | modified | +65    | Well-known URL trailing-slash normalization |
| `packages/opencode/test/control-plane/session-proxy-middleware.test.ts` | added    | +147   | Session proxy routing to remote workspaces  |
| `packages/opencode/test/control-plane/sse.test.ts`                      | added    | +56    | SSE stream parser                           |
| `packages/opencode/test/control-plane/workspace-server-sse.test.ts`     | added    | +65    | Workspace server SSE integration            |
| `packages/opencode/test/control-plane/workspace-sync.test.ts`           | added    | +97    | Workspace syncing for remote workspaces     |
| `packages/opencode/test/fixture/db.ts`                                  | added    | +11    | Shared test helper for DB reset             |
| `packages/opencode/test/provider/provider.test.ts`                      | modified | +61    | Cloudflare AI Gateway provider              |
| `packages/opencode/test/provider/transform.test.ts`                     | modified | +100   | Gemini schema transform (combiner nodes)    |
| `packages/opencode/test/pty/pty-output-isolation.test.ts`               | modified | +7/-11 | PTY output isolation behavior change        |
| `packages/opencode/test/session/session.test.ts`                        | modified | +71    | step-finish token propagation               |

## Summary

This test group adds 738 lines of new test code across 11 files, covering four distinct feature areas: (1) trailing-slash normalization in auth and config, (2) the new control-plane system (SSE parsing, workspace syncing, session proxy middleware), (3) Gemini schema transform edge cases for combiner nodes like `anyOf`/`oneOf`, and (4) Cloudflare AI Gateway provider loading. There is also a **behavioral change** to the PTY output isolation test and a new session test for step-finish token propagation.

The test quality is generally strong -- tests are focused, use real implementations rather than mocks where possible, and cover important edge cases. However, there are notable gaps and a concerning behavioral regression in the PTY test.

## Detailed Findings

### `packages/opencode/test/auth/auth.test.ts` (added, +58)

**What it tests:** Four cases for trailing-slash normalization in `Auth.set` and `Auth.remove` -- that trailing slashes are stripped on store, that pre-existing trailing-slash entries are cleaned up, that `remove` deletes both variants, and that non-URL keys (e.g., `"anthropic"`) are unaffected.

**Assessment: Good coverage, but tests the wrong implementation.**

The current `Auth.set()` and `Auth.remove()` in `src/auth/index.ts` do **not** perform any trailing-slash normalization. `set` simply writes `data[key]` and `remove` simply deletes `data[key]`. This means either:

- (a) These tests are asserting behavior that doesn't exist yet and would currently fail, or
- (b) The production code changes for `Auth` are in a different file group not reviewed here.

If (a), this is a problem -- the tests validate a contract the code doesn't fulfill. If (b), the tests are well-structured for the intended behavior but the source diff should be verified. The test for cleanup of pre-existing entries (test 2) is particularly valuable as it tests a migration scenario.

**Risk:** Medium -- if the normalization logic is incomplete or missing, auth lookups for well-known providers with trailing-slash URLs would silently fail.

---

### `packages/opencode/test/config/config.test.ts` (modified, +65)

**What it tests:** That when `Auth.all()` returns an entry keyed with a trailing slash (`"https://example.com/"`), the well-known config fetch URL is correctly constructed as `https://example.com/.well-known/opencode` (no double slash).

**Assessment: Good, targeted regression test.**

Uses `mock` to stub `Auth.all` and `globalThis.fetch`, which is appropriate for this integration point. The `try/finally` cleanup pattern correctly restores both stubs. Tests the exact URL passed to `fetch`, which is the right assertion for a URL normalization bug.

One minor note: the mock replaces `Auth.all` via direct property assignment (`Auth.all = mock(...)`) rather than using `mock.module`. This works but means the test is coupled to `Auth.all` being a mutable property. Acceptable for this case since `Auth` is a namespace, not a frozen object.

**Risk:** Low.

---

### `packages/opencode/test/control-plane/session-proxy-middleware.test.ts` (added, +147)

**What it tests:** The `SessionProxyMiddleware` for the control-plane, which routes HTTP requests for remote-workspace sessions through the correct adaptor. Tests cover: routing GET/POST/PUT/DELETE to the proxied workspace, passing request bodies through, and returning 404 for local (non-remote) workspace sessions.

**Assessment: Well-structured but relies heavily on module mocking.**

The test mocks `../../src/control-plane/adaptors` to capture proxied requests without making real network calls, which is the right approach for a middleware test. The `setup` function cleanly abstracts DB seeding and app construction.

The type assertion `as unknown as typeof WorkspaceTable.$inferInsert.config` for the remote config is a code smell -- it sidesteps type safety on a critical discriminant. If the `WorkspaceTable.config` shape changes, these tests won't catch the breakage at compile time. However, this pattern is consistent across all control-plane tests.

Missing coverage: No test for concurrent proxy requests, error handling when the adaptor throws, or timeout behavior. These may be acceptable to defer.

**Risk:** Low for what it covers, but the control-plane is entirely new infrastructure and having only happy-path + 404 tests leaves gaps.

---

### `packages/opencode/test/control-plane/sse.test.ts` (added, +56)

**What it tests:** The `parseSSE` utility -- parsing JSON events with CRLF line endings and multiline `data:` blocks, and falling back to `sse.message` type for non-JSON payloads (with `id` and `retry` field extraction).

**Assessment: Good unit test, appropriate scope.**

Tests the two main branches: JSON-parseable events and fallback plain-text events. The `stream()` helper creates a clean `ReadableStream` for testing. The multiline data block test (where a JSON object is split across two `data:` lines) is a valuable edge case.

Missing: No test for malformed JSON (partial JSON that fails `JSON.parse`), empty events, or very large payloads. No test for `AbortSignal` actually stopping parsing mid-stream.

**Risk:** Low -- `parseSSE` is a utility function with well-defined behavior.

---

### `packages/opencode/test/control-plane/workspace-server-sse.test.ts` (added, +65)

**What it tests:** End-to-end SSE streaming from the `WorkspaceServer.App()` -- that the `/event` endpoint returns a 200 SSE stream, that `server.connected` is emitted on connection, and that `GlobalBus` events are forwarded to the SSE client.

**Assessment: Good integration test with appropriate timeout handling.**

The test uses a `Promise` with a `setTimeout` reject (3s timeout) to avoid hanging. It subscribes to the SSE stream via `parseSSE`, waits for `server.connected`, then emits a `GlobalBus` event and verifies it arrives. The `stop.abort()` in `finally` ensures the stream is properly cleaned up.

The `WorkspaceServer.App()` is tested via Hono's `app.request()`, avoiding real HTTP transport. This is a good pattern.

**Risk:** Low.

---

### `packages/opencode/test/control-plane/workspace-sync.test.ts` (added, +97)

**What it tests:** The `Workspace.startSyncing` function -- that it only syncs remote (not local/worktree) workspaces, that SSE events from remote adaptors are forwarded to `GlobalBus`, and that syncing stops when `stop.abort()` is called.

**Assessment: Solid, covers the core sync contract.**

The module mock for `adaptors` returns a `ReadableStream` with a single SSE event (`remote.ready`), simulating a remote workspace server. The test verifies that only `"testing"` type adaptors are contacted (not `"worktree"` types), and that the emitted event arrives on `GlobalBus`.

The `seen` array at module scope captures adaptor calls, which works but is a fragile pattern -- it persists across tests within the describe block. In this case there's only one test, so it's fine, but it could cause issues if more tests are added later.

**Risk:** Low.

---

### `packages/opencode/test/fixture/db.ts` (added, +11)

**What it tests:** N/A -- this is a shared test utility, not a test itself.

**Assessment: Clean, necessary infrastructure.**

Provides `resetDatabase()` which disposes all instances, closes the DB, and removes the SQLite database files (including WAL and SHM). Used in `afterEach` by all control-plane tests to ensure isolation. The `.catch(() => undefined)` pattern for cleanup errors is appropriate.

**Risk:** None.

---

### `packages/opencode/test/provider/provider.test.ts` (modified, +61)

**What it tests:** Two new tests for the Cloudflare AI Gateway provider: (1) that it loads when the three required env vars (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`, `CLOUDFLARE_API_TOKEN`) are set, and (2) that config-level `metadata` options are forwarded to the provider's `options.metadata`.

**Assessment: Good coverage for a new provider.**

Tests verify both the provider loading path (env-gated) and the config forwarding path. The pattern matches existing provider tests in the file (e.g., Google Vertex OpenAI compat test just above).

Missing: No negative test for when env vars are absent (verifying the provider does NOT appear). No test for the auth error message path. These are minor since the provider loading logic is shared infrastructure.

**Risk:** Low.

---

### `packages/opencode/test/provider/transform.test.ts` (modified, +100)

**What it tests:** Two new describe blocks for Gemini schema transforms:

1. **Combiner nodes** (`anyOf`/`oneOf`) -- that `items.anyOf` is preserved without injecting a `type` property, and that no sibling `type: "string"` is added alongside combiner keywords anywhere in the schema tree.
2. **Top-level combiner keys** -- that `anyOf` at the root level doesn't cause a crash or injection.

**Assessment: Excellent regression tests for a subtle bug.**

The `sanitizeGemini` function in `transform.ts:945-953` adds `type: "string"` to array items that lack a `type` property. When `items` contains `anyOf`/`oneOf` (which are valid without a `type`), this incorrectly injects a conflicting `type` field. The tests verify that the fix correctly handles this case.

The `walk` helper function used to scan the full schema tree for stray `type` additions alongside combiner keys is thorough -- it ensures the fix doesn't just work at one level but at all depths.

**However**, examining the production code at `transform.ts:951`, the condition is:

```ts
if (typeof result.items === "object" && !Array.isArray(result.items) && !result.items.type) {
  result.items.type = "string"
}
```

This condition checks `!result.items.type` but does NOT check for `anyOf`/`oneOf`/`allOf`. If `items` has `{ anyOf: [...] }` (no `type`), this code **will still add** `type: "string"`. This means **the tests should be failing** against the current production code, suggesting that either:

- The production fix is in a different file group, or
- There's additional logic not visible in the current `transform.ts` snapshot.

This is a **significant finding** -- the tests validate the correct behavior but the production code reviewed here does not implement it.

**Risk:** High if the production fix is missing or incomplete. Gemini tool schemas with `anyOf`/`oneOf` items would get an injected `type: "string"` causing Gemini API rejections.

---

### `packages/opencode/test/pty/pty-output-isolation.test.ts` (modified, +7/-11)

**What it tests:** The third PTY test case is **renamed and its assertion is reversed**:

- **Before:** "does not leak output when socket data mutates in-place" -- asserted that mutating `ctx.connId` on `ws.data` caused the socket to be treated as a new/different connection, so output went to a separate `outB` buffer.
- **After:** "treats in-place socket data mutation as the same connection" -- asserts that mutating `ctx.connId` does NOT disconnect the socket, so output continues flowing to the original `out` buffer.

**Assessment: This is a behavioral regression test change that warrants scrutiny.**

The change reflects a deliberate shift in PTY connection identity semantics: previously, `ws.data` field mutations were treated as a connection identity change (causing disconnection). Now, connection identity is based on the **object reference** of `ws.data`, not its field values.

Looking at the production code in `src/pty/index.ts:238`, the `token(ws)` function reads `ws.data.connId` (line 48-49). When `ctx.connId` changes from 1 to 2, `token(ws)` returns 2, but the subscriber was registered with token 1. This mismatch triggers the guard at line 238 (`if (token(ws) !== sub.token)`), disconnecting the subscriber.

**The test change suggests the production code was also changed** to use a different identity mechanism (likely the `sockets` WeakMap at line 233, which uses object identity). But the `token` check at line 238 still reads `connId`, so the test reversal only makes sense if the production PTY code was also modified.

If the production PTY code was NOT modified alongside this test, the new test assertion would fail, since the current code at line 238 would still disconnect on `connId` mutation.

**Risk to VS Code Extension:** **Medium-High.** The VS Code extension uses PTY/terminal sessions. If the connection identity semantics changed incorrectly, terminal output could leak between sessions or terminals could silently disconnect. The Bun runtime does mutate `ws.data` fields in-place in some scenarios (WebSocket upgrade paths), so this behavioral change could affect real-world connection stability.

---

### `packages/opencode/test/session/session.test.ts` (modified, +71)

**What it tests:** Two new tests in a "step-finish token propagation via Bus event" describe block:

1. That a `step-finish` part with non-zero token counts propagates correctly through `Session.updatePart` and the `PartUpdated` bus event, preserving all token fields (total, input, output, reasoning, cache.read, cache.write).
2. That a `step-finish` part with all-zero tokens also propagates correctly.

**Assessment: Good regression test for data integrity.**

These tests verify that the `Session.updatePart` -> DB insert -> `Bus.publish(PartUpdated)` pipeline preserves token metadata on `step-finish` parts. This is important because token counts are used for cost calculation and usage tracking.

The test creates a real session and message, inserts a part via `updatePart`, and checks the bus event. It uses `as unknown as MessageV2.Info` for the message creation, which bypasses type checking but is acceptable for test setup.

The zero-tokens test is a good edge case -- it verifies that falsy values (0) are not dropped or treated as missing.

**Risk:** Low.

---

## Risk to VS Code Extension

| Area                                 | Risk Level      | Rationale                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PTY output isolation behavior change | **Medium-High** | VS Code extension uses PTY for terminal sessions. The reversed assertion implies changed connection identity semantics. If the production PTY code change is incorrect, terminals could leak output across sessions or disconnect unexpectedly.   |
| Control-plane (new)                  | **Medium**      | The control-plane powers workspace proxy and SSE sync for remote workspaces, which is a feature the VS Code extension's Agent Manager likely consumes. Tests cover happy paths but lack error/edge-case coverage for entirely new infrastructure. |
| Auth trailing-slash normalization    | **Low**         | Affects well-known provider authentication. The VS Code extension delegates auth to the CLI server, so any fix here flows through transparently.                                                                                                  |
| Gemini schema transforms             | **Low**         | Affects Gemini tool call schemas. No direct VS Code extension impact beyond model usage.                                                                                                                                                          |
| Session token propagation            | **Low**         | Affects cost/usage display. Transparent to the extension.                                                                                                                                                                                         |

## Overall Risk

**Medium.** The test additions are well-written and cover important new functionality (control-plane, auth normalization, Gemini schema fixes, Cloudflare provider). However, there are two significant concerns:

1. **Test-production mismatch for Gemini combiner nodes (`transform.test.ts`) and auth normalization (`auth.test.ts`):** The tests assert behavior that the reviewed production code does not implement. This suggests either the production fixes are in a separate file group (likely), or the tests would fail. The review cannot confirm without seeing the corresponding production diffs.

2. **PTY behavioral regression (`pty-output-isolation.test.ts`):** The test reversal from "mutation disconnects" to "mutation keeps the same connection" is a semantic change that affects terminal output isolation. This needs verification that the production PTY code was updated consistently and that the new behavior is correct under Bun's WebSocket lifecycle.

The four new control-plane test files provide a reasonable foundation for an entirely new subsystem, though they lean toward happy-path coverage. Given that the control-plane is new infrastructure, this is acceptable for an initial release but should be expanded.
