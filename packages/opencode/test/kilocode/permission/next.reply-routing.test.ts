import { expect, describe, afterAll } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Fiber, Layer } from "effect"
import { Bus } from "../../../src/bus"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { SessionID } from "../../../src/session/schema"
import * as Config from "../../../src/config/config"
import { Global } from "../../../src/global"
import * as CrossSpawnSpawner from "../../../src/effect/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const bus = Bus.layer
const env = Layer.mergeAll(Permission.layer.pipe(Layer.provide(bus)), bus, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

afterAll(async () => {
  const dir = Global.Path.config
  for (const file of ["kilo.jsonc", "kilo.json", "config.json", "opencode.json", "opencode.jsonc"]) {
    await fs.rm(path.join(dir, file), { force: true }).catch(() => {})
  }
  await Config.invalidate(true)
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

describe("reply routing", () => {
  it.live("returns false when requestID is not pending", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const accepted = yield* reply({
            requestID: PermissionID.make("permission_unknown"),
            reply: "once",
          })
          expect(accepted).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("returns true when a pending request is replied to", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const asking = yield* ask({
            id: PermissionID.make("permission_accepted"),
            sessionID: SessionID.make("session_accept"),
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* waitForPending(1)
          const accepted = yield* reply({
            requestID: PermissionID.make("permission_accepted"),
            reply: "once",
          })
          expect(accepted).toBe(true)
          yield* Fiber.join(asking)
        }),
      { git: true },
    ),
  )

  it.live("returns false for a reject reply to an unknown id", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const accepted = yield* reply({
            requestID: PermissionID.make("permission_unknown_reject"),
            reply: "reject",
          })
          expect(accepted).toBe(false)
        }),
      { git: true },
    ),
  )

  it.live("returns false on the second of two replies to the same id", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const asking = yield* ask({
            id: PermissionID.make("permission_double"),
            sessionID: SessionID.make("session_double"),
            permission: "bash",
            patterns: ["echo hi"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* waitForPending(1)
          const first = yield* reply({
            requestID: PermissionID.make("permission_double"),
            reply: "once",
          })
          expect(first).toBe(true)
          yield* Fiber.join(asking)

          const second = yield* reply({
            requestID: PermissionID.make("permission_double"),
            reply: "once",
          })
          expect(second).toBe(false)
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
        id: PermissionID.make("permission_crossdir"),
        sessionID: SessionID.make("session_crossdir"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(runA, Effect.forkScoped)

      expect(yield* waitForPending(1).pipe(runA)).toHaveLength(1)

      const accepted = yield* reply({
        requestID: PermissionID.make("permission_crossdir"),
        reply: "once",
      }).pipe(runB)
      expect(accepted).toBe(false)

      expect(yield* list().pipe(runA)).toHaveLength(1)
      expect(yield* list().pipe(runB)).toHaveLength(0)

      const okAccepted = yield* reply({
        requestID: PermissionID.make("permission_crossdir"),
        reply: "once",
      }).pipe(runA)
      expect(okAccepted).toBe(true)
      yield* Fiber.join(fiber)
    }),
  )
})
