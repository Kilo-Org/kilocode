import { Effect } from "effect"
import { SessionID } from "@/session/schema"

type Slot = {
  readonly version: number
  readonly previous: Promise<void>
  readonly done: PromiseWithResolvers<void>
  readonly tail: Promise<void>
}

export namespace KiloSessionPromptQueue {
  const tails = new Map<SessionID, Promise<void>>()
  const versions = new Map<SessionID, number>()

  const version = (sessionID: SessionID) => versions.get(sessionID) ?? 0

  export function cancel(sessionID: SessionID) {
    return Effect.sync(() => {
      versions.set(sessionID, version(sessionID) + 1)
    })
  }

  export function enqueue<A, E>(
    sessionID: SessionID,
    work: Effect.Effect<A, E>,
    cancelled: Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = tails.get(sessionID) ?? Promise.resolve()
        const done = Promise.withResolvers<void>()
        const tail = previous.catch(() => {}).then(() => done.promise)
        tails.set(sessionID, tail)
        return { version: version(sessionID), previous, done, tail } satisfies Slot
      }),
      (slot) =>
        Effect.promise(() => slot.previous.catch(() => {})).pipe(
          Effect.flatMap(() => (slot.version === version(sessionID) ? work : cancelled)),
        ),
      (slot) =>
        Effect.sync(() => {
          slot.done.resolve()
          if (tails.get(sessionID) === slot.tail) tails.delete(sessionID)
        }),
    )
  }
}
