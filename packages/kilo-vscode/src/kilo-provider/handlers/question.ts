/**
 * Question handlers — extracted from KiloProvider.
 *
 * Manages question reply and reject flows from the tool question UI,
 * plus recovery of pending questions after SSE reconnections or child-session syncs.
 * No vscode dependency.
 */

import type { KiloClient, QuestionRequest } from "@kilocode/sdk/v2/client"

export interface QuestionContext {
  readonly client: KiloClient | null
  readonly currentSessionId: string | undefined
  readonly trackedSessionIds: Set<string>
  readonly sessionDirectories: ReadonlyMap<string, string>
  readonly extraDirectories?: () => string[]
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
  recordQuestionDirectory(requestID: string, directory: string): void
  getQuestionDirectory(requestID: string): string | undefined
  clearQuestionDirectory(requestID: string): void
  getQuestionRevision(): number
  pruneQuestionDirectories(active: Set<string>, dirs: Set<string>): void
}

interface QuestionRecovery {
  readonly seen: Set<string>
  readonly complete: boolean
}

type QuestionRoute = { kind: "retry"; dir: string } | { kind: "stale" } | { kind: "failed" }

function isNotFoundError(error: unknown): boolean {
  const record = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  const obj = record(error)
  if (!obj) return false

  const cause = record(obj.cause)
  const body = record(cause?.body)
  return [obj, record(obj.data), cause, body, record(body?.data)].some(
    (value) => value?.name === "NotFoundError" || value?._tag === "NotFound" || value?.status === 404,
  )
}

async function recover(ctx: QuestionContext, requestID: string): Promise<QuestionRoute> {
  const result = await fetchAndSendPendingQuestions(ctx, requestID)
  if (!result) return { kind: "failed" }
  if (result.seen.has(requestID)) {
    const dir = ctx.getQuestionDirectory(requestID)
    return dir ? { kind: "retry", dir } : { kind: "failed" }
  }
  // Absence only proves staleness when every directory was scanned.
  if (!result.complete) return { kind: "failed" }
  ctx.clearQuestionDirectory(requestID)
  ctx.postMessage({ type: "questionResolved", requestID })
  return { kind: "stale" }
}

/**
 * Fetch all pending questions from the backend and forward any that belong
 * to tracked sessions to the webview. Mirrors fetchAndSendPendingPermissions —
 * called after child-session sync and after SSE reconnects so missed
 * question.asked events don't leave the server blocked indefinitely.
 */
export async function fetchAndSendPendingQuestions(
  ctx: QuestionContext,
  omit?: string,
): Promise<QuestionRecovery | undefined> {
  if (!ctx.client) return
  try {
    for (;;) {
      const dirs = new Set<string>([
        ctx.getWorkspaceDirectory(),
        ...ctx.sessionDirectories.values(),
        ...(ctx.extraDirectories?.() ?? []),
      ])
      const revision = ctx.getQuestionRevision()
      const seen = new Set<string>()
      const scanned = new Set<string>()
      const failed = new Set<string>()
      const pending: Array<{ question: QuestionRequest; dir: string }> = []
      for (const dir of dirs) {
        const { data, error } = await ctx.client.question.list({ directory: dir })
        if (error) {
          failed.add(dir)
          console.error(`[Kilo New] KiloProvider: Failed to fetch pending questions for ${dir}:`, error)
          continue
        }
        scanned.add(dir)
        if (!data) continue
        for (const q of data) {
          if (seen.has(q.id)) continue
          seen.add(q.id)
          if (!ctx.trackedSessionIds.has(q.sessionID)) continue
          pending.push({ question: q, dir })
        }
      }
      if (ctx.getQuestionRevision() !== revision) continue
      for (const item of pending) {
        ctx.recordQuestionDirectory(item.question.id, item.dir)
        // The omitted request is mid-reply; its card is still visible, so
        // reposting it would only churn the webview.
        if (item.question.id === omit) continue
        ctx.postMessage({
          type: "questionRequest",
          question: {
            id: item.question.id,
            sessionID: item.question.sessionID,
            questions: item.question.questions,
            blocking: item.question.blocking,
            tool: item.question.tool,
          },
        })
      }
      ctx.pruneQuestionDirectories(seen, scanned)
      return { seen, complete: failed.size === 0 }
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
  const dir = ctx.getQuestionDirectory(requestID) ?? ctx.getWorkspaceDirectory(sid)

  try {
    await ctx.client.question.reply({ requestID, answers, directory: dir }, { throwOnError: true })
    ctx.clearQuestionDirectory(requestID)
    return true
  } catch (error) {
    const route = isNotFoundError(error) ? await recover(ctx, requestID) : undefined
    if (route?.kind === "stale") return false
    if (route?.kind === "retry" && route.dir !== dir) {
      try {
        await ctx.client.question.reply({ requestID, answers, directory: route.dir }, { throwOnError: true })
        ctx.clearQuestionDirectory(requestID)
        return true
      } catch (retry) {
        console.error("[Kilo New] KiloProvider: Failed to reply to recovered question:", retry)
        ctx.postMessage({ type: "questionError", requestID })
        return false
      }
    }
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
  const dir = ctx.getQuestionDirectory(requestID) ?? ctx.getWorkspaceDirectory(sid)

  try {
    await ctx.client.question.reject({ requestID, directory: dir }, { throwOnError: true })
    ctx.clearQuestionDirectory(requestID)
    return true
  } catch (error) {
    const route = isNotFoundError(error) ? await recover(ctx, requestID) : undefined
    if (route?.kind === "stale") return false
    if (route?.kind === "retry" && route.dir !== dir) {
      try {
        await ctx.client.question.reject({ requestID, directory: route.dir }, { throwOnError: true })
        ctx.clearQuestionDirectory(requestID)
        return true
      } catch (retry) {
        console.error("[Kilo New] KiloProvider: Failed to reject recovered question:", retry)
        ctx.postMessage({ type: "questionError", requestID })
        return false
      }
    }
    console.error("[Kilo New] KiloProvider: Failed to reject question:", error)
    ctx.postMessage({ type: "questionError", requestID })
    return false
  }
}
