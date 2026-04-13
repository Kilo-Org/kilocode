/**
 * Question handlers — extracted from KiloProvider.
 *
 * Manages question reply and reject flows from the tool question UI,
 * plus recovery of pending questions after SSE reconnections or child-session syncs.
 * No vscode dependency.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"

interface QuestionContext {
  readonly client: KiloClient | null
  readonly currentSessionId: string | undefined
  readonly trackedSessionIds: Set<string>
  readonly sessionDirectories: ReadonlyMap<string, string>
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
}

/**
 * Fetch all pending questions from the backend and forward any that belong
 * to tracked sessions to the webview. Mirrors fetchAndSendPendingPermissions —
 * called after child-session sync and after SSE reconnects so missed
 * question.asked events don't leave the server blocked indefinitely.
 */
export async function fetchAndSendPendingQuestions(ctx: QuestionContext): Promise<void> {
  if (!ctx.client) return
  try {
    const dirs = new Set<string>([ctx.getWorkspaceDirectory(), ...ctx.sessionDirectories.values()])
    const seen = new Set<string>()
    for (const dir of dirs) {
      const { data } = await ctx.client.question.list({ directory: dir })
      if (!data) continue
      for (const q of data) {
        if (seen.has(q.id)) continue
        seen.add(q.id)
        if (!ctx.trackedSessionIds.has(q.sessionID)) continue
        ctx.postMessage({
          type: "questionRequest",
          question: {
            id: q.id,
            sessionID: q.sessionID,
            questions: q.questions,
            tool: q.tool,
          },
        })
      }
    }
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to fetch pending questions:", error)
  }
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
    console.error("[Kilo New] KiloProvider: Failed to reply to question:", error)
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
    console.error("[Kilo New] KiloProvider: Failed to reject question:", error)
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }
}
