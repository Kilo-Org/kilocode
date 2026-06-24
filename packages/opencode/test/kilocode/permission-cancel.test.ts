import { afterEach, expect } from "bun:test"
import { Effect, Layer, Queue } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EffectBridge } from "../../src/effect/bridge"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const bus = Bus.layer
const bootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus)),
  bus,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(bootstrap)),
).pipe(Layer.provide(RuntimeFlags.layer()), Layer.provide(Config.defaultLayer))
const it = testEffect(Layer.mergeAll(env, RuntimeFlags.layer()))

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "publishes rejection when a bridged permission wait is aborted",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const events = yield* Bus.Service
      const bridge = yield* EffectBridge.make()
      const asked = yield* Queue.unbounded<{ properties: Permission.Request }>()
      const replied = yield* Queue.unbounded<{
        properties: { sessionID: SessionID; requestID: PermissionID; reply: Permission.Reply }
      }>()
      const offAsked = yield* events.subscribeCallback(Permission.Event.Asked, (event) =>
        Queue.offerUnsafe(asked, event),
      )
      const offReplied = yield* events.subscribeCallback(Permission.Event.Replied, (event) =>
        Queue.offerUnsafe(replied, event),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => [offAsked(), offReplied()]))

      const ctl = new AbortController()
      const wait = bridge
        .promise(
          permission.ask({
            id: PermissionID.make("per_abort"),
            sessionID: SessionID.make("ses_abort"),
            permission: "edit",
            patterns: ["config.json"],
            metadata: {},
            always: [],
            ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
          }),
          { signal: ctl.signal },
        )
        .then(
          () => "success" as const,
          () => "aborted" as const,
        )

      const request = yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
      ctl.abort()

      expect(yield* Effect.promise(() => wait)).toBe("aborted")
      const event = yield* Queue.take(replied).pipe(Effect.timeout("2 seconds"))
      expect(event.properties).toEqual({
        sessionID: request.properties.sessionID,
        requestID: request.properties.id,
        reply: "reject",
      })
      expect(yield* permission.list()).toEqual([])
    }),
  { git: true },
)
