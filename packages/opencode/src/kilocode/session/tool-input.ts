import type { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime } from "effect"
import type { SessionID } from "@/session/schema"

export namespace KiloToolInput {
  /**
   * Publish one streamed fragment of a tool call's input. Clients use it to show
   * a pending call (file path, command, content) while the model still writes
   * the arguments. The event is live only: nothing stores or replays it, and the
   * tool-call event still carries the complete input.
   */
  export function delta(
    events: EventV2.Interface,
    input: { sessionID: SessionID; messageID: string; callID: string; text: string },
  ) {
    return events.publish(SessionEvent.Tool.Input.Delta, {
      sessionID: input.sessionID,
      timestamp: DateTime.makeUnsafe(Date.now()),
      assistantMessageID: SessionMessage.ID.make(input.messageID),
      callID: input.callID,
      delta: input.text,
    })
  }
}
