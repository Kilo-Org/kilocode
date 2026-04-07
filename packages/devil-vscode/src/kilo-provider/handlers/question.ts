/**
 * Question handlers — extracted from DevilProvider.
 *
 * Manages question reply and reject flows from the tool question UI.
 * No vscode dependency.
 */

import type { DevilClient } from "@devilcode/sdk/v2/client"

interface QuestionContext {
  readonly client: DevilClient | null
  readonly currentSessionId: string | undefined
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
}

/** Handle question reply from the webview. */
export async function handleQuestionReply(
  ctx: QuestionContext,
  requestID: string,
  answers: string[][],
  sessionID?: string,
): Promise<boolean> {
  if (!ctx.client) {
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }

  const sid = sessionID ?? ctx.currentSessionId

  try {
    await ctx.client.question.reply(
      { requestID, answers, directory: ctx.getWorkspaceDirectory(sid) },
      { throwOnError: true },
    )
    return true
  } catch (error) {
    console.error("[Devil New] DevilProvider: Failed to reply to question:", error)
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }
}

/** Handle question reject (dismiss) from the webview. */
export async function handleQuestionReject(
  ctx: QuestionContext,
  requestID: string,
  sessionID?: string,
): Promise<boolean> {
  if (!ctx.client) {
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }

  const sid = sessionID ?? ctx.currentSessionId

  try {
    await ctx.client.question.reject({ requestID, directory: ctx.getWorkspaceDirectory(sid) }, { throwOnError: true })
    return true
  } catch (error) {
    console.error("[Devil New] DevilProvider: Failed to reject question:", error)
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }
}
