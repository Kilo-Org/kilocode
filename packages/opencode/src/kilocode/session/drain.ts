import { Context, Deferred, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import type { SessionID } from "@/session/schema"

type Entry = {
  count: number
  parent?: Entry
  waiters: Set<Deferred.Deferred<void>>
}

export type Delivery = { release: () => void; retained: boolean }

export interface Interface {
  readonly hold: (id: SessionID) => Effect.Effect<() => void>
  readonly link: (child: SessionID, parent: SessionID) => Effect.Effect<void>
  readonly wait: (id: SessionID) => Effect.Effect<void>
  readonly track: <A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@kilo/SessionDrain") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(() =>
      Effect.gen(function* () {
        const entries = new Map<SessionID, Entry>()
        const data = { entries, closed: false }
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            data.closed = true
            for (const entry of entries.values()) {
              for (const waiter of entry.waiters) Deferred.doneUnsafe(waiter, Effect.interrupt)
              entry.waiters.clear()
            }
            entries.clear()
          }),
        )
        return data
      }),
    )

    function entry(entries: Map<SessionID, Entry>, id: SessionID) {
      const found = entries.get(id)
      if (found) return found
      const value: Entry = { count: 0, waiters: new Set() }
      entries.set(id, value)
      return value
    }

    function update(value: Entry, delta: number) {
      for (let current: Entry | undefined = value; current; current = current.parent) {
        current.count += delta
        if (current.count !== 0) continue
        for (const waiter of current.waiters) Deferred.doneUnsafe(waiter, Effect.void)
        current.waiters.clear()
      }
    }

    const hold = Effect.fn("SessionDrain.hold")(function* (id: SessionID) {
      const data = yield* InstanceState.get(state)
      if (data.closed) return yield* Effect.interrupt
      const value = entry(data.entries, id)
      update(value, 1)
      let active = true
      return () => {
        if (!active) return
        active = false
        if (!data.closed) update(value, -1)
      }
    })

    const link = Effect.fn("SessionDrain.link")(function* (child: SessionID, parent: SessionID) {
      const data = yield* InstanceState.get(state)
      if (data.closed) return yield* Effect.interrupt
      const value = entry(data.entries, child)
      const ancestor = entry(data.entries, parent)
      if (value.parent === ancestor) return yield* Effect.void
      if (value.parent) return yield* Effect.die(new Error("Session drain parent changed"))
      for (let current: Entry | undefined = ancestor; current; current = current.parent) {
        if (current === value) return yield* Effect.die(new Error("Cyclic session drain ancestry"))
      }
      value.parent = ancestor
      update(ancestor, value.count)
      return yield* Effect.void
    })

    const wait = Effect.fn("SessionDrain.wait")(function* (id: SessionID) {
      const data = yield* InstanceState.get(state)
      const value = entry(data.entries, id)
      while (!data.closed) {
        if (value.count === 0) return yield* Effect.void
        const waiter = Deferred.makeUnsafe<void>()
        value.waiters.add(waiter)
        yield* Deferred.await(waiter).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              value.waiters.delete(waiter)
            }),
          ),
        )
      }
      return yield* Effect.interrupt
    })

    const track = <A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        hold(id),
        () => work,
        (release) => Effect.sync(release),
      )

    return Service.of({ hold, link, wait, track })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
export * as SessionDrain from "./drain"
