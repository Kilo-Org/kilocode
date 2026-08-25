import { Effect } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "./prompt-queue"
import { KiloSessionMessageOrder } from "./message-order"

export namespace KiloSessionCompaction {
  type Store = {
    updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
    updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  }

  export function resolve(input: { part: MessageV2.CompactionPart; messages: MessageV2.WithParts[] }) {
    const marker = input.messages.find((msg) => msg.info.id === input.part.messageID)
    if (!marker) return { kind: "unresolved" as const, reason: "marker is missing" }
    const markerIndex = input.messages.indexOf(marker)
    const indexes = new Map(input.messages.map((msg, index) => [msg.info.id, index]))
    const compare = (a: MessageV2.WithParts, b: MessageV2.WithParts) =>
      KiloSessionMessageOrder.compare(a, b, indexes.get(a.info.id) ?? -1, indexes.get(b.info.id) ?? -1)
    const before = input.messages.filter(
      (msg, index) => KiloSessionMessageOrder.compare(msg, marker, index, markerIndex) < 0,
    )
    const users = before.filter(
      (msg) => msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction"),
    )
    if (input.part.pending_user_id) {
      const target = input.messages.find((msg) => msg.info.id === input.part.pending_user_id)
      if (target?.info.role !== "user" || target.parts.some((part) => part.type === "compaction"))
        return { kind: "unresolved" as const, reason: "pending user is missing" }
      if (compare(target, marker) >= 0) return { kind: "unresolved" as const, reason: "pending user is after marker" }
      return { kind: "found" as const, message: target }
    }
    const done = (id: MessageID) =>
      input.messages.some(
        (item) =>
          item.info.role === "assistant" &&
          item.info.parentID === id &&
          !!item.info.finish &&
          item.info.finish !== "tool-calls",
      )
    const open = users.filter((msg) => !done(msg.info.id))
    if (open.length === 1) return { kind: "found" as const, message: open[0]! }
    if (open.length === 0 && users.length === 1) return { kind: "stale" as const }
    return { kind: "unresolved" as const, reason: "pending user is ambiguous" }
  }

  export function followups(input: { messages: MessageV2.WithParts[]; after: MessageV2.WithParts }) {
    const anchor = input.messages.find((msg) => msg.info.id === input.after.info.id)
    if (!anchor) return [] as MessageV2.User[]
    const indexes = new Map(input.messages.map((msg, index) => [msg.info.id, index]))
    const compare = (a: MessageV2.WithParts, b: MessageV2.WithParts) =>
      KiloSessionMessageOrder.compare(a, b, indexes.get(a.info.id) ?? -1, indexes.get(b.info.id) ?? -1)
    const done = (id: MessageID) =>
      input.messages.some(
        (msg) =>
          msg.info.role === "assistant" &&
          msg.info.parentID === id &&
          !!msg.info.finish &&
          msg.info.finish !== "tool-calls",
      )
    return input.messages
      .filter(
        (msg) =>
          msg.info.role === "user" &&
          !msg.parts.some((part) => part.type === "compaction") &&
          msg.parts.some((part) => !("synthetic" in part) || !part.synthetic) &&
          compare(msg, anchor) > 0 &&
          !done(msg.info.id),
      )
      .sort(compare)
      .map((msg) => (msg.info.role === "user" ? msg.info : undefined))
      .filter((msg): msg is MessageV2.User => msg !== undefined)
  }

  export function create(input: {
    session: Store
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
    pending_user_id?: MessageID
  }) {
    return Effect.gen(function* () {
      const msg = yield* input.session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* input.session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        pending_user_id: input.pending_user_id,
      })
      KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
      return msg
    })
  }
}
