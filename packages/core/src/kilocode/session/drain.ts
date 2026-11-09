import { Context, Deferred, Effect, Layer } from "effect"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionSchema } from "../../session/schema"
import { SessionStore } from "../../session/store"

type Entry = {
  id: SessionSchema.ID
  count: number
  pins: number
  children: number
  parent?: Entry
  done: Deferred.Deferred<void>
}

export interface Interface {
  readonly hold: (id: SessionSchema.ID) => Effect.Effect<() => void>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void>
  readonly track: <A, E, R>(id: SessionSchema.ID, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/** Process-local quiescence, including descendants and reserved completion delivery. */
export class Service extends Context.Service<Service, Interface>()("@kilo/core/SessionDrain") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const entries = new Map<SessionSchema.ID, Entry>()
    let closed = false

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
        for (const value of entries.values()) Deferred.doneUnsafe(value.done, Effect.void)
        entries.clear()
      }),
    )

    function entry(id: SessionSchema.ID): Entry {
      const found = entries.get(id)
      if (found) return found
      const value = { id, count: 0, pins: 0, children: 0, done: Deferred.makeUnsafe<void>() }
      entries.set(id, value)
      return value
    }

    function prune(value: Entry) {
      if (value.count || value.pins || value.parent || value.children) return
      if (entries.get(value.id) === value) entries.delete(value.id)
    }

    function update(value: Entry, delta: number) {
      for (let current: Entry | undefined = value; current; current = current.parent) {
        current.count += delta
        if (current.count !== 0) continue
        const done = current.done
        current.done = Deferred.makeUnsafe<void>()
        Deferred.doneUnsafe(done, Effect.void)
        prune(current)
      }
    }

    const hold = Effect.fn("SessionDrain.hold")(function* (id: SessionSchema.ID) {
      // Resolve durable ancestry before accepting work, across Location boundaries too.
      const lineage = new Set<SessionSchema.ID>()
      for (let current: SessionSchema.ID | undefined = id; current; ) {
        if (lineage.has(current)) return yield* Effect.die(new Error("Cyclic session drain ancestry"))
        lineage.add(current)
        current = (yield* store.get(current))?.parentID
      }
      if (closed) return yield* Effect.interrupt
      const chain = Array.from(lineage, entry)
      for (const [index, value] of chain.entries()) {
        const parent = chain.at(index + 1)
        if (!parent || value.parent === parent) continue
        if (value.parent) return yield* Effect.die(new Error("Session drain parent changed"))
        value.parent = parent
        parent.children++
        update(parent, value.count)
      }
      const value = entry(id)
      update(value, 1)
      let held = true
      return () => {
        if (!held) return
        held = false
        if (!closed) update(value, -1)
      }
    })

    const wait = Effect.fn("SessionDrain.wait")(function* (id: SessionSchema.ID) {
      if (closed) return yield* Effect.interrupt
      const value = entries.get(id)
      if (!value) return yield* Effect.void
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => value.pins++),
        () =>
          Effect.gen(function* () {
            while (true) {
              if (closed) return yield* Effect.interrupt
              if (value.count === 0) return yield* Effect.void
              yield* Deferred.await(value.done)
            }
          }),
        () =>
          Effect.sync(() => {
            value.pins--
            if (!closed) prune(value)
          }),
      )
    })

    const track = <A, E, R>(id: SessionSchema.ID, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        hold(id),
        () => work,
        (release) => Effect.sync(release),
      )

    return Service.of({ hold, wait, track })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [SessionStore.node] })
export * as SessionDrain from "./drain"
