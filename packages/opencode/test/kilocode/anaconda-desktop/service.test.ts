import { expect } from "bun:test"
import { Auth } from "@/auth"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Deferred, Duration, Effect, Fiber, Layer, Redacted, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import * as Discovery from "../../../src/kilocode/anaconda-desktop/discovery"
import {
  decodeMetadata,
  PROVIDER_ID,
  type Metadata,
  type ReadyStatus,
} from "../../../src/kilocode/anaconda-desktop/domain"
import * as DesktopPlatform from "../../../src/kilocode/anaconda-desktop/platform"
import * as Desktop from "../../../src/kilocode/anaconda-desktop/service"
import { it, testEffect } from "../../lib/effect"

function ready(
  serverID: string,
  port: number,
  key: string,
  toolcall: Metadata["toolcall"] = "supported",
): Discovery.DiscoveryResult {
  const model = `${serverID}.gguf`
  const metadata: Metadata = {
    version: "1",
    serverID,
    baseURL: `http://127.0.0.1:${port}/v1`,
    models: [{ id: model, name: serverID, input: ["text"], output: ["text"] }],
    context: 8192,
    toolcall,
  }
  const status: ReadyStatus = {
    type: "ready",
    serverID,
    models: [{ id: model, name: serverID }],
    context: 8192,
    toolcall,
  }
  return {
    status,
    connection: { key: Redacted.make(key, { label: "fixture inference key" }), metadata },
  }
}

it.live("sync atomically replaces the standard auth record and invalidates provider state", () =>
  Effect.gen(function* () {
    const index = yield* Ref.make(0)
    const records = yield* Ref.make<Record<string, Auth.Info>>({})
    const events = yield* Ref.make<string[]>([])
    const values = [ready("first", 8080, "first-fixture-key"), ready("second", 8081, "second-fixture-key")]

    const discovery = Layer.succeed(
      Discovery.Service,
      Discovery.Service.of({ discover: () => Ref.get(index).pipe(Effect.map((value) => values[value])) }),
    )
    const platform = Layer.succeed(
      DesktopPlatform.Service,
      DesktopPlatform.Service.of({
        info: { platform: "linux", arch: "x64", home: "/tmp", env: {} },
        dataDir: () => Effect.succeed("/tmp"),
        installation: () => Effect.succeed({ path: "/usr/bin/anaconda-desktop" }),
        open: () => Effect.void,
      }),
    )
    const auth = Layer.succeed(
      Auth.Service,
      Auth.Service.of({
        get: (id) => Ref.get(records).pipe(Effect.map((items) => items[id])),
        all: () => Ref.get(records),
        set: (id, value) => Ref.update(records, (items) => ({ ...items, [id]: value })),
        remove: (id) =>
          Ref.update(records, (items) => Object.fromEntries(Object.entries(items).filter(([key]) => key !== id))),
      }),
    )
    const cache = Layer.mock(ModelCache.Service)({
      clear: (id) => Ref.update(events, (items) => [...items, `clear:${id}`]),
    })
    const instances = Layer.mock(InstanceStore.Service)({
      disposeAll: () => Ref.update(events, (items) => [...items, "dispose"]),
    })
    const layer = Desktop.layer.pipe(
      Layer.provide(discovery),
      Layer.provide(platform),
      Layer.provide(auth),
      Layer.provide(cache),
      Layer.provide(instances),
    )

    const first = yield* Desktop.Service.use((service) => service.sync()).pipe(Effect.provide(layer))
    expect(first.serverID).toBe("first")
    const unchanged = yield* Desktop.Service.use((service) => service.sync()).pipe(Effect.provide(layer))
    expect(unchanged.serverID).toBe("first")
    expect(yield* Ref.get(events)).toEqual([`clear:${PROVIDER_ID}`, "dispose"])
    yield* Ref.set(index, 1)
    const second = yield* Desktop.Service.use((service) => service.sync()).pipe(Effect.provide(layer))
    expect(second.serverID).toBe("second")

    const stored = (yield* Ref.get(records))[PROVIDER_ID]
    expect(stored?.type).toBe("api")
    if (stored?.type !== "api") throw new Error("standard API auth record was not stored")
    expect(stored.key).toBe("second-fixture-key")
    const metadata = decodeMetadata(stored.metadata)
    expect(metadata?.serverID).toBe("second")
    expect(metadata?.baseURL).toBe("http://127.0.0.1:8081/v1")
    expect(yield* Ref.get(events)).toEqual([`clear:${PROVIDER_ID}`, "dispose", `clear:${PROVIDER_ID}`, "dispose"])
  }),
)

it.live("sync requires acknowledgement for limited tool support", () =>
  Effect.gen(function* () {
    const writes = yield* Ref.make(0)
    const discovery = Layer.succeed(
      Discovery.Service,
      Discovery.Service.of({ discover: () => Effect.succeed(ready("limited", 8080, "fixture-key", "unknown")) }),
    )
    const platform = Layer.mock(DesktopPlatform.Service)({
      info: { platform: "linux", arch: "x64", home: "/tmp", env: {} },
      open: () => Effect.void,
    })
    const auth = Layer.mock(Auth.Service)({
      get: () => Effect.succeed(undefined),
      set: () => Ref.update(writes, (count) => count + 1),
    })
    const cache = Layer.mock(ModelCache.Service)({ clear: () => Effect.void })
    const instances = Layer.mock(InstanceStore.Service)({ disposeAll: () => Effect.void })
    const layer = Desktop.layer.pipe(
      Layer.provide(discovery),
      Layer.provide(platform),
      Layer.provide(auth),
      Layer.provide(cache),
      Layer.provide(instances),
    )

    const refused = yield* Desktop.Service.use((service) => service.sync()).pipe(Effect.provide(layer), Effect.result)
    expect(refused._tag).toBe("Failure")
    expect(yield* Ref.get(writes)).toBe(0)

    const accepted = yield* Desktop.Service.use((service) => service.sync(true)).pipe(Effect.provide(layer))
    expect(accepted.serverID).toBe("limited")
    expect(yield* Ref.get(writes)).toBe(1)
  }),
)

// kilocode_change start - regression tests for status() cache + single-flight
// guards added to mitigate Issue #37 (runtimed-nightly.exe idle load).

function deps(discovery: Layer.Layer<Discovery.Service, never, never>) {
  const platform = Layer.succeed(
    DesktopPlatform.Service,
    DesktopPlatform.Service.of({
      info: { platform: "linux", arch: "x64", home: "/tmp", env: {} },
      dataDir: () => Effect.succeed("/tmp"),
      installation: () => Effect.succeed({ path: "/usr/bin/anaconda-desktop" }),
      open: () => Effect.void,
    }),
  )
  const auth = Layer.mock(Auth.Service)({
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
  })
  const cache = Layer.mock(ModelCache.Service)({ clear: () => Effect.void })
  const instances = Layer.mock(InstanceStore.Service)({ disposeAll: () => Effect.void })
  return Desktop.layer.pipe(
    Layer.provide(discovery),
    Layer.provide(platform),
    Layer.provide(auth),
    Layer.provide(cache),
    Layer.provide(instances),
  )
}

const { effect: itEffect } = testEffect(Layer.empty)

itEffect("status() returns the cached result within the TTL (Issue #37 regression)", () =>
  Effect.gen(function* () {
    const counter = { value: 0 }
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.sync(() => {
              counter.value += 1
              return ready("only", 9000, "only-k")
            }),
        }),
      ),
    )

    // Provide the layer once so the `AnacondaDesktop.Service` instance (and its
    // `cacheRef` closure) survives across both `status()` calls.
    const program = Effect.gen(function* () {
      const first = yield* Desktop.Service.use((service) => service.status())
      const second = yield* Desktop.Service.use((service) => service.status())
      return [first, second] as const
    }).pipe(Effect.provide(layer))

    const [first, second] = yield* program

    expect(first.type).toBe("ready")
    if (first.type !== "ready") throw new Error("expected ready status")
    expect(second.type).toBe("ready")
    if (second.type !== "ready") throw new Error("expected ready status")
    // Both calls returned the same cached result; only one discover() ran.
    expect(second.serverID).toBe(first.serverID)
    expect(counter.value).toBe(1)
  }),
)

itEffect("status() re-fetches after the TTL expires", () =>
  Effect.gen(function* () {
    const counter = { value: 0 }
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.sync(() => {
              counter.value += 1
              return ready(`srv-${counter.value}`, 9000 + counter.value, `k-${counter.value}`)
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      const before = yield* Desktop.Service.use((service) => service.status())
      // Advance the TestClock past the 5s TTL — the next call must re-discover.
      yield* TestClock.adjust(Duration.toMillis("6 seconds") + 100)
      const after = yield* Desktop.Service.use((service) => service.status())
      return { before, after } as const
    }).pipe(Effect.provide(layer))

    const { before, after } = yield* program
    if (before.type !== "ready") throw new Error("expected ready status")
    if (after.type !== "ready") throw new Error("expected ready status")
    // discover() ran exactly twice: once before the TTL, once after.
    expect(counter.value).toBe(2)
  }),
)

itEffect("status() coalesces concurrent callers via the single-flight permit", () =>
  Effect.gen(function* () {
    const counter = { value: 0 }
    // `started` is signalled as soon as the leader reaches the inner `discover`
    // body. We must NOT race with `Effect.yieldNow` / setTimeout here — see
    // AGENTS.md "Synchronizing With Concurrent Work" and the parallel-init
    // pattern in `test/project/instance.test.ts`.
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.gen(function* () {
              counter.value += 1
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return ready("only", 9999, "only-k")
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      const fa = yield* Desktop.Service.use((s) => s.status()).pipe(Effect.forkChild)
      const fb = yield* Desktop.Service.use((s) => s.status()).pipe(Effect.forkChild)
      const fc = yield* Desktop.Service.use((s) => s.status()).pipe(Effect.forkChild)

      // Wait until the leader is parked inside Deferred.await(release) before
      // we release; this guarantees the other two forks have queued on the
      // Semaphore and will be coalesced into the leader's result.
      yield* Deferred.await(started)
      yield* Deferred.succeed(release, undefined)

      const a = yield* Fiber.join(fa)
      const b = yield* Fiber.join(fb)
      const c = yield* Fiber.join(fc)
      return [a, b, c] as const
    }).pipe(Effect.provide(layer))

    const [a, b, c] = yield* program

    expect(a.type).toBe("ready")
    if (a.type !== "ready") throw new Error("expected ready status")
    expect(b.type).toBe("ready")
    if (b.type !== "ready") throw new Error("expected ready status")
    expect(c.type).toBe("ready")
    if (c.type !== "ready") throw new Error("expected ready status")
    // Exactly one discover() must have run despite three concurrent callers.
    expect(counter.value).toBe(1)
  }),
)

itEffect("sync() bypasses the status cache and invalidates it afterwards", () =>
  Effect.gen(function* () {
    const state = { next: ready("alpha", 9100, "alpha-k") }
    const counter = { value: 0 }
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.sync(() => {
              counter.value += 1
              return state.next
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      const before = yield* Desktop.Service.use((s) => s.status())
      const callsAfterStatus = counter.value
      // Even within the cache TTL, sync() must observe the freshest world.
      state.next = ready("beta", 9200, "beta-k")
      yield* Desktop.Service.use((s) => s.sync(true))
      const callsAfterSync = counter.value
      const status = yield* Desktop.Service.use((s) => s.status())
      return { before, status, callsAfterStatus, callsAfterSync } as const
    }).pipe(Effect.provide(layer))

    const { before, status, callsAfterStatus, callsAfterSync } = yield* program

    if (before.type !== "ready") throw new Error("expected ready status")
    if (status.type !== "ready") throw new Error("expected ready status")
    expect(before.serverID).toBe("alpha")
    expect(status.serverID).toBe("beta")
    // sync() always bypassed the cache (one extra discover() call) and the
    // status cache was invalidated, so the next status() re-discovered too.
    expect(callsAfterSync).toBe(callsAfterStatus + 1)
    expect(counter.value).toBe(callsAfterSync + 1)
  }),
)

itEffect("status() stamps the TTL once discovery has finished", () =>
  Effect.gen(function* () {
    const counter = { value: 0 }
    // A real discovery issues up to six sequential requests with a 4s timeout
    // each, so it can easily outlast the whole TTL. Stamping the entry before the
    // call would publish an already-expired result and let the next caller fan
    // out again immediately.
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.gen(function* () {
              counter.value += 1
              yield* TestClock.adjust("6 seconds")
              return ready(`srv-${counter.value}`, 9300 + counter.value, `k-${counter.value}`)
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      const first = yield* Desktop.Service.use((service) => service.status())
      const second = yield* Desktop.Service.use((service) => service.status())
      return { first, second } as const
    }).pipe(Effect.provide(layer))

    const { first, second } = yield* program

    if (first.type !== "ready") throw new Error("expected ready status")
    if (second.type !== "ready") throw new Error("expected ready status")
    expect(second.serverID).toBe(first.serverID)
    // Discovery consumed the TTL and more; the result is still valid for it.
    expect(counter.value).toBe(1)
  }),
)

itEffect("status(true) bypasses the cache and republishes it", () =>
  Effect.gen(function* () {
    const state = { next: ready("alpha", 9400, "alpha-k") }
    const counter = { value: 0 }
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.sync(() => {
              counter.value += 1
              return state.next
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      yield* Desktop.Service.use((s) => s.status())
      state.next = ready("beta", 9500, "beta-k")
      // Well inside the TTL, so only an explicit "check again" can see this.
      const fresh = yield* Desktop.Service.use((s) => s.status(true))
      const cached = yield* Desktop.Service.use((s) => s.status())
      return { fresh, cached } as const
    }).pipe(Effect.provide(layer))

    const { fresh, cached } = yield* program

    if (fresh.type !== "ready") throw new Error("expected ready status")
    if (cached.type !== "ready") throw new Error("expected ready status")
    expect(fresh.serverID).toBe("beta")
    expect(cached.serverID).toBe("beta")
    // One throttled call, one forced call; the forced result is cached again.
    expect(counter.value).toBe(2)
  }),
)

itEffect("open() invalidates the status cache", () =>
  Effect.gen(function* () {
    const counter = { value: 0 }
    const layer = deps(
      Layer.succeed(
        Discovery.Service,
        Discovery.Service.of({
          discover: () =>
            Effect.sync(() => {
              counter.value += 1
              return ready(`srv-${counter.value}`, 9600 + counter.value, `k-${counter.value}`)
            }),
        }),
      ),
    )

    const program = Effect.gen(function* () {
      const before = yield* Desktop.Service.use((s) => s.status())
      yield* Desktop.Service.use((s) => s.open())
      const after = yield* Desktop.Service.use((s) => s.status())
      return { before, after } as const
    }).pipe(Effect.provide(layer))

    const { before, after } = yield* program

    if (before.type !== "ready") throw new Error("expected ready status")
    if (after.type !== "ready") throw new Error("expected ready status")
    expect(after.serverID).toBe(`srv-${counter.value}`)
    // The open() invalidated a still-valid entry, so the next check re-discovered.
    expect(counter.value).toBe(2)
  }),
)
// kilocode_change end
