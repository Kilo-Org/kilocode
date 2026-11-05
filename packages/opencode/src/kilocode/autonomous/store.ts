import { Effect, Schema } from "effect"
import type { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { AutonomousState } from "./state"

/** JSON document per session under the Storage service, key `["autonomous", sessionID]`. */
export namespace AutonomousStore {
  export class Malformed extends Schema.TaggedErrorClass<Malformed>()("AutonomousStateMalformed", {
    sessionID: Schema.String,
    message: Schema.String,
  }) {}

  export const key = (id: SessionID) => ["autonomous", String(id)]

  const decode = (id: SessionID, raw: unknown) =>
    Effect.try({
      try: () => AutonomousState.decode(raw),
      catch: (err) => new Malformed({ sessionID: String(id), message: err instanceof Error ? err.message : String(err) }),
    })

  export const load = Effect.fn("AutonomousStore.load")(function* (id: SessionID) {
    const storage = yield* Storage.Service
    const raw = yield* storage.read<unknown>(key(id)).pipe(
      Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
    )
    if (raw === undefined) return undefined
    return yield* decode(id, raw)
  })

  export const save = Effect.fn("AutonomousStore.save")(function* (state: AutonomousState.Info) {
    const storage = yield* Storage.Service
    state.updated = Date.now()
    yield* storage.write(key(state.sessionID), AutonomousState.encode(state))
    return state
  })

  export const remove = Effect.fn("AutonomousStore.remove")(function* (id: SessionID) {
    const storage = yield* Storage.Service
    yield* storage.remove(key(id))
  })

  export const update = Effect.fn("AutonomousStore.update")(function* <E, R>(
    id: SessionID,
    fn: (state: AutonomousState.Info) => Effect.Effect<void, E, R>,
  ) {
    const state = yield* load(id)
    if (!state) return undefined
    yield* fn(state)
    return yield* save(state)
  })
}
