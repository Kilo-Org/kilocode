import type { PRCommentRequest, PRCommentResult } from "../../../src/shared/pr-comment-actions"

// Keep the result listener alive while a pending card is collapsed or remounted.
export function reviewRequest(
  message: PRCommentRequest,
  post: (message: never) => void,
  settle: (result: PRCommentResult) => void,
  timeout = 30_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const failure = {
    type: `${message.type}Result`,
    ...(message.projectId === undefined ? {} : { projectId: message.projectId }),
    worktreeId: message.worktreeId,
    requestId: message.requestId,
    ...(message.type === "agentManager.replyComment"
      ? { threadId: message.threadId }
      : message.type === "agentManager.mutateComment"
        ? {}
        : { prNumber: message.prNumber, prUrl: message.prUrl }),
    success: false,
    error: "Request timed out",
  } as PRCommentResult
  const finish = (result: PRCommentResult) => {
    if (done) return
    done = true
    window.removeEventListener("message", handler)
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    settle(result)
  }
  const handler = (event: MessageEvent<PRCommentResult>) => {
    const result = event.data
    if (
      result?.type !== `${message.type}Result` ||
      result.requestId !== message.requestId ||
      result.worktreeId !== message.worktreeId
    )
      return
    // Legacy comment results lack PR identity and only require an explicit project to match.
    const legacy = message.type === "agentManager.replyComment" || message.type === "agentManager.mutateComment"
    if ((!legacy || message.projectId) && result.projectId !== message.projectId) return
    if (
      message.type === "agentManager.replyComment" &&
      (!("threadId" in result) || result.threadId !== message.threadId)
    )
      return
    if (!legacy && (!("prNumber" in result) || result.prNumber !== message.prNumber || result.prUrl !== message.prUrl))
      return
    finish(result)
  }
  window.addEventListener("message", handler)
  timer = setTimeout(() => finish(failure), timeout)
  post(message as never)
  return () => finish(failure)
}
