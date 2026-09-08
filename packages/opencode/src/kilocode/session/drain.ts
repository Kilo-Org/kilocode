import { Context, Deferred, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { isDisposing, registerBeforeDisposer } from "@/kilocode/effect/instance-registry"
import { capture, type InstanceContext } from "@/kilocode/instance"
import type { SessionID } from "@/session/schema"

type Entry = {
  id: SessionID
  count: number
  children: number
  pins: number
  parent?: Entry
  done: Deferred.Deferred<void>
}

type State = { entries: Map<SessionID, Entry>; closed: boolean }

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
    const active = new Map<string, State>()
    const instances = new WeakMap<InstanceContext, State>()
    let stopped = false

    function close(data: State) {
      if (data.closed) return
      data.closed = true
      for (const entry of data.entries.values()) Deferred.doneUnsafe(entry.done, Effect.void)
      data.entries.clear()
    }

    const off = registerBeforeDisposer((directory) => {
      const data = active.get(directory) ?? { entries: new Map<SessionID, Entry>(), closed: false }
      close(data)
      active.delete(directory)
      const ctx = capture()
      if (ctx?.directory === directory) instances.set(ctx, data)
      return undefined
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        stopped = true
        off()
        for (const data of active.values()) close(data)
        active.clear()
      }),
    )

    const state = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      if (stopped || isDisposing(ctx.directory)) return yield* Effect.interrupt
      const known = instances.get(ctx)
      if (known) return known.closed ? yield* Effect.interrupt : known
      const data = active.get(ctx.directory) ?? { entries: new Map<SessionID, Entry>(), closed: false }
      active.set(ctx.directory, data)
      instances.set(ctx, data)
      return data
    })

    function entry(data: State, id: SessionID) {
      const found = data.entries.get(id)
      if (found) return found
      const value: Entry = { id, count: 0, children: 0, pins: 0, done: Deferred.makeUnsafe<void>() }
      data.entries.set(id, value)
      return value
    }

    function prune(data: State, value: Entry) {
      if (value.count || value.pins || value.parent || value.children) return
      if (data.entries.get(value.id) === value) data.entries.delete(value.id)
    }

    function update(data: State, value: Entry, delta: number) {
      for (let current: Entry | undefined = value; current; current = current.parent) {
        current.count += delta
        if (current.count !== 0) continue
        const done = current.done
        current.done = Deferred.makeUnsafe<void>()
        Deferred.doneUnsafe(done, Effect.void)
        prune(data, current)
      }
    }

    const hold = Effect.fn("SessionDrain.hold")(function* (id: SessionID) {
      const data = yield* state
      const value = entry(data, id)
      update(data, value, 1)
      let held = true
      return () => {
        if (!held) return
        held = false
        if (!data.closed) update(data, value, -1)
      }
    })

    const link = Effect.fn("SessionDrain.link")(function* (child: SessionID, parent: SessionID) {
      const data = yield* state
      const value = entry(data, child)
      const ancestor = entry(data, parent)
      if (value.parent === ancestor) return yield* Effect.void
      if (value.parent) return yield* Effect.die(new Error("Session drain parent changed"))
      for (let current: Entry | undefined = ancestor; current; current = current.parent) {
        if (current === value) return yield* Effect.die(new Error("Cyclic session drain ancestry"))
      }
      value.parent = ancestor
      ancestor.children++
      update(data, ancestor, value.count)
      return yield* Effect.void
    })

    const wait = Effect.fn("SessionDrain.wait")(function* (id: SessionID) {
      const data = yield* state
      const value = data.entries.get(id)
      if (!value) return yield* Effect.void
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          value.pins++
        }),
        () =>
          Effect.gen(function* () {
            while (!data.closed) {
              if (value.count === 0) return yield* Effect.void
              yield* Deferred.await(value.done)
            }
            return yield* Effect.interrupt
          }),
        () =>
          Effect.sync(() => {
            value.pins--
            if (!data.closed) prune(data, value)
          }),
      )
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
