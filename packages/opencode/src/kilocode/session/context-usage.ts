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
    persist?: (overhead: number) => void,
  ) {
    if (preflight !== true || !usage) return
    overheads.delete(sessionID)
    overheads.set(sessionID, { ...binding, overhead: usage.overhead })
    if (overheads.size > LIMIT) {
      const oldest = overheads.keys().next().value
      if (oldest !== undefined) overheads.delete(oldest)
    }
    persist?.(usage.overhead)
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
    const full = yield* MessageV2.stream(input.sessionID)
    const messages = MessageV2.filterCompacted(full)
    const next = KiloSessionMessageOrder.latest(messages).user
    if (!next || next.model.providerID !== input.model.providerID || next.model.modelID !== input.model.id) return
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
    const recorded = overheads.get(input.sessionID)
    const matches = (binding: Binding) =>
      binding.agent === next.agent &&
      binding.providerID === next.model.providerID &&
      binding.modelID === next.model.modelID
    const stored = full
      .map((msg) => msg.info)
      .filter(
        (info): info is MessageV2.Assistant & { contextOverhead: number } =>
          info.role === "assistant" &&
          !info.summary &&
          typeof info.contextOverhead === "number" &&
          Number.isInteger(info.contextOverhead) &&
          info.contextOverhead >= 0,
      )
    // Prefer the current binding. With no match, a recent same-session request
    // is still a better marked estimate than the pre-compaction context size.
    const overhead =
      recorded && matches(recorded)
        ? recorded.overhead
        : (stored.find(matches)?.contextOverhead ??
          stored.find((info) => info.agent === next.agent)?.contextOverhead ??
          stored.at(0)?.contextOverhead ??
          recorded?.overhead)
    if (overhead === undefined) return
    const history = yield* MessageV2.toModelMessagesEffect(
      KiloSessionPrompt.maybeStripHistoricalMedia(KiloSessionPrompt.trimBeforeLastSummary(messages)),
      input.model,
    )
    const estimate = overhead + KiloSessionOverflow.measure({ messages: history, tools: {} }).normalized
    yield* input.session.updateMessage({ ...target, estimate })
  })
}
