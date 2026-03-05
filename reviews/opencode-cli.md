# PR #6622 — OpenCode v1.2.16: CLI File Group Review

## Files Reviewed

| File                                                         | Status   | +/-        | Area                                                |
| ------------------------------------------------------------ | -------- | ---------- | --------------------------------------------------- |
| `packages/opencode/src/cli/cmd/serve.ts`                     | modified | +12 / -1   | Serve command (critical path for VS Code extension) |
| `packages/opencode/src/cli/cmd/workspace-serve.ts`           | modified | +5 / -48   | Workspace serve command                             |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | modified | +146 / -84 | TUI session view                                    |
| `packages/opencode/src/cli/cmd/auth.ts`                      | modified | +4 / -3    | Auth login URL handling                             |
| `packages/opencode/src/cli/cmd/import.ts`                    | modified | +8 / -3    | Session import command                              |

---

## Summary

This file group introduces workspace syncing into the `kilo serve` command (dev-only, gated behind `Installation.isLocal()`), replaces the inline WebSocket workspace server with a new `WorkspaceServer` abstraction, refactors TUI child-session navigation to filter parent sessions out of cycling, adds a new `moveFirstChild()` helper and `childSessionHandler()` pattern, and makes two minor fixes to auth URL normalization and session import upsert behavior.

---

## Detailed Findings

### 1. `packages/opencode/src/cli/cmd/serve.ts`

**What changed:** Three new imports (`Workspace`, `Project`, `Installation`) are added. After the server starts listening, a workspace-syncing loop is conditionally started for each project when `Installation.isLocal()` returns true. Workspace sync handles are stopped during graceful shutdown. The `// kilocode_change` comment on the `console.log` line was removed (the line itself stays).

**Observations:**

- **`let` usage:** The variable `workspaceSync` is declared with `let` and conditionally reassigned. The project style guide explicitly discourages `let`. This could be refactored to a `const` using an iife or ternary:

  ```ts
  const workspaceSync = Installation.isLocal() ? Project.list().map((project) => Workspace.startSyncing(project)) : []
  ```

- **Missing `kilocode_change` marker on the `console.log` line:** The original line had `// kilocode_change` at the end (the `kilo server` wording is a Kilo-specific deviation from upstream `opencode server`). The PR removes that marker. Per the fork merge process guidelines, Kilo-specific changes in shared upstream files should retain `kilocode_change` markers. If the upstream message differs, removing the marker will make it harder to identify during future merges.

- **Shutdown ordering:** `workspaceSync` items are stopped _after_ `server.stop(true)`. If any sync handle's `.stop()` depends on the server still being alive (e.g., to flush pending HTTP calls), this could silently fail. The `try/finally` block means `abort.abort()` fires regardless, but errors from `Promise.all(workspaceSync.map(...))` would propagate up and could mask the shutdown. Consider whether sync should be stopped _before_ the server.

- **`Installation.isLocal()` guard:** The comment says "Only available in development right now." This means workspace syncing is a no-op in production builds (i.e., when the VS Code extension spawns `kilo serve`). This is safe for the extension today, but once the feature is enabled in production the extension will inherit the additional background work without any opt-in.

- **No error handling around `Project.list()`:** If the database is empty or corrupt, `Project.list()` could throw. This would crash the serve command before it enters the event loop. A `.catch()` or guard would make startup more robust.

- **Startup output unchanged:** The `console.log` template remains `kilo server listening on http://${server.hostname}:${server.port}`. The VS Code extension's `parseServerPort()` regex (`/listening on http:\/\/[\w.]+:(\d+)/`) will continue to match correctly. No breakage here.

### 2. `packages/opencode/src/cli/cmd/workspace-serve.ts`

**What changed:** The entire inline `Bun.serve()` WebSocket server implementation (health endpoint, `/ws` upgrade, message echo) is removed and replaced with a single call to `WorkspaceServer.listen(opts)`. The `Installation` import is dropped; `WorkspaceServer` from `../../control-plane/workspace-server/server` is imported instead. The describe string changes from "websocket server" to "event server".

**Observations:**

- **Good refactor:** Moving the server implementation into a dedicated module (`control-plane/workspace-server/server`) follows separation of concerns. The command file is now a thin CLI entry point.

- **`WorkspaceServer` module not in this file group:** The new `WorkspaceServer` implementation is not included in the `opencode-cli.json` patch set, so we cannot verify its behavior, error handling, or whether it preserves the `/health` endpoint contract. The review of the `opencode-control-plane.json` group should confirm this.

- **Protocol change (WebSocket to "event server"):** The describe string change from "websocket server" to "event server" suggests the transport may have changed (e.g., from WebSocket to SSE or another mechanism). If any external client depended on the WebSocket protocol at `/ws`, this is a breaking change. The VS Code extension does not currently consume `workspace-serve` directly (it uses `kilo serve`), so no immediate breakage, but this should be documented.

- **`await new Promise(() => {})` replaced:** The old code used `await new Promise(() => {})` to keep the process alive. The new `WorkspaceServer.listen(opts)` presumably handles its own keep-alive. If not, the process would exit immediately.

### 3. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**What changed (per patch, +146/-84):**

- **New imports:** `onMount` from solid-js, `DialogContext` type from `@tui/ui/dialog`.
- **New hooks at component top level:** `useDialog()` and `useRenderer()` are now called at the `Session()` component scope (previously `dialog` and `renderer` were obtained lower in the tree at lines 978-979 on main).
- **New `moveFirstChild()` function:** Navigates to the first child session that has a `parentID`, skipping the parent session itself.
- **Refactored `moveChild(direction)`:** Now filters the `children()` list to only sessions with a `parentID` before cycling. Previously it cycled through all children (including the parent). This fixes a bug where cycling could land on the parent session.
- **New `childSessionHandler()` function:** The patch is truncated at this point, but the function signature `(func: (dialog: DialogContext) => ...)` suggests it wraps command handlers that need dialog context for child sessions.

**Observations:**

- **Duplicate `dialog` / `renderer` declarations:** On `main`, `dialog` is declared at line 978 and `renderer` at line 979 (outside the command registration). The patch adds new declarations at the top of `Session()` (around line 228). If the old declarations at lines 978-979 remain, there would be two `dialog` and two `renderer` variables in scope. Looking at the current file, lines 978-979 are indeed still present. The patch removes the `// kilocode_change` comment from the log line and adds the new declarations, but the later `const dialog = useDialog()` at line 978 and `const renderer = useRenderer()` at line 979 would cause a redeclaration error at compile time. **This is likely resolved by the patch removing or relocating those later declarations** (the +146/-84 diff is large enough to encompass that), but we cannot confirm from the truncated patch.

- **`moveChild` fix is correct:** Filtering to `sessions.filter((x) => !!x.parentID)` before cycling ensures the user never navigates to the parent session when cycling through child sessions. The `findIndex` + modular wrapping logic is preserved.

- **`onMount` imported but usage not visible:** `onMount` is added to the solid-js imports but its usage is not shown in the truncated patch. Presumably used further down for an initialization side effect. Not a concern, but worth confirming it's actually used (unused imports are noise).

- **No impact on VS Code extension:** The TUI session view is only rendered in the terminal UI (`kilo` interactive mode). The VS Code extension communicates via HTTP/SSE and never renders TUI components.

### 4. `packages/opencode/src/cli/cmd/auth.ts`

**What changed:** When `args.url` is provided for well-known auth, the URL is now stripped of trailing slashes before being used for the fetch, `Auth.set()`, and the success message. A new `const url` variable holds the cleaned value.

**Observations:**

- **Correct fix:** Trailing slashes on URLs like `https://example.com/` would produce `https://example.com//.well-known/opencode` (double slash). While most HTTP servers handle this, it's a correctness issue. The `Auth.set()` call also benefits — previously a URL with a trailing slash and without would be stored as different credentials.

- **Regex is sound:** `/\/+$/` correctly matches one or more trailing slashes. No edge cases with this pattern.

- **No impact on VS Code extension.** Auth login is a CLI-interactive command. The extension handles auth through its own webview flow.

### 5. `packages/opencode/src/cli/cmd/import.ts`

**What changed:** Session import now sets `project_id` on the imported session row using `Instance.project.id`. The conflict strategy changed from `onConflictDoNothing()` to `onConflictDoUpdate()` — on conflict, the `project_id` is updated to the current project's ID.

**Observations:**

- **Behavioral change:** Previously, re-importing a session was a no-op (conflict ignored). Now it updates the session's `project_id` to the importing project. This means importing a session into a different project will reassign it. This is likely intentional (the session should belong to the project it's imported into), but it's a semantic change worth noting.

- **`Instance.project.id` availability:** The import command runs inside `bootstrap(process.cwd(), ...)`, which calls `Instance.provide()`. So `Instance.project` should be available. However, if `Instance.project` is ever undefined (e.g., bootstrap failure), this would throw. The existing code at line 210 (`bootstrapImportedSessionIngest`) already depends on a successful bootstrap, so this is consistent.

- **No impact on VS Code extension.** The import command is CLI-only.

---

## Risk to VS Code Extension

| Change                                                             | Risk               | Rationale                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serve.ts` — workspace sync addition                               | **Low**            | Gated behind `Installation.isLocal()`, which is `false` for production builds. The extension spawns a release binary, so this code path is never entered. Startup output format is unchanged; `parseServerPort()` continues to work. Shutdown adds `workspaceSync.stop()` calls, but the array is empty in production so `Promise.all([])` resolves immediately. |
| `serve.ts` — removed `kilocode_change` marker                      | **None (process)** | No runtime effect. Minor merge-hygiene concern for future upstream syncs.                                                                                                                                                                                                                                                                                        |
| `workspace-serve.ts` — refactor to `WorkspaceServer`               | **None**           | The VS Code extension does not use the `workspace-serve` command.                                                                                                                                                                                                                                                                                                |
| `tui/routes/session/index.tsx` — child session navigation refactor | **None**           | TUI components are never rendered by the VS Code extension.                                                                                                                                                                                                                                                                                                      |
| `auth.ts` — trailing-slash normalization                           | **None**           | CLI-interactive auth command. Extension auth flows are independent.                                                                                                                                                                                                                                                                                              |
| `import.ts` — upsert with `project_id`                             | **None**           | CLI-only import command. Extension does not invoke `kilo import`.                                                                                                                                                                                                                                                                                                |

---

## Overall Risk

**Low.**

The only file on the critical path for the VS Code extension is `serve.ts`. The new workspace-syncing code is fully gated behind a dev-only flag (`Installation.isLocal()`) and will not execute when the extension spawns the release CLI binary. The stdout format used by the extension to detect the server port is unchanged. Shutdown behavior adds a no-op `Promise.all([])` in production. All other changes are confined to CLI-interactive commands or the TUI, neither of which the extension touches.

**Action items (non-blocking):**

1. **Style:** Refactor the `let workspaceSync` in `serve.ts` to a `const` per project style guide.
2. **Markers:** Consider restoring the `// kilocode_change` comment on the `console.log` line in `serve.ts` to preserve merge traceability.
3. **Confirm `onMount` usage:** Verify the TUI patch actually uses the newly imported `onMount` and that the `dialog`/`renderer` redeclaration issue is resolved by the full diff.
4. **Review `WorkspaceServer`:** The `opencode-control-plane.json` patch group should be reviewed to validate the new server implementation preserves necessary contracts.
