# PR #6622: OpenCode v1.2.16 — Code Review

## Executive summary

370 files changed, 27,872 insertions, 5,669 deletions. This is a major upstream merge introducing:

- Remote workspace support (new control-plane system)
- Automatic compaction recovery from 413 errors
- Orphaned MCP child process cleanup
- Comprehensive UI overhaul (animations, storybook, file/diff refactoring)
- New SDK endpoints for workspace management
- Database migrations adding workspace table and session `workspace_id`
- Turkish locale support
- OpenTUI upgrade to v0.1.86 with markdown rendering enabled by default
- Session child navigation keybinding changes

---

## 🚨 CRITICAL: Unresolved merge conflict

**File**: `packages/sdk/openapi.json`

Unresolved git merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) are present in the OpenAPI spec. This will produce a malformed SDK and **break all clients** including the VS Code extension.

**Action required**: Must be resolved before merging.

---

## OpenCode core (`packages/opencode/src/`)

### Control plane — workspace system (HIGH RISK)

New files:

- `src/control-plane/adaptors/index.ts`
- `src/control-plane/adaptors/types.ts`
- `src/control-plane/adaptors/worktree.ts`
- `src/control-plane/config.ts`
- `src/control-plane/session-proxy-middleware.ts`
- `src/control-plane/sse.ts`
- `src/control-plane/workspace-context.ts`
- `src/control-plane/workspace-server/routes.ts`
- `src/control-plane/workspace-server/server.ts`
- `src/control-plane/workspace.sql.ts`
- `src/control-plane/workspace.ts`

Introduces a full workspace abstraction layer. Workspaces can be "worktree" (local git worktrees) or remote. A `SessionProxyMiddleware` intercepts non-GET session requests and forwards them to remote workspaces. A `WorkspaceContext` propagates workspace IDs through the request chain. A new SSE parser (`parseSSE`) enables event streaming from remote workspace servers.

---

### Extension risk — workspace system

**Risk**: MEDIUM-HIGH

`SessionProxyMiddleware` is added to ALL session routes. It currently gates itself behind `Installation.isLocal()` (development only), but this is a significant change to the request pipeline.

The server now accepts a new `workspace` query parameter and `x-opencode-workspace` header on all routes. Existing clients that don't send these will still work (values are optional). Session listing now filters by `WorkspaceContext.workspaceID` when present — if the VS Code extension's Agent Manager sets workspace headers, sessions will be scoped.

---

### Potential issues — workspace system

`Workspace.create()` uses `setTimeout(async () => {...}, 0)` for initialization which is a code smell — errors in the async callback won't propagate.

`SessionProxyMiddleware` reads `Instance.directory` to check if it starts with `"wrk_"` — this is fragile coupling to the ID format.

The `WorkspaceServer` exposes session mutation routes (non-GET only) which could create confusion if the extension connects to the wrong server.

---

### Server changes (MEDIUM RISK)

Modified files:

- `src/server/server.ts` — Adds `WorkspaceContext.provide()` wrapping around `Instance.provide()`, adds `workspace` query parameter validation
- `src/server/routes/session.ts` — Adds `SessionProxyMiddleware` to session routes
- `src/server/routes/workspace.ts` (new) — CRUD endpoints for workspaces
- `src/server/routes/experimental.ts` — Routes workspace under experimental

Workspace routes are under `/experimental/workspace/`, so they don't conflict with existing routes. The `WorkspaceContext.provide()` wrapper adds another layer of async context around every request. If `WorkspaceContext` throws, it could break all requests.

---

### Auth URL normalization (LOW RISK)

**Files**: `src/auth/index.ts`, `src/config/config.ts`

Normalizes trailing slashes in auth login URLs. `Auth.set()` and `Auth.remove()` now strip trailing slashes and clean up duplicate entries. This fixes a real bug where `https://example.com/` and `https://example.com` were treated as different auth entries.

---

### Flag changes (LOW-MEDIUM RISK)

**File**: `src/flag/flag.ts`

`KILO_EXPERIMENTAL_MARKDOWN` changes from opt-in (`truthy()`) to opt-out (`!falsy()`). Markdown rendering is now **enabled by default** unless explicitly disabled. Low risk for the extension (markdown rendering is a TUI feature), but could affect CLI users who didn't expect markdown.

---

### Config keybinding changes (LOW RISK for extension)

**File**: `src/config/config.ts`

Session child navigation keybindings changed:

- `session_child_cycle`: `<leader>right` → `right`
- `session_child_cycle_reverse`: `<leader>left` → `left`
- `session_parent`: `<leader>up` → `up`
- New: `session_child_first`: `<leader>down`

These are TUI-only keybindings, no impact on VS Code extension.

---

### Environment variable changes (LOW RISK)

**File**: `src/index.ts`

`process.env.OPENCODE = "1"` replaced with `process.env.KILO = "1"` and adds `process.env.KILO_PID = String(process.pid)`. If any extension code checks for `process.env.OPENCODE`, it will break. The new `KILO_PID` is used for MCP orphan process cleanup.

---

### ID system and storage (LOW RISK)

**Files**: `src/id/id.ts`, `src/storage/schema.ts`

Adds `workspace: "wrk"` prefix to the identifier system. Exports `WorkspaceTable` from the schema. Both are purely additive — existing tables and IDs unchanged.

---

## Session management (MEDIUM-HIGH RISK)

### Session schema and workspace scoping

**Files**:

- `src/session/index.ts` — Adds `workspaceID` to `Session.Info`, filters session listing by workspace
- `src/session/session.sql.ts` — Adds `workspace_id` column and index to session table

Session now has a `workspaceID` field added to the Info schema, SQL table, and create/list operations. The `structuredClone(part)` in `updatePart` fixes a real bug where Bus events could mutate shared references.

Session listing behavior changes when `WorkspaceContext.workspaceID` is set — could cause the extension to see different sessions depending on whether it sends workspace headers. The `workspaceID` addition to `Session.Info` schema is a **breaking schema change** for the SDK types, though the field is optional.

---

### Compaction overflow recovery

**Files**:

- `src/session/compaction.ts` — Major overhaul for overflow handling
- `src/session/processor.ts` — Context overflow now triggers compaction instead of failing
- `src/session/prompt.ts` — Passes `overflow` flag through compaction
- `src/session/message-v2.ts` — Adds `isMedia()` helper, `stripMedia` option, `overflow` on `CompactionPart`, fixes completed detection

When a 413 error occurs, the processor now triggers automatic compaction with `overflow: true`. The compaction logic strips media attachments and can replay the last user message after compaction. Previously, `ContextOverflowError` was caught but had a TODO comment. Now it sets `needsCompaction = true` and emits an error event, allowing automatic recovery.

---

### Bug fix — completed detection

**File**: `src/session/message-v2.ts`

`completed.add()` now checks `!msg.info.error` — previously, errored assistant messages could be incorrectly marked as completed, causing messages to be dropped during conversation trimming. This is a correctness fix.

---

## Provider, MCP, PTY

### MCP orphan process cleanup (MEDIUM RISK)

**File**: `src/mcp/index.ts`

Adds a `descendants()` function that uses `pgrep -P` to find all child processes of an MCP server, then kills them with SIGTERM before closing the MCP client. Fixes orphaned processes (e.g., Chrome instances from chrome-devtools-mcp).

Caveats:

- Only runs on non-Windows (`process.platform === "win32"` returns early)
- Uses `(client.transport as any)?.pid` — fragile type assertion
- Empty catch block when killing processes (acceptable here — process may already be dead)
- Could kill unrelated processes if PID reuse occurs between the `pgrep` and `kill` calls (unlikely but possible)

---

### Provider error handling (LOW-MEDIUM RISK)

**File**: `src/provider/error.ts`

Adds `request entity too large` to context overflow patterns. HTTP 413 status code now triggers context overflow handling. HTML error responses get human-readable messages instead of raw markup. Improves error handling — extension will show better error messages.

---

### Cloudflare AI Gateway metadata (LOW RISK)

**File**: `src/provider/provider.ts`

Forwards metadata options to Cloudflare AI Gateway provider. Previously only basic auth was passed. Additive — only affects Cloudflare AI Gateway users.

---

### Gemini schema sanitization fix (LOW RISK)

**File**: `src/provider/transform.ts`

Fixes Gemini schema transformation to avoid injecting sibling keys into combiner nodes (`anyOf`/`oneOf`/`allOf`). Previously, the sanitizer could add `type: "string"` or `items` to nodes that had `anyOf`, breaking Gemini's strict schema validation. Bug fix — should only improve Gemini compatibility.

---

### PTY subscriber tracking overhaul (MEDIUM RISK)

**File**: `src/pty/index.ts`

Major refactoring of WebSocket subscriber tracking. Removes the complex `Subscriber`, `sockets` WeakMap, `owners` WeakMap, `tagSocket`, and `token` functions. Replaces with a simpler approach using `ws.data` as the connection key. Subscribers map changes from `Map<Socket, Subscriber>` to `Map<unknown, Socket>`.

The VS Code extension uses PTY for terminal sessions. The subscriber tracking change could affect how WebSocket connections are managed. The key change is that `ws.data` identity (not internal tracking) determines connection ownership. If the extension's WebSocket implementation reuses `ws.data` objects, connections could collide.

Test changes confirm the behavioral change: previously, mutating `ws.data` fields would cause the subscriber to be dropped; now it stays connected.

---

## CLI changes (LOW-MEDIUM RISK)

### Serve command

**File**: `src/cli/cmd/serve.ts`

Starts workspace syncing on serve and adds graceful shutdown. The extension spawns `kilo serve`, so the addition of workspace syncing on startup means more background work happening — but it's gated behind `Installation.isLocal()`.

---

### Workspace serve rewrite

**File**: `src/cli/cmd/workspace-serve.ts`

Complete rewrite from WebSocket to SSE-based workspace server. If the extension uses `workspace-serve`, this is a **breaking protocol change**.

---

### Import behavior change

**File**: `src/cli/cmd/import.ts`

Import now uses `onConflictDoUpdate` instead of `onConflictDoNothing`, updates `project_id` on conflict. Safer behavior — imported sessions now get their `project_id` updated on conflict.

---

### Auth and TUI (LOW RISK for extension)

**Files**: `src/cli/cmd/auth.ts`, `src/cli/cmd/tui/routes/session/index.tsx`

URL normalization for auth login. Major TUI changes for child session navigation. Both are CLI-only, no impact on VS Code extension.

---

## Database migrations (LOW RISK)

**Files**:

- `migration/20260225215848_workspace/` — Creates new `workspace` table
- `migration/20260227213759_add_session_workspace_id/` — Adds `workspace_id` column to `session` table with index

Both migrations are additive (CREATE TABLE and ALTER TABLE ADD). No data is deleted or modified. The workspace table has a foreign key to project with CASCADE delete. The `session.workspace_id` is nullable (TEXT without NOT NULL), so existing sessions are unaffected. The extension's database will auto-migrate on startup.

---

## SDK changes (CRITICAL)

**Files**:

- `packages/sdk/openapi.json` — **Contains unresolved merge conflict markers**
- `packages/sdk/js/src/v2/gen/sdk.gen.ts` — Auto-generated, 697 insertions
- `packages/sdk/js/src/v2/gen/types.gen.ts` — Auto-generated, 257 insertions

The `openapi.json` has merge conflict markers that will break SDK generation and any client that depends on it.

New API surface (once conflict is resolved):

- All existing endpoints accept optional `workspace` query parameter
- New experimental workspace endpoints: `POST /experimental/workspace/:id`, `GET /experimental/workspace/`, `DELETE /experimental/workspace/:id`
- New `Workspace` type in SDK types
- `Session.Info` now includes optional `workspaceID` field
- `CompactionPart` now includes optional `overflow` boolean

Existing extension code should continue to work without modification once the merge conflict is fixed — changes are additive (new optional parameters, new endpoints, new types).

---

## Frontend packages

### `packages/app/` (85 files) — LOW-MEDIUM RISK for extension

Major refactoring across components, context providers, pages, and i18n:

- **Permission auto-respond**: New `permission-auto-respond.ts` context that can auto-accept all permissions
- **Layout overhaul**: Compact UI mode, recent projects in command palette, new sidebar
- **Session improvements**: Faster session switching via windowed rendering, staged timeline
- **Server connection dialog**: Complete rewrite with username/password support for remote servers
- **Comments system**: New `comments.tsx` context and `comment-note.ts` utility
- **i18n**: Turkish locale added, translations synchronized

`packages/app/` is used by the desktop app and `kilo web`, NOT directly by the VS Code extension. However, shared components in `packages/ui/` and `packages/kilo-ui/` may be affected.

---

### `packages/ui/` (163 files) — MEDIUM RISK for extension

Massive changes:

- **Code/Diff/File component refactoring**: `code.tsx` deleted and replaced by `file.tsx`. `diff.tsx` and `diff-ssr.tsx` deleted and merged into the new file component. This is a **major architectural change** to how code and diffs are rendered.
- **New components**: `motion-spring.tsx`, `text-reveal.tsx`, `text-strikethrough.tsx`, `animated-number.tsx`, `session-retry.tsx`, `tool-count-label.tsx`, `tool-count-summary.tsx`, `tool-status-title.tsx`, `file-media.tsx`, `file-search.tsx`, `line-comment-annotations.tsx`
- **Pierre editor plugins**: New CodeMirror plugins for file find, selection, media, comments
- **Context rename**: `code.tsx` → `file.tsx`, `diff.tsx` context removed
- **Storybook**: Extensive stories added for all components
- **Tabs/CSS**: Major CSS overhaul for tabs, session review, scroll views

If the extension's webview imports from `packages/ui/`, the code/diff/file component refactoring is a **breaking change**. The context rename from `CodeContext` to `FileContext` would break imports. The CSS changes could affect visual appearance.

---

### `packages/kilo-ui/` (8 files) — LOW RISK

Re-exports of new components from `packages/ui/` (animated-number, file, line-comment-annotations, motion-spring, text-reveal, text-strikethrough, file context). Just barrel re-exports.

---

### `packages/desktop/` (24 files) — LOW RISK for extension

Desktop-specific changes: Tauri CLI refactoring, i18n additions, `latest.json` finalizer, Windows PowerShell support, shell path restoration. Separate from the VS Code extension.

---

### `packages/storybook/` (25 files) — NO RISK

New storybook package with mocks and preview configuration. Development tooling only.

---

## Tests (LOW RISK)

New tests:

- `test/auth/auth.test.ts` — Trailing slash normalization
- `test/config/config.test.ts` — Wellknown URL normalization
- `test/control-plane/session-proxy-middleware.test.ts` — Session proxy
- `test/control-plane/sse.test.ts` — SSE parsing
- `test/control-plane/workspace-server-sse.test.ts` — Workspace server SSE streaming
- `test/control-plane/workspace-sync.test.ts` — Workspace syncing
- `test/fixture/db.ts` — New database reset helper
- `test/provider/provider.test.ts` — Cloudflare AI Gateway
- `test/provider/transform.test.ts` — Gemini combiner node handling
- `test/pty/pty-output-isolation.test.ts` — Updated to match new PTY behavior
- `test/session/session.test.ts` — Token propagation via Bus events

Good test coverage for new features. The PTY test was updated to reflect the intentional behavioral change in subscriber tracking (in-place data mutation now keeps the connection alive).

---

## Root/misc files (LOW RISK)

- `package.json` — Dependency reordering
- `bun.lock`, `flake.lock`, `nix/node_modules.nix` — Lock file updates
- `.opencode/glossary/tr.md` — Turkish glossary
- `README.gr.md` — Greek README (new)
- `script/publish.ts` — Minor changes
- `specs/session-composer-refactor-plan.md` — Deleted (240 lines removed)

---

## Risk summary

| Area                  | Risk           | Reason                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------- |
| SDK (merge conflict)  | 🔴 CRITICAL    | Unresolved merge conflict markers in `openapi.json`                  |
| Workspace system      | 🟡 MEDIUM-HIGH | New control plane with session proxy middleware on all routes        |
| Session management    | 🟡 MEDIUM-HIGH | `workspaceID` addition, compaction overflow recovery                 |
| PTY refactoring       | 🟡 MEDIUM      | Subscriber tracking overhaul, behavioral change                      |
| UI code/diff refactor | 🟡 MEDIUM      | Major component architecture change if extension uses `packages/ui/` |
| Provider/MCP          | 🟢 LOW-MEDIUM  | MCP orphan cleanup, error handling improvements                      |
| Auth normalization    | 🟢 LOW         | Bug fix for trailing slashes                                         |
| Database migrations   | 🟢 LOW         | Additive only (new table, new nullable column)                       |
| Desktop/Storybook     | 🟢 LOW         | Separate from VS Code extension                                      |
| Tests                 | 🟢 LOW         | Good coverage of new features                                        |
| i18n/translations     | 🟢 LOW         | Additive Turkish locale                                              |

---

## Recommendations

1. **BLOCKER**: Resolve the merge conflict in `packages/sdk/openapi.json` before merging. Regenerate the SDK after fixing.

2. **Verify VS Code extension compatibility**:
   - Check if the extension imports from `packages/ui/src/context/code.tsx` (renamed to `file.tsx`)
   - Check if the extension imports `diff.tsx` or `code.tsx` from `packages/ui/` (deleted/replaced)
   - Check if the extension checks `process.env.OPENCODE` (replaced with `process.env.KILO`)

3. **Test the workspace feature carefully**: `SessionProxyMiddleware` is added to all session routes and could intercept requests unexpectedly if `Instance.directory` somehow gets set to a workspace ID.

4. **Monitor PTY behavior**: The subscriber tracking change could cause issues with WebSocket connection management in the extension. Test terminal sessions thoroughly.

5. **Test compaction overflow recovery**: The new auto-compaction on 413 errors involves replaying messages and stripping media — complex behavior that should be tested with large conversations.

6. **Note the `process.env.OPENCODE` → `process.env.KILO` change**: Search the VS Code extension codebase for any references to the `OPENCODE` environment variable.
