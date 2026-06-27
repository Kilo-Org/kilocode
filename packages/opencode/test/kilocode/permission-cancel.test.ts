import { afterEach, expect } from "bun:test"
import { Effect, Exit, Layer, Queue } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { EffectBridge } from "../../src/effect/bridge"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { KiloPermission } from "../../src/kilocode/permission/lifecycle"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { ProjectID } from "../../src/project/schema"
import { Session } from "../../src/session/session"
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

it.effect("does not miss an abort while installing its listener", () =>
  Effect.gen(function* () {
    const ctl = new AbortController()
    const exit = yield* Effect.raceFirst(
      Effect.sync(() => ctl.abort()).pipe(Effect.andThen(Effect.never)),
      KiloPermission.abort(ctl.signal),
    ).pipe(Effect.timeout("2 seconds"), Effect.exit)

    expect(Exit.hasInterrupts(exit)).toBe(true)
  }),
)

it.instance(
  "publishes rejection when a tool aborts its pending permission",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const events = yield* Bus.Service
      const bridge = yield* EffectBridge.make()
      const agent: Agent.Info = {
        name: "build",
        mode: "primary",
        permission: [{ permission: "edit", pattern: "*", action: "ask" }],
        options: {},
      }
      const session: Session.Info = {
        id: SessionID.make("ses_abort"),
        slug: "permission-abort",
        projectID: ProjectID.make("permission-abort"),
        directory: "/workspace",
        title: "Permission abort",
        version: "test",
        permission: [],
        time: { created: 0, updated: 0 },
      }
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
          KiloSessionPrompt.askPermission({
            permission,
            agents: { get: () => Effect.succeed(agent) },
            sessions: { get: () => Effect.succeed(session) },
            agent,
            session,
            request: {
              id: PermissionID.make("per_abort"),
              sessionID: session.id,
              permission: "edit",
              patterns: ["config.json"],
              metadata: {},
              always: [],
            },
            abort: ctl.signal,
          }),
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
