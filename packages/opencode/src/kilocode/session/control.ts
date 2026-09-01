import { Effect, Latch } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "@/session/schema"

export namespace KiloSessionControl {
  export type AbortScope = "session" | "tree"
  export type Ticket = { current: () => boolean; running: () => boolean }

  type State = {
    version: number
    paused: boolean
    stopping: number
    ready: Latch.Latch
  }

  export function background(
    parts: ReadonlyArray<{ type: string; synthetic?: boolean; metadata?: Record<string, unknown> }>,
  ) {
    return parts.some((part) => part.type === "text" && part.synthetic && part.metadata?.background === true)
  }

  export const make = Effect.gen(function* () {
    const state = yield* InstanceState.make(() => Effect.succeed(new Map<SessionID, State>()))
    const get = Effect.fn("KiloSessionControl.get")(function* (id: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.get(id)
      if (existing) return existing
      const next: State = { version: 0, paused: false, stopping: 0, ready: Latch.makeUnsafe(true) }
      data.set(id, next)
      return next
    })

    const begin = Effect.fn("KiloSessionControl.begin")(function* (id: SessionID, resume: boolean) {
      const data = yield* get(id)
      if (resume) {
        while (data.stopping > 0) yield* data.ready.await
        data.paused = false
      }
      const version = data.version
      return {
        current: () => version === data.version,
        running: () => version === data.version && !data.paused,
      } satisfies Ticket
    })

    const stop = <A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          const data = yield* get(id)
          data.version++
          data.paused = true
          data.stopping++
          yield* data.ready.close
          return data
        }),
        () => work,
        (data) =>
          Effect.gen(function* () {
            data.stopping--
            if (data.stopping === 0) yield* data.ready.open
          }),
      )

    return { begin, stop }
  })
}
