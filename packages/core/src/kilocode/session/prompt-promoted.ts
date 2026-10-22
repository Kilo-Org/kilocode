import { PromptPromoted } from "@opencode-ai/schema/kilocode/durable-event"
import { Effect } from "effect"
import { Database } from "../../database/database"
import { SessionEvent } from "../../session/event"
import { SessionInput } from "../../session/input"

export const definition = PromptPromoted

export function project<E, R>(
  db: Database.Interface["db"],
  event: typeof PromptPromoted.Type,
  commit: (event: typeof SessionEvent.Prompted.Type) => Effect.Effect<void, E, R>,
) {
  return Effect.gen(function* () {
    if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
    const admitted = yield* SessionInput.find(db, event.data.messageID)
    if (!admitted) return yield* Effect.die(new SessionInput.LifecycleConflict({ id: event.data.messageID }))
    const prompted = SessionEvent.Prompted.make({
      id: event.id,
      type: SessionEvent.Prompted.type,
      durable: event.durable,
      location: event.location,
      metadata: event.metadata,
      data: {
        sessionID: event.data.sessionID,
        messageID: event.data.messageID,
        timestamp: event.data.timeCreated,
        prompt: event.data.prompt,
        delivery: admitted.delivery,
      },
    })
    yield* SessionInput.projectPrompted(db, {
      id: prompted.data.messageID,
      sessionID: prompted.data.sessionID,
      prompt: prompted.data.prompt,
      delivery: prompted.data.delivery,
      timeCreated: prompted.data.timestamp,
      promotedSeq: event.durable.seq,
    })
    yield* commit(prompted)
  })
}
