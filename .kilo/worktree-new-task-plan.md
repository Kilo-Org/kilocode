# Worktree New Task Plan

## Goal

When Agent Manager is focused on a worktree, the in-chat **New Task** action should create the new session in that same worktree, matching the existing new tab behavior.

## Findings

- `ChatView` dispatches `newTaskRequest` for the **New Task** button.
- `PromptInput` handles `newTaskRequest` by calling `session.clearCurrentSession()` and preserving the draft.
- In Agent Manager worktree context, that cleared session has no worktree-scoped directory, so the next prompt creates a local workspace-root session.
- Existing Agent Manager tab actions already do the right thing through `agentManager.addSessionToWorktree`.

## Approach

1. Add a small Agent Manager-only hook for `newTaskRequest` that captures the current sidebar selection.
2. If the selection is a worktree, create a worktree tab via `agentManager.addSessionToWorktree` instead of clearing into a root-scoped blank session.
3. Prevent `PromptInput` from also handling that same event so local/sidebar behavior remains unchanged.
4. Keep local selection behavior unchanged: local sessions still use the existing pending-tab flow.
5. Validate with typecheck or the narrowest available package check.
