import { Effect } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { Session } from "@/session/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { KiloSessionPromptQueue } from "./prompt-queue"

export namespace KiloSessionCompaction {
  // Terminal compaction failure: log and publish the error already recorded on the message.
  export function stop(input: {
    events: Pick<EventV2.Interface, "publish">
    sessionID: SessionID
    error: MessageV2.Assistant["error"]
  }) {
    return Effect.gen(function* () {
      yield* Effect.logError("compaction failed", { "session.id": input.sessionID, error: input.error })
      yield* input.events.publish(Session.Event.Error, { sessionID: input.sessionID, error: input.error })
      return "stop" as const
    })
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
