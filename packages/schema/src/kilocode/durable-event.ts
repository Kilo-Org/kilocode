import { Event } from "../event"
import { Prompt } from "../prompt"
import { DateTimeUtcFromMillis } from "../schema"
import { SessionID } from "../session-id"
import { SessionMessage } from "../session-message"

export const PromptPromoted = Event.define({
  type: "session.next.prompt.promoted",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: DateTimeUtcFromMillis,
    sessionID: SessionID,
    messageID: SessionMessage.ID,
    prompt: Prompt,
    timeCreated: DateTimeUtcFromMillis,
  },
})
