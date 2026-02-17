# Spec 03: Parallel Versions (Multiple Agents on Same Task)

**Depends on:** Spec 01 (worktree support)

## Goal

A user can start N parallel agents on the same prompt, each on its own git worktree. This is the "versions" feature from the old Agent Manager. The user sets a version count (e.g. 3) and the Agent Manager creates 3 worktrees and 3 sessions simultaneously, all running the same initial prompt. Each appears as a separate item in the session list labeled v1, v2, v3.

## Reference

Study the old implementation at `kilocode/src/core/kilocode/agent-manager/AgentManager.ts` — look for the `copies` or `versions` parameter handling and how multiple worktrees were spawned in parallel.

## What to Build

### `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`

Add a version count input to the new agent creation flow (only visible when mode is "Worktree"). Default 1. When > 1, the label shows "+ N Agents".

### `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`

When `copies > 1`:

1. Call `WorktreeManager.createWorktree(prompt)` N times in parallel (`Promise.all`)
2. Call `httpClient.createSession(worktreePath)` for each
3. Call `httpClient.sendMessage(sessionId, parts, worktreePath)` for each
4. Label sessions as `{title} (v1)`, `{title} (v2)`, etc.

All N sessions appear immediately in the list and run concurrently.

## Notes

- This only makes sense in worktree mode — local mode with copies would just be N sessions on the same directory, which is fine but not the primary use case
- Keep the version count reasonable (UI cap at 5 or 10)
- Each version is completely independent after creation — the user can interact with each one separately
