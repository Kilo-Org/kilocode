# Review: PR #6622 — Control Plane File Group

## Files Reviewed

| #   | File                                                              | Status | Lines |
| --- | ----------------------------------------------------------------- | ------ | ----- |
| 1   | `packages/opencode/src/control-plane/adaptors/index.ts`           | Added  | +10   |
| 2   | `packages/opencode/src/control-plane/adaptors/types.ts`           | Added  | +7    |
| 3   | `packages/opencode/src/control-plane/adaptors/worktree.ts`        | Added  | +26   |
| 4   | `packages/opencode/src/control-plane/config.ts`                   | Added  | +10   |
| 5   | `packages/opencode/src/control-plane/session-proxy-middleware.ts` | Added  | +46   |
| 6   | `packages/opencode/src/control-plane/sse.ts`                      | Added  | +66   |
| 7   | `packages/opencode/src/control-plane/workspace-context.ts`        | Added  | +23   |
| 8   | `packages/opencode/src/control-plane/workspace-server/routes.ts`  | Added  | +33   |
| 9   | `packages/opencode/src/control-plane/workspace-server/server.ts`  | Added  | +24   |
| 10  | `packages/opencode/src/control-plane/workspace.sql.ts`            | Added  | +12   |
| 11  | `packages/opencode/src/control-plane/workspace.ts`                | Added  | +160  |

**Total: 11 new files, +417 lines**

## Summary

This group introduces a new **control plane** subsystem within the core CLI package. It provides an abstraction layer for managing "workspaces" — isolated environments (currently backed by git worktrees) that can be created, removed, and synced. The architecture is designed to be extensible via an adaptor pattern (only the `worktree` adaptor exists today), with future remote-workspace support implied by the proxy middleware and SSE syncing code.

All 11 files are newly added. None are referenced from the existing codebase at this point — no imports of `SessionProxyMiddleware`, `WorkspaceServer`, `WorkspaceTable`, `WorkspaceContext`, or `Workspace` exist in any current server, route, or entry-point file. This means the code is **dead/inert** in the v1.2.16 release and carries no runtime behavioral risk for existing functionality, including the VS Code extension. However, the code has several structural issues that will matter the moment it gets wired in.

---

## Detailed Findings

### 1. `adaptors/index.ts`

**What changed:** Factory function `getAdaptor(config)` that switches on `config.type` and returns the appropriate adaptor implementation.

**Risk: Low**

**Concerns:**

- The `switch` has no `default` case. TypeScript's exhaustiveness checking will catch this at compile time as long as `Config` is a discriminated union, but if a new adaptor type is added to `Config` without updating this switch, the function will silently return `undefined` at runtime (return type is `Adaptor` but actual return would be `undefined`). Adding `default: throw new Error(...)` or a `never` exhaustiveness guard would be safer.

---

### 2. `adaptors/types.ts`

**What changed:** Defines the `Adaptor<T>` interface with `create`, `remove`, and `request` methods.

**Risk: Low**

**Concerns:**

- The `request` method returns `Promise<Response | undefined>`. The `undefined` return is used as a signal in the proxy middleware to mean "don't proxy, fall through." This implicit protocol is fragile — callers must understand that `undefined` means "not applicable" rather than "error." A more explicit return type (e.g., a tagged union) would be clearer, but this is a minor design preference.

---

### 3. `adaptors/worktree.ts`

**What changed:** Implements the worktree adaptor. `create` delegates to `Worktree.create(undefined)`, `remove` delegates to `Worktree.remove`, and `request` throws unconditionally.

**Risk: Medium**

**Concerns:**

- **`create` ignores `_branch` parameter.** The function signature accepts `_branch: string` but never uses it. `Worktree.create(undefined)` is called with no input, meaning the branch name from workspace creation is silently discarded. This is likely a bug — the `Workspace.create` function passes `input.branch` to the adaptor's `create`, but it has no effect.
- **`create` ignores `_from` parameter.** The existing config is unused, so the adaptor can't meaningfully "create from" an existing configuration.
- **Acknowledged hack.** The comment about `Worktree.create` putting async code in `setTimeout` acknowledges that the `init` callback is a no-op. This means the workspace DB insert in `Workspace.create` happens inside a `setTimeout` that fires before the worktree is actually populated, creating a window where the workspace exists in the DB but isn't ready.
- **`request` throws a raw `Error`.** The codebase convention is to use `NamedError.create()` for structured errors. A raw `throw new Error(...)` will be caught by the server's `onError` handler and returned as a 500 with an opaque `NamedError.Unknown` wrapper.

---

### 4. `config.ts`

**What changed:** Zod discriminated union schema for workspace config types. Currently only has `worktree` variant with a `directory` field.

**Risk: Low**

**Concerns:**

- Clean and minimal. The dual `export const Config` / `export type Config` pattern is idiomatic for this codebase.

---

### 5. `session-proxy-middleware.ts`

**What changed:** Hono middleware that intercepts non-GET session requests when the current instance directory starts with `wrk_`, looks up the workspace, and proxies the request to the remote adaptor.

**Risk: High**

**Concerns:**

- **Information disclosure in error response.** When a workspace is not found, the error response includes `Instance.directory` verbatim: `Workspace not found: ${Instance.directory}`. This leaks internal directory identifiers to the HTTP client.
- **No authentication on proxied requests.** The middleware proxies the raw request body to the adaptor's `request` method without forwarding authentication headers or verifying the caller's authorization. If a remote adaptor is added, this would proxy unauthenticated mutation requests to a remote server.
- **Guard relies on string prefix `"wrk_"`.** The check `Instance.directory.startsWith("wrk_")` is a magic string convention. If the identifier prefix for workspaces changes (the `Identifier` module uses configurable prefixes), this check silently stops working.
- **`isLocal()` guard means dead code in production.** The middleware returns early via `next()` when `!Installation.isLocal()`. Since the VS Code extension bundles a release build (not local), this middleware will never activate in production even once wired in. This is by design (comment says "Only available in development for now"), but worth noting — the middleware has zero test coverage path in production.
- **No error handling around `proxySessionRequest`.** If `Workspace.get` throws (DB error, etc.), the error propagates unhandled to Hono's `onError`. Acceptable given the global error handler exists, but a specific error response would be more informative.

---

### 6. `sse.ts`

**What changed:** Manual SSE stream parser. Reads a `ReadableStream<Uint8Array>`, parses `data:`, `id:`, and `retry:` fields, and invokes an `onEvent` callback for each parsed event.

**Risk: Low**

**Concerns:**

- **Empty `catch` block.** The line `const chunk = await reader.read().catch(() => ({ done: true, value: undefined ... }))` silently swallows read errors and treats them as end-of-stream. The `AGENTS.md` style guide explicitly forbids empty catch blocks. A read error (network failure, stream corruption) should be distinguishable from a clean stream end.
- **`retry` and `last` (event ID) are tracked but never exposed.** The `retry` value and last event ID are parsed but not returned to the caller. A reconnecting SSE client would need the last ID for `Last-Event-ID` header support. Currently this function is stateless across reconnections, so reconnects (in `workspaceEventLoop`) start from scratch.
- **JSON parse failure fallback.** When `JSON.parse(raw)` fails, the code wraps the raw data in a synthetic `{ type: "sse.message", properties: { data, id, retry } }` object. This is a reasonable fallback but the `catch` block is empty (no error variable or logging), which again conflicts with the no-empty-catch style rule.

---

### 7. `workspace-context.ts`

**What changed:** AsyncLocalStorage-based context for propagating a `workspaceID` through async call chains.

**Risk: Low**

**Concerns:**

- **Name collision.** The file declares `interface Context` which shadows the imported `Context` from `../util/context`. This works because one is a type and the other is a namespace, but it's confusing. The local interface could be named `WorkspaceContextData` or similar for clarity.
- **Silent error swallowing.** The `workspaceID` getter catches any error and returns `undefined`. Per style guide, the catch should not be empty — `e` is captured but unused. This makes it impossible to distinguish "no context" from "context error."
- **Dead code at present.** `WorkspaceContext` is not imported anywhere in the current codebase.

---

### 8. `workspace-server/routes.ts`

**What changed:** Hono route that exposes a `/event` SSE endpoint. Subscribes to `GlobalBus` events and forwards them to connected clients. Includes heartbeat at 10s intervals.

**Risk: Low**

**Concerns:**

- **No event filtering.** Every event emitted to `GlobalBus` (from any instance/directory) is forwarded to every connected SSE client. In a multi-workspace scenario, this could leak events from other workspaces. The `handler` receives `event.directory` but ignores it, forwarding `event.payload` unconditionally.
- **No authentication.** The route has no auth middleware. The parent `WorkspaceServer` doesn't apply any authentication, so anyone who can reach the port can subscribe to all events.
- **`void send(...)` in heartbeat.** The heartbeat fires `void send(...)` which discards the promise. If the write fails (client disconnected between heartbeat and abort detection), the error is silently lost.

---

### 9. `workspace-server/server.ts`

**What changed:** Standalone Hono server for workspace-level operations. Mounts session routes (write-only, GETs return 404) and workspace event routes. Exposes a `Listen` function that binds to a host/port via `Bun.serve`.

**Risk: Medium**

**Concerns:**

- **No authentication.** Unlike the main `Server` in `server.ts` which applies `basicAuth` when `KILO_SERVER_PASSWORD` is set, `WorkspaceServer` has zero auth. Any process on the network that can reach the port can create sessions, send prompts, delete data, etc.
- **No CORS configuration.** The main server carefully configures CORS origins. This server has none, making it vulnerable to cross-origin requests from malicious web pages if the port is reachable.
- **No error handler.** The main server has a detailed `onError` handler that converts `NamedError` and `HTTPException` into structured responses. This server has no error handler, so unhandled errors will produce Hono's default 500 response.
- **Session routes block all GETs.** The middleware `if (c.req.method === "GET") return c.notFound()` means GET requests to session endpoints return 404. This is intentional (workspace server only handles mutations; reads go to the main server), but there's no documentation or comment explaining this design decision.

---

### 10. `workspace.sql.ts`

**What changed:** Drizzle ORM table definition for `workspace` with columns: `id` (PK), `branch`, `project_id` (FK to `project`), and `config` (JSON).

**Risk: High**

**Concerns:**

- **Table not registered in schema barrel.** The `WorkspaceTable` is **not exported from `packages/opencode/src/storage/schema.ts`**, which is the file imported by `db.ts` as `import * as schema from "./schema"`. This means:
  1. Drizzle's schema-aware query builder won't know about this table.
  2. No migration will be generated for it.
  3. At runtime, `Database.use((db) => db.insert(WorkspaceTable)...)` in `workspace.ts` will fail because the `workspace` table doesn't exist in the SQLite database.
- **No migration file.** Checked `packages/opencode/migration/` — no migration creates the `workspace` table. The existing migrations only cover `session`, `message`, `part`, `todo`, `permission`, `project`, `session_share`, and `control_account` tables. This will cause a runtime crash the moment `Workspace.create` or `Workspace.get` is called.
- **`config` stored as unvalidated JSON text.** The `.$type<Config>()` cast provides TypeScript type safety but no runtime validation. Corrupt or manually-edited JSON in the DB will be silently accepted. A `$default(() => ...)` or application-level validation on read would be safer.

---

### 11. `workspace.ts`

**What changed:** Core workspace module. Defines `Workspace` namespace with CRUD operations (`create`, `get`, `list`, `remove`), event definitions (`Ready`, `Failed`), and a `startSyncing` function that establishes SSE event loops for non-worktree workspaces.

**Risk: High**

**Concerns:**

- **DB insert inside `setTimeout`.** `Workspace.create` calls the adaptor's `create`, builds the `Info` object, then defers the DB insert to a `setTimeout(async () => { ... }, 0)`. This means:
  1. The function returns the workspace info _before_ it's persisted. A subsequent `Workspace.get(id)` call could return `undefined` if the event loop hasn't flushed yet.
  2. If the DB insert fails, the error is unhandled — `setTimeout` callbacks don't propagate errors to the caller. The workspace would exist in memory/adaptor but not in the database.
  3. The `Event.Ready` is emitted after the insert, but if insert fails, no `Event.Failed` is emitted.
- **`startSyncing` filters to non-worktree types, but only worktree exists.** `spaces.filter((space) => space.config.type !== "worktree")` will always produce an empty array with the current `Config` union (only `"worktree"` variant exists). So `startSyncing` is currently a no-op. This is presumably forward-looking for remote adaptors.
- **`workspaceEventLoop` has no backoff.** On connection failure it sleeps 1 second, on SSE stream end it sleeps 250ms, then retries indefinitely. There's no exponential backoff, no max-retry limit, and no jitter. In a failure scenario (remote server down), this will hammer the endpoint with requests every 1 second forever.
- **`remove` doesn't clean up syncing.** If a workspace is removed while `startSyncing` has an active event loop for it, the loop continues running and will encounter errors (the workspace no longer exists). There's no mechanism to stop individual workspace sync loops.
- **`list` is synchronous but `get` and `remove` are async.** `list` does a synchronous DB query (via `Database.use`) which is fine, but the inconsistency with `get` being wrapped in `fn()` (which is async) means callers need to handle both patterns.
- **Empty `Event.Ready` properties.** `Event.Ready` is defined with `z.object({ name: z.string() })` but emitted with `properties: {}` — no `name` is provided. This would fail Zod validation if the event schema is ever enforced at emission time.

---

## Risk to VS Code Extension

**Risk: None (in this PR)**

The VS Code extension communicates with the CLI via `@kilocode/sdk`, which is auto-generated from the main server's OpenAPI spec. The control plane introduces:

1. **No changes to existing server routes.** `server.ts` is not modified. No existing API endpoint is altered.
2. **No new middleware on existing routes.** `SessionProxyMiddleware` is defined but not mounted anywhere.
3. **No schema changes.** `storage/schema.ts` is not modified, so no DB migration is triggered.
4. **All new code is unreachable.** No existing module imports from `control-plane/`.

The extension will not see any behavioral difference with this code present. However, **when this code is eventually wired in**, the following risks emerge:

- If `SessionProxyMiddleware` is added to the main server's session route chain, non-GET session requests from the extension could be intercepted and proxied when the directory starts with `wrk_`. If the workspace lookup fails or the proxy errors, session mutations (create, prompt, abort, etc.) would fail.
- The `WorkspaceServer` lacks the auth, CORS, and error handling that the extension's SDK client expects from the main server. If the extension is ever pointed at a workspace server port, auth will silently not work and errors will be in unexpected formats.
- The missing DB migration for `WorkspaceTable` means any code path that touches workspace CRUD will crash at runtime.

---

## Overall Risk

**Low (for this PR as shipped) / High (for activation)**

As committed, this is inert scaffolding with zero runtime impact. No existing behavior changes, no API surface modifications, no database schema alterations. The VS Code extension is completely unaffected.

However, the code has several issues that **must be resolved before activation**:

| Priority | Issue                                                                   | File                                    |
| -------- | ----------------------------------------------------------------------- | --------------------------------------- |
| **P0**   | Missing DB migration and schema registration for `WorkspaceTable`       | `workspace.sql.ts`, `storage/schema.ts` |
| **P0**   | DB insert in `setTimeout` with no error handling in `Workspace.create`  | `workspace.ts`                          |
| **P1**   | No auth/CORS/error-handler on `WorkspaceServer`                         | `workspace-server/server.ts`            |
| **P1**   | `WorktreeAdaptor.create` ignores branch parameter                       | `adaptors/worktree.ts`                  |
| **P1**   | `Event.Ready` emitted with empty properties vs. schema expecting `name` | `workspace.ts`                          |
| **P2**   | No exponential backoff in `workspaceEventLoop`                          | `workspace.ts`                          |
| **P2**   | Empty catch blocks in SSE parser and workspace-context                  | `sse.ts`, `workspace-context.ts`        |
| **P2**   | No event filtering in workspace server SSE route (cross-workspace leak) | `workspace-server/routes.ts`            |
| **P2**   | Missing `default` exhaustiveness guard in `getAdaptor` switch           | `adaptors/index.ts`                     |
| **P3**   | Information disclosure in proxy error response                          | `session-proxy-middleware.ts`           |
