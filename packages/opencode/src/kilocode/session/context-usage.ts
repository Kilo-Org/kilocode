import { Effect } from "effect"
import { MessageV2 } from "@/session/message-v2"
import type { Session } from "@/session/session"
import type { SessionID, MessageID } from "@/session/schema"
import type { Provider } from "@/provider/provider"
import { KiloSessionOverflow } from "./overflow"
import { KiloSessionPrompt } from "./prompt"
import { KiloSessionMessageOrder } from "./message-order"

export namespace KiloContextUsage {
  const LIMIT = 512
  type Binding = { agent: string; providerID: string; modelID: string }
  const overheads = new Map<string, Binding & { overhead: number }>()

  export function record(
    sessionID: string,
    preflight: boolean | undefined,
    usage: { overhead: number } | undefined,
    binding: Binding,
  ) {
    if (preflight !== true || !usage) return
    overheads.delete(sessionID)
    overheads.set(sessionID, { ...binding, overhead: usage.overhead })
    if (overheads.size > LIMIT) {
      const oldest = overheads.keys().next().value
      if (oldest !== undefined) overheads.delete(oldest)
    }
  }

  export function overhead(sessionID: string) {
    return overheads.get(sessionID)?.overhead
  }

  export const compacted = Effect.fn("KiloContextUsage.compacted")(function* (input: {
    sessionID: SessionID
    parentID: MessageID
    model: Provider.Model
    session: Pick<Session.Interface, "updateMessage">
  }) {
    const recorded = overheads.get(input.sessionID)
    if (!recorded) return
    const messages = yield* MessageV2.filterCompactedEffect(input.sessionID)
    const next = KiloSessionMessageOrder.latest(messages).user
    if (
      !next ||
      recorded.agent !== next.agent ||
      recorded.providerID !== next.model.providerID ||
      recorded.modelID !== next.model.modelID ||
      recorded.providerID !== input.model.providerID ||
      recorded.modelID !== input.model.id
    )
      return
    const target = messages.find(
      (msg) => msg.info.role === "assistant" && msg.info.summary === true && msg.info.parentID === input.parentID,
    )?.info
    if (
      target?.role !== "assistant" ||
      target.time.completed === undefined ||
      !target.finish ||
      target.finish === "error" ||
      target.error
    )
      return
    const history = yield* MessageV2.toModelMessagesEffect(
      KiloSessionPrompt.maybeStripHistoricalMedia(KiloSessionPrompt.trimBeforeLastSummary(messages)),
      input.model,
    )
    const estimate = recorded.overhead + KiloSessionOverflow.measure({ messages: history, tools: {} }).normalized
    yield* input.session.updateMessage({ ...target, estimate })
  })
}
