import type { WebviewMessage } from "../../src/types/messages"

export function openFile(
  post: (message: WebviewMessage) => void,
  sessionId: string | undefined,
  filePath: string,
  line?: number,
) {
  if (!sessionId) return
  post({ type: "agentManager.openFile", sessionId, filePath, line })
}

export function openUrl(post: (message: WebviewMessage) => void, worktreeId: string, url: string) {
  post({ type: "agentManager.openPR", worktreeId, url })
}
