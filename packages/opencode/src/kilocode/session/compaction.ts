import { Effect, Semaphore } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "./prompt-queue"

const locks = new Map<SessionID, { semaphore: Semaphore.Semaphore; refs: number }>()

export namespace KiloSessionCompaction {
  /**
   * The compaction marker that is written but not yet started. Only messages after the last
   * finished assistant count (the same window the prompt loop reads tasks from), and a marker
   * whose summary assistant already exists has started or finished.
   */
  export function pending(msgs: MessageV2.WithParts[]) {
    const pivot = msgs.findLastIndex((msg) => msg.info.role === "assistant" && !!msg.info.finish)
    const tail = msgs.slice(pivot + 1)
    return tail.findLast(
      (msg) =>
        msg.info.role === "user" &&
        msg.parts.some((part) => part.type === "compaction") &&
        !tail.some((other) => other.info.role === "assistant" && other.info.parentID === msg.info.id),
    )
  }

  /**
   * Runs `create` unless a marker is already pending. Serialized per session so concurrent requests cannot both write one.
   * A reused marker is re-targeted so the prompt queue keeps it visible, and an automatic request upgrades a pending
   * manual marker so the compaction still replays or continues the interrupted turn.
   */
  export function once<E, R>(
    session: {
      messages: (input: { sessionID: SessionID }) => Effect.Effect<MessageV2.WithParts[], unknown>
      updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
    },
    sessionID: SessionID,
    request: { auto: boolean; overflow?: boolean },
    create: Effect.Effect<void, E, R>,
  ) {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const entry = locks.get(sessionID) ?? { semaphore: Semaphore.makeUnsafe(1), refs: 0 }
        entry.refs++
        locks.set(sessionID, entry)
        return entry
      }),
      (entry) =>
        entry.semaphore.withPermits(1)(
          Effect.gen(function* () {
            const marker = pending(yield* session.messages({ sessionID }).pipe(Effect.orDie))
            if (!marker) return yield* create
            KiloSessionPromptQueue.retarget(sessionID, marker.info.id)
            const part = marker.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
            if (!part || !request.auto) return
            // overflow=true (strip media) wins over false (preflight replay) and over undefined (no replay)
            const overflow = part.overflow === true ? true : (request.overflow ?? part.overflow)
            if (part.auto && overflow === part.overflow) return
            yield* session.updatePart({ ...part, auto: true, overflow })
          }),
        ),
      (entry) =>
        Effect.sync(() => {
          entry.refs--
          if (entry.refs === 0 && locks.get(sessionID) === entry) locks.delete(sessionID)
        }),
    )
  }

  type Store = {
    updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
    updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  }

  export function create(input: {
    session: Store
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
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
      })
      KiloSessionPromptQueue.retarget(input.sessionID, msg.id)
      return msg
    })
  }
}
