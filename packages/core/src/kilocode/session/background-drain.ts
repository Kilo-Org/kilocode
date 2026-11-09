import { Effect, Option, Schema } from "effect"
import { SessionSchema } from "../../session/schema"
import type { SessionDrain } from "./drain"

/** Existing background producers identify their owner in metadata. Unowned jobs are unrelated. */
export function reserve(drain: Option.Option<SessionDrain.Interface>, id: string, metadata?: Record<string, unknown>) {
  if (Option.isNone(drain)) return Effect.succeed(() => {})
  const owners = [...new Set([metadata?.sessionID, metadata?.parentSessionID, id].filter(Schema.is(SessionSchema.ID)))]
  return Effect.forEach(owners, drain.value.hold).pipe(
    Effect.map((releases) => () => {
      for (const release of releases) release()
    }),
  )
}
