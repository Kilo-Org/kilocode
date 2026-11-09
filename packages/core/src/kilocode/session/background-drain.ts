import { Effect, Option, Schema } from "effect"
import { SessionSchema } from "../../session/schema"
import type { SessionDrain } from "./drain"

/** Existing background producers identify their owner in metadata. Unowned jobs are unrelated. */
export function reserve(drain: Option.Option<SessionDrain.Interface>, id: string, metadata?: Record<string, unknown>) {
  if (Option.isNone(drain)) return Effect.succeed(() => {})
  const owners = [...new Set([metadata?.sessionID, metadata?.parentSessionID, id].filter(Schema.is(SessionSchema.ID)))]
  const releases: Array<() => void> = []
  const release = () => {
    for (const item of releases) item()
  }
  // Roll back holds already acquired when a later owner fails or the reservation is interrupted.
  return Effect.forEach(
    owners,
    (owner) => Effect.uninterruptible(drain.value.hold(owner).pipe(Effect.map((item) => releases.push(item)))),
    { discard: true },
  ).pipe(
    Effect.onError(() => Effect.sync(release)),
    Effect.as(release),
  )
}
