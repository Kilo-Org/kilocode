# Review: opencode-server (PR #6622 - OpenCode v1.2.16)

## Files Reviewed

| File                                                  | Status   | +/-     |
| ----------------------------------------------------- | -------- | ------- |
| `packages/opencode/src/server/server.ts`              | modified | +21/-5  |
| `packages/opencode/src/server/routes/session.ts`      | modified | +2/-0   |
| `packages/opencode/src/server/routes/experimental.ts` | modified | +2/-0   |
| `packages/opencode/src/server/routes/workspace.ts`    | added    | +104/-0 |

## Summary

This patch introduces **workspace-aware request routing** to the Kilo server. A new `WorkspaceContext` AsyncLocalStorage layer wraps every request, a `SessionProxyMiddleware` is added to forward session mutations to remote workspaces, and a new set of CRUD endpoints for workspace management is mounted under `/experimental/workspace`. The global query-string validator is also expanded to accept an optional `workspace` parameter. These changes are foundational for the Agent Manager's multi-workspace support.

---

## Detailed Findings

### 1. `packages/opencode/src/server/server.ts`

**What changed:**

- Imports `WorkspaceContext` from `../control-plane/workspace-context`.
- The per-request middleware now reads `workspaceID` from query param `workspace` or header `x-opencode-workspace`.
- `Instance.provide()` is now nested inside `WorkspaceContext.provide()`, adding a new AsyncLocalStorage layer around every request.
- The global query validator is expanded from `{ directory?: string }` to `{ directory?: string, workspace?: string }`.

**Findings:**

**(a) Nesting order is correct.** `WorkspaceContext.provide` wraps `Instance.provide`, so downstream middleware/routes can access both the workspace ID and the project instance. The `SessionProxyMiddleware` (on session routes) reads `Instance.directory` to look up the workspace, which requires `Instance` to be initialized first. Since `Instance.provide` is the inner call, it runs before the session route handler, so the ordering is sound.

**(b) `workspaceID` can be `undefined`.** When neither the query param nor header is present, `workspaceID` is `undefined` (falsy `""` from missing query falls through to `||`). `WorkspaceContext.provide` accepts `undefined` and `WorkspaceContext.workspaceID` returns `undefined` in that case. This is backward-compatible -- existing SDK clients that don't send a workspace parameter will behave identically to before.

**(c) `/log` path bypass is preserved.** The early `return next()` for `/log` still skips both the `WorkspaceContext.provide` and `Instance.provide` wrappers. This is correct because the `/log` endpoint doesn't need project or workspace context.

**(d) Query validator duplication.** The `workspace` param is validated by the global `.use(validator("query", ...))` middleware at `server.ts:249`. It is also extracted manually in the per-request middleware at `server.ts:215` via `c.req.query("workspace")`. The manual extraction occurs _before_ the validator middleware runs (the validator is registered lower in the chain). This means if someone sends `workspace=<invalid>`, the workspace would already be threaded into `WorkspaceContext` before the validator rejects it. In practice, the query validator schema only checks `z.string().optional()`, so any string value passes validation anyway. **Low risk**, but worth noting that the query extraction happens before validation.

**(e) No `kilocode_change` markers.** The `WorkspaceContext` import and the middleware nesting changes modify shared upstream code but lack `kilocode_change` markers. Per the project's fork merge guidelines, these changes should be annotated to ease future upstream merges.

---

### 2. `packages/opencode/src/server/routes/session.ts`

**What changed:**

- Imports `SessionProxyMiddleware` from `../../control-plane/session-proxy-middleware`.
- Adds `.use(SessionProxyMiddleware)` as the **first** middleware on the `SessionRoutes` Hono instance.

**Findings:**

**(a) Middleware placement is correct.** Because it's first in the chain, every session route request passes through `SessionProxyMiddleware` before reaching any handler. The middleware only intercepts non-GET requests for remote workspaces, so GET requests (list, get, messages, status, diff) always fall through to the local handler. This is the intended behavior: reads are local, writes are proxied to remote workspace servers.

**(b) Proxy semantics for the VS Code extension.** The SDK's `Session` class methods (create, prompt, abort, revert, delete, etc.) issue POST/DELETE requests. When a workspace is remote, these will be transparently proxied by the middleware. The response comes from the remote server, not the local one. The SDK client will receive the proxied response as-is. **This is a behavioral change for remote-workspace sessions** -- the VS Code extension will get responses from a different server instance without knowing it. This is by design, but any differences in response format between local and remote servers could cause issues.

**(c) Error handling in the proxy path.** Looking at `session-proxy-middleware.ts`, if the workspace is not found, it returns a `500` plain-text response. The VS Code extension SDK expects JSON error responses (matching `NamedError` format). A plain-text 500 response will likely cause a parse error in the SDK client. The adaptor's `request()` for worktree type throws `"worktree does not support request"` -- this unhandled throw would bubble up through Hono's `onError` handler in `server.ts` and be caught as a generic `NamedError.Unknown`, which is fine. But the explicit `new Response(...)` for "workspace not found" bypasses Hono's error handling entirely.

**(d) No `kilocode_change` markers.** Same concern as `server.ts`. The import and `.use()` line modify shared upstream code.

---

### 3. `packages/opencode/src/server/routes/experimental.ts`

**What changed:**

- Imports `WorkspaceRoutes` from `./workspace`.
- Mounts `.route("/workspace", WorkspaceRoutes())` between the POST `/worktree` and GET `/worktree` routes.

**Findings:**

**(a) Route mounting position.** The workspace routes are mounted in the middle of the existing route chain, between the POST `/worktree` (create worktree) handler and the GET `/worktree` (list worktrees) handler. This works correctly with Hono's routing -- subroutes at `/workspace` won't interfere with `/worktree` routes since the paths are distinct. No conflict risk.

**(b) Nesting under `/experimental`.** The workspace routes are under `/experimental/workspace`, making the full paths:

- `POST /experimental/workspace/:id` -- create workspace
- `GET /experimental/workspace/` -- list workspaces
- `DELETE /experimental/workspace/:id` -- remove workspace

The `experimental` prefix signals these are unstable APIs, which is appropriate for a feature gated behind `Installation.isLocal()` in the middleware.

**(c) No `kilocode_change` markers.** The import and route mounting line modify shared upstream code.

---

### 4. `packages/opencode/src/server/routes/workspace.ts` (new file)

**What changed:** Entirely new file defining three workspace CRUD endpoints.

**Findings:**

**(a) `POST /:id` -- Create workspace.**

- The caller supplies the workspace `id` as a URL param. This is unusual -- typically the server generates IDs. Looking at `Workspace.create()` in the control-plane module, it calls `Identifier.ascending("workspace", input.id)`, which accepts an optional pre-generated ID. This design lets the VS Code extension (Agent Manager) generate deterministic workspace IDs before the server round-trip, which may be useful for optimistic UI. Acceptable pattern.
- The request body requires `branch` and `config`. The `branch` field is `z.string().nullable()` (from `Workspace.Info.shape.branch`), meaning the client can explicitly send `null`. The `config` field is a discriminated union currently with only `{ type: "worktree", directory: string }`.
- `projectID` is pulled from `Instance.project.id`, which is derived from the `directory` query param / header. This ties workspace creation to the active project context. Correct.

**(b) `GET /` -- List workspaces.**

- Returns all workspaces for the current project via `Workspace.list()`.
- Response schema is `z.array(Workspace.Info)`.
- No pagination or filtering. For the current use case (few workspaces per project) this is fine.

**(c) `DELETE /:id` -- Remove workspace.**

- Calls `Workspace.remove({ id })` which handles both the DB deletion and the adaptor cleanup (e.g., removing a git worktree).
- Returns `true` on success.
- Only defines `errors(400)` in the OpenAPI spec but doesn't define `errors(404)`. If the workspace doesn't exist, the behavior depends on `Workspace.remove()` implementation. This could be a gap -- a 404 error case should likely be documented.

**(d) Missing error responses.** The create and remove endpoints only specify `errors(400)`. There's no `errors(404)` for the case where the workspace ID doesn't exist on remove, and no `errors(500)` for adaptor failures during creation. The list endpoint has no error responses at all. This is inconsistent with other routes like session routes which typically include `errors(400, 404)`.

**(e) Operation IDs follow the convention.** `experimental.workspace.create`, `experimental.workspace.list`, `experimental.workspace.remove` -- these are consistent with the existing pattern of `namespace.resource.action`.

**(f) File should have `kilocode_change - new file` marker.** Per the fork merge guidelines, new files in shared directories should be marked. However, since this file is in `src/server/routes/` (not a `kilocode` directory), a marker would help during upstream merges.

---

## Risk to VS Code Extension

### SDK Compatibility

The generated SDK (`packages/sdk/js/`) adds a `workspace` query parameter to **every** endpoint (it appears in `Project.list`, `Project.current`, `Session.list`, etc. via the global query validator). This is an **additive, non-breaking change** -- existing SDK calls without `workspace` continue to work as before.

New SDK types added:

- `Workspace` type with `id`, `branch`, `projectID`, `config`
- `EventWorkspaceReady` and `EventWorkspaceFailed` event types
- `Session.workspaceID` optional field
- `ExperimentalWorkspaceCreate`, `ExperimentalWorkspaceList`, `ExperimentalWorkspaceRemove` operations

The extension must be updated to the new SDK version to use workspace features, but will not break on the old SDK version since all additions are optional/additive.

### Session Proxy Middleware Risk

**Medium risk.** When the VS Code extension creates/prompts sessions against a remote workspace, the `SessionProxyMiddleware` transparently proxies the request. If the remote workspace server is down or slow, the extension will receive a network error or timeout instead of a structured JSON error. The SDK's error handling may not gracefully handle non-JSON responses from the proxy path. Specifically:

1. The "workspace not found" case returns a plain-text 500 response, which the SDK will fail to parse as JSON.
2. The adaptor's `request()` returning `undefined` (if the remote server is unreachable) would likely cause a null reference error in the middleware.

### WorkspaceContext Session Filtering

When `workspaceID` is set, `Session.list()` adds a filter condition (`workspace_id = ?`). This means the extension will only see sessions belonging to the active workspace. If the extension switches workspaces without updating the query parameter, it may appear to "lose" sessions. This is by design, but is a behavioral change the extension must account for.

---

## Overall Risk

**Medium.**

The changes are well-structured and additive. The primary risks are:

1. **Merge conflict in `openapi.json`**: The SDK's `openapi.json` patch contains a **git merge conflict marker** (`<<<<<<< HEAD` / `>>>>>>> kevinvandijk/opencode-v1.2.16`) that must be resolved before merge. This is a blocker.

2. **Missing `kilocode_change` markers**: Four files modify shared upstream code without markers. This will complicate future upstream merges.

3. **Proxy error handling**: The `SessionProxyMiddleware` returns plain-text error responses that bypass Hono's error handling, which is inconsistent with the SDK's expected error format. This could cause parse failures in the VS Code extension when workspace lookup fails.

4. **Feature gating**: The proxy middleware and workspace syncing are gated behind `Installation.isLocal()`, limiting blast radius to development environments. This significantly reduces production risk.

5. **No migration in this file group**: The `WorkspaceTable` schema is a new table. The corresponding migration should exist in the migrations file group -- not reviewed here but should be verified.
