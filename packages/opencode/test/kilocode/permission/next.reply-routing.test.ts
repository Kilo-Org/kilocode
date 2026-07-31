import { expect, describe, afterAll } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Bus } from "../../../src/bus"
import { Permission } from "../../../src/permission"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database"
import { SessionID } from "../../../src/session/schema"
import * as Config from "../../../src/config/config"
import { InstanceRuntime } from "../../../src/project/instance-runtime"
import { Global } from "@opencode-ai/core/global"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const bus = Bus.layer
const env = Layer.mergeAll(
  Permission.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Database.defaultLayer),
  ),
  bus,
  CrossSpawnSpawner.defaultLayer,
  testInstanceStoreLayer,
)
const it = testEffect(env)

afterAll(async () => {
  const dir = Global.Path.config
  for (const file of ["kilo.jsonc", "kilo.json", "config.json", "opencode.json", "opencode.jsonc"]) {
    await fs.rm(path.join(dir, file), { force: true }).catch(() => {})
  }
  await Effect.runPromise(
    Config.Service.use((svc) => svc.invalidate()).pipe(Effect.scoped, Effect.provide(Config.defaultLayer)),
  )
  await InstanceRuntime.disposeAllInstances()
})

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      const items = yield* permission.list()
      if (items.length >= count) return items
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

const withProvided =
  (dir: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(provideInstance(dir))

const expectNotFound = (exit: Exit.Exit<void, Permission.NotFoundError>, requestID: PermissionV1.ID) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: "Permission.NotFoundError",
      requestID,
    })
  }
}

describe("reply routing", () => {
  it.live("fails when requestID is not pending", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const requestID = PermissionV1.ID.make("permission_unknown")
          const exit = yield* reply({ requestID, reply: "once" }).pipe(Effect.exit)
          expectNotFound(exit, requestID)
        }),
      { git: true },
    ),
  )

  it.live("succeeds when a pending request is replied to", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const asking = yield* ask({
            id: PermissionV1.ID.make("permission_accepted"),
            sessionID: SessionID.make("session_accept"),
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* waitForPending(1)
          yield* reply({
            requestID: PermissionV1.ID.make("permission_accepted"),
            reply: "once",
          })
          yield* Fiber.join(asking)
        }),
      { git: true },
    ),
  )

  it.live("fails for a reject reply to an unknown id", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const requestID = PermissionV1.ID.make("permission_unknown_reject")
          const exit = yield* reply({ requestID, reply: "reject" }).pipe(Effect.exit)
          expectNotFound(exit, requestID)
        }),
      { git: true },
    ),
  )

  it.live("fails on the second of two replies to the same id", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const asking = yield* ask({
            id: PermissionV1.ID.make("permission_double"),
            sessionID: SessionID.make("session_double"),
            permission: "bash",
            patterns: ["echo hi"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* waitForPending(1)
          const requestID = PermissionV1.ID.make("permission_double")
          yield* reply({ requestID, reply: "once" })
          yield* Fiber.join(asking)

          const exit = yield* reply({ requestID, reply: "once" }).pipe(Effect.exit)
          expectNotFound(exit, requestID)
        }),
      { git: true },
    ),
  )

  it.live("a reply to directory B does not resolve a pending permission in directory A", () =>
    Effect.gen(function* () {
      const dirA = yield* tmpdirScoped({ git: true })
      const dirB = yield* tmpdirScoped({ git: true })
      const runA = withProvided(dirA)
      const runB = withProvided(dirB)

      const fiber = yield* ask({
        id: PermissionV1.ID.make("permission_crossdir"),
        sessionID: SessionID.make("session_crossdir"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(runA, Effect.forkScoped)

      expect(yield* waitForPending(1).pipe(runA)).toHaveLength(1)

      const requestID = PermissionV1.ID.make("permission_crossdir")
      const exit = yield* reply({ requestID, reply: "once" }).pipe(runB, Effect.exit)
      expectNotFound(exit, requestID)

      expect(yield* list().pipe(runA)).toHaveLength(1)
      expect(yield* list().pipe(runB)).toHaveLength(0)

      yield* reply({ requestID, reply: "once" }).pipe(runA)
      yield* Fiber.join(fiber)
    }),
  )
})
