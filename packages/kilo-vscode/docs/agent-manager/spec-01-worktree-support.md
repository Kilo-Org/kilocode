# Spec 01: Git Worktree Support

**Depends on:** nothing (first feature to land)

## Goal

Allow each Agent Manager session to run in an isolated git worktree. The user toggles "Local" vs "Worktree" when starting a new agent. Worktree sessions operate on a dedicated branch at `.kilocode/worktrees/{branch}/`, fully isolated from the main working tree.

## Reference

Study the old implementation at `kilocode/src/core/kilocode/agent-manager/`:

- `WorktreeManager.ts` — all git operations, use this as the primary reference
- `SessionTerminalManager.ts` — VS Code terminal per worktree
- `AgentManager.ts` — how worktrees were wired into session creation

## Files to Create

### `packages/kilo-vscode/src/agent-manager/WorktreeManager.ts`

Port from old `WorktreeManager.ts`. Key methods:

- `createWorktree(prompt, parentBranch?)` — generates `{slug}-{timestamp}` branch name, runs `git worktree add -b {branch} {path}`, returns `{ branch, path, parentBranch }`
- `removeWorktree(path)` — `git worktree remove --force`
- `discoverWorktrees()` — scans `.kilocode/worktrees/`, reads `.kilocode/session-id` from each
- `ensureGitExclude()` — adds `.kilocode/worktrees/` to `{gitDir}/info/exclude`
- `writeSessionId(path, id)` / `readSessionId(path)` — persists session ID for restart recovery

Use `simple-git` (already in monorepo). Worktree path: `{workspaceRoot}/.kilocode/worktrees/{branch}/`

### `packages/kilo-vscode/src/agent-manager/SessionTerminalManager.ts`

Port from old `SessionTerminalManager.ts`:

- `showTerminal(sessionId, cwd, label)` — creates/reveals a VS Code terminal with `cwd` = worktree path
- Tracks `Map<sessionId, vscode.Terminal>`, cleans up on `vscode.window.onDidCloseTerminal`

## Files to Modify

### `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`

- Add `WorktreeManager` and `SessionTerminalManager` as private members
- Add per-session metadata map: `Map<sessionId, { mode: "local" | "worktree", worktree?: { branch, path, parentBranch } }>`
- On session create in worktree mode: call `WorktreeManager.createWorktree()`, then `httpClient.createSession(worktreePath)` — the `x-opencode-directory` header scopes all kilo serve file operations to the worktree
- On session delete: call `WorktreeManager.removeWorktree()` if applicable
- Handle new webview messages: `agentManager.openTerminal` → `SessionTerminalManager.showTerminal()`
- On dispose: clean up WorktreeManager and SessionTerminalManager

### `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`

- Add a `Local` / `Worktree` mode toggle to the new agent creation flow (shown before the first message is sent, or as part of a "New Agent" form state)
- Show a worktree badge/icon on session list items that are running in worktree mode
- Show an "Open Terminal" icon button per session item when `mode === "worktree"`
- Post `{ type: "agentManager.openTerminal", sessionId }` to the extension when clicked

## Notes

- Do NOT add a Refresh button — session list is SSE-driven
- Do NOT add a Share button — not implemented in new stack
- The `x-opencode-directory` header is already supported by `HttpClient.createSession(directory)` and `HttpClient.sendMessage(sessionId, parts, directory)` — no server changes needed
- Write session ID file immediately after `createSession()` returns, before sending the first message
