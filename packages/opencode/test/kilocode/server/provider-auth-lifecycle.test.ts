import { NodeServices } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { KiloModelsResult } from "@kilocode/kilo-gateway"
import * as Core from "@opencode-ai/core/models-dev"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Auth } from "../../../src/auth"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { Config } from "../../../src/config/config"
import { InstanceRef } from "../../../src/effect/instance-ref"
import {
  disposeAllInstancesAfterProviderAuthCallback,
  invalidateAfterProviderAuthChange,
} from "../../../src/kilocode/server/provider-auth-lifecycle"
import { Plugin } from "../../../src/plugin"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { ModelsDev } from "../../../src/provider/models"
import { Provider } from "../../../src/provider/provider"
import { Event } from "../../../src/server/event"
import { TestConfig } from "../../fixture/config"
import { testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)
const live = testEffect(Layer.mergeAll(testInstanceStoreLayer, NodeServices.layer))

const catalog: KiloModelsResult = {
  models: {
    "kilo/auto": {
      id: "kilo/auto",
      name: "Auto",
      release_date: "",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 128000, output: 4096 },
    },
  },
}

function capture() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const list: GlobalEvent[] = []
      const on = (event: GlobalEvent) => {
        list.push(event)
      }
      GlobalBus.on("event", on)
      return { list, on }
    }),
    (state) =>
      Effect.sync(() => {
        GlobalBus.off("event", state.on)
      }),
  ).pipe(Effect.map((state) => state.list))
}

function clean() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const prev = {
        KILO_API_KEY: process.env.KILO_API_KEY,
        KILO_ORG_ID: process.env.KILO_ORG_ID,
      }
      delete process.env.KILO_API_KEY
      delete process.env.KILO_ORG_ID
      return prev
    }),
    (prev) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(prev)) {
          if (value == null) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

function layer(events: string[], fail = false) {
  return Layer.mergeAll(
    Layer.mock(ModelCache.Service)({
      clear: (providerID) =>
        Effect.sync(() => {
          events.push(`clear:${providerID}`)
        }),
    }),
    Layer.mock(InstanceStore.Service)({
      disposeAll: () =>
        fail
          ? Effect.sync(() => {
              events.push("dispose:fail")
            }).pipe(Effect.andThen(Effect.die(new Error("disposer failed"))))
          : Effect.sync(() => {
              events.push("dispose")
            }),
    }),
  )
}

it.effect("clears provider models, invalidates provider caches, disposes instances, and emits global.disposed", () =>
  Effect.gen(function* () {
    const events: string[] = []
    const bus = yield* capture()
    const on = (event: GlobalEvent) => {
      if (event.directory === "global" && event.payload.type === Event.Disposed.type) {
        events.push("global.disposed")
      }
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => GlobalBus.on("event", on)),
      () => Effect.sync(() => GlobalBus.off("event", on)),
    )
    yield* ModelsRefresh.watch(() =>
      Effect.sync(() => {
        events.push("refresh")
      }),
    )

    yield* invalidateAfterProviderAuthChange("kilo").pipe(Effect.provide(layer(events)))

    expect(events).toEqual(["clear:kilo", "refresh", "dispose", "global.disposed"])
    expect(bus).toContainEqual({
      directory: "global",
      payload: expect.objectContaining({ type: Event.Disposed.type, properties: {} }),
    })
  }),
)

it.effect("swallows disposal failures and still emits global.disposed after provider auth callback", () =>
  Effect.gen(function* () {
    const events: string[] = []
    const bus = yield* capture()
    yield* ModelsRefresh.watch(() =>
      Effect.sync(() => {
        events.push("refresh")
      }),
    )

    yield* disposeAllInstancesAfterProviderAuthCallback().pipe(Effect.provide(layer(events, true)))

    expect(events).toEqual(["refresh", "dispose:fail"])
    expect(bus).toContainEqual({
      directory: "global",
      payload: expect.objectContaining({ type: Event.Disposed.type, properties: {} }),
    })
  }),
)

live.live("invalidates orphaned worktree Provider.Service ScopedCache populated between logout and re-login", () =>
  Effect.gen(function* () {
    yield* clean()
    const dir = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    const kilo = ProviderV2.ID.kilo
    const records = yield* Ref.make<Record<string, Auth.Info>>({
      kilo: new Auth.Oauth({
        type: "oauth",
        access: "token-before",
        refresh: "refresh-before",
        expires: Date.now() + 3_600_000,
      }),
    })
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
    const cfg = TestConfig.layer()
    const cache = Layer.fresh(ModelCache.layer).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(cfg),
      Layer.provide(auth),
      Layer.provide(
        Layer.succeed(ModelCache.KiloModelsService, {
          fetch: () => Effect.succeed(catalog),
        }),
      ),
    )
    const models = ModelsDev.layer.pipe(
      Layer.provide(cache),
      Layer.provide(cfg),
      Layer.provide(auth),
      Layer.provide(Layer.mock(Core.Service)({ get: () => Effect.succeed({}), refresh: () => Effect.void })),
    )
    const graph = Layer.mergeAll(
      cache,
      LayerNode.compile(Provider.node, [
        [ModelsDev.node, models],
        [Config.node, cfg],
        [Auth.node, auth],
        [Plugin.node, Layer.mock(Plugin.Service)({ list: () => Effect.succeed([]) })],
      ]),
    )

    yield* Effect.gen(function* () {
      const provider = yield* Provider.Service

      // Simulate an in-flight worktree request obtaining InstanceRef before logout disposal.
      const ctx = yield* store.load({ directory: dir })
      const before = yield* provider.list().pipe(Effect.provideService(InstanceRef, ctx))
      expect(before[kilo]?.options.kilocodeToken).toBe("token-before")
      expect(before[kilo]?.options.apiKey).not.toBe("anonymous")

      // Logout removes the token and evicts the worktree from InstanceStore.cache.
      yield* Ref.set(records, {})
      yield* invalidateAfterProviderAuthChange("kilo")
      expect((yield* store.list()).map((item) => item.directory)).not.toContain(dir)

      // The in-flight request continues using its already-captured InstanceRef, repopulating
      // Provider.Service's ScopedCache with logged-out ("anonymous") state while absent from InstanceStore.
      const during = yield* provider.list().pipe(Effect.provideService(InstanceRef, ctx))
      expect(during[kilo]?.options.apiKey).toBe("anonymous")
      expect((yield* store.list()).map((item) => item.directory)).not.toContain(dir)

      // Re-login updates credentials and runs auth disposal while the worktree is absent from InstanceStore.cache.
      yield* Ref.set(records, {
        kilo: new Auth.Oauth({
          type: "oauth",
          access: "token-after",
          refresh: "refresh-after",
          expires: Date.now() + 3_600_000,
        }),
      })
      yield* invalidateAfterProviderAuthChange("kilo")

      // Next worktree lookup must observe the new credentials instead of the orphaned "anonymous" cache entry.
      const after = yield* store.provide({ directory: dir }, provider.list())
      expect(after[kilo]?.options.apiKey).not.toBe("anonymous")
      expect(after[kilo]?.options.kilocodeToken).toBe("token-after")
    }).pipe(Effect.provide(graph))
  }),
)
