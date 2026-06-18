import { type LanguageModelUsage, type streamText } from "ai"
import { SessionExport } from "./index"

type Result = Awaited<ReturnType<typeof streamText>>
type Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export function observeFullStreamForExport(
  stream: AsyncIterable<Event>,
  meta: {
    sessionId: string
    rootSessionId: string
    parentSessionId?: string
    requestId: string
    workspaceKey?: string
    started: number
    retries: number
  },
  complete: (args: Parameters<typeof SessionExport.afterRequest>[0]) => void = SessionExport.afterRequest,
): AsyncIterable<Event> {
  const textParts: string[] = []
  const reasoningParts: string[] = []
  const toolCalls: Event[] = []
  let finishReason: string | undefined
  let usage:
    | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
    | undefined
  let finished = false
  let reported = false
  const done = (error?: unknown) => {
    if (reported) return
    reported = true
    try {
      complete({
        sessionId: meta.sessionId,
        rootSessionId: meta.rootSessionId,
        parentSessionId: meta.parentSessionId,
        requestId: meta.requestId,
        workspaceKey: meta.workspaceKey,
        output: { textParts, reasoningParts, toolCalls, finishReason, error, usage },
        durationMs: Date.now() - meta.started,
        retryCount: meta.retries,
      })
    } catch (err) {
      console.warn("[session-export] request completion export failed", err)
    }
  }
  const observed = async function* () {
    try {
      for await (const part of stream) {
        collectPart(part, {
          textParts,
          reasoningParts,
          toolCalls,
          setFinish: (val) => (finishReason = val),
          setUsage: (val) => (usage = val),
        })
        yield part
      }
      finished = true
    } catch (err) {
      done(err)
      throw err
    } finally {
      done(finished ? undefined : { code: "stream_cancelled" })
    }
  }
  return observed()
}

function collectPart(
  part: Event,
  out: {
    textParts: string[]
    reasoningParts: string[]
    toolCalls: Event[]
    setFinish: (value: string | undefined) => void
    setUsage: (
      value:
        | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
        | undefined,
    ) => void
  },
): void {
  switch (part.type) {
    case "text-delta":
      if (part.text) out.textParts.push(part.text)
      return
    case "reasoning-delta":
      if (part.text) out.reasoningParts.push(part.text)
      return
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
    case "tool-call":
    case "tool-result":
    case "tool-error":
    case "tool-output-denied":
    case "tool-approval-request":
      out.toolCalls.push(part)
      return
    case "finish-step":
      out.setFinish(part.finishReason)
      out.setUsage(normalizeUsageForExport(part.usage))
      return
    case "finish":
      out.setFinish(part.finishReason)
      out.setUsage(normalizeUsageForExport(part.totalUsage))
      return
    default:
      return
  }
}

export function normalizeUsageForExport(value: Partial<LanguageModelUsage>) {
  const inputTokens = value.inputTokens ?? 0
  const outputTokens = value.outputTokens ?? 0
  const cacheReadTokens = value.inputTokenDetails?.cacheReadTokens ?? undefined
  const cacheWriteTokens = value.inputTokenDetails?.cacheWriteTokens ?? undefined
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}
