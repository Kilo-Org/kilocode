import type { WebviewMessage } from "../../src/types/messages/agent-manager"

/**
 * Open a PR file from the PR's own worktree.
 *
 * The host resolves a worktree id as well as a session id, so the file opens
 * even when the worktree has no session tab, and never from another context's
 * copy of the path.
 */
export function openFile(
  post: (message: WebviewMessage) => void,
  worktreeId: string,
  filePath: string,
  line?: number,
) {
  post({ type: "agentManager.openFile", sessionId: worktreeId, filePath, line })
}

export function openUrl(post: (message: WebviewMessage) => void, worktreeId: string, url: string) {
  post({ type: "agentManager.openPR", worktreeId, url })
}
