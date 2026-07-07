// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { AllowEverythingPermission } from "../../../src/kilocode/permission/allow-everything"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { provideTestInstance } from "../../fixture/fixture"
import { Server } from "../../../src/server/server"
import { Session } from "../../../src/session/session"
import { provideTmpdirInstance, tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const bus = Bus.layer
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus), Layer.provide(Config.defaultLayer)),
  Config.defaultLayer,
  Session.defaultLayer,
  bus,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)
const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}

afterEach(() => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
})

const auth = () => `Basic ${Buffer.from("kilo:secret").toString("base64")}`

const requireAuth = () => {
  Flag.KILO_SERVER_PASSWORD = "secret"
  Flag.KILO_SERVER_USERNAME = undefined
  process.env.KILO_SERVER_PASSWORD = "secret"
  delete process.env.KILO_SERVER_USERNAME
}

const ask = (input: Permission.AskInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Permission.ReplyInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const wait = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      if ((yield* permission.list()).length > 0) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error("timed out waiting for pending permission request"))
  })

describe("AllowEverythingPermission", () => {
  test("handles disable requests through the HTTP endpoint", async () => {
    requireAuth()
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const blocked = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ enable: true }),
        })
        expect(blocked.status).toBe(401)

        const enable = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: true }),
        })
        expect(enable.status).toBe(200)

        const disable = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: false }),
        })
        expect(disable.status).toBe(200)
        expect(await disable.json()).toBe(true)
      },
    })
  })

  it.live("disables global allow-all and restores permission prompts", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          expect(yield* AllowEverythingPermission.effect({ enable: true })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false })).toBe(true)

          const session = yield* sessions.create({})
          const pending = yield* ask({
            id: PermissionID.make("permission_global_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionID.make("permission_global_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )

  it.live("disables session-scoped allow-all without affecting other sessions", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          expect(yield* AllowEverythingPermission.effect({ enable: true, sessionID: session.id })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false, sessionID: session.id })).toBe(true)

          const next = yield* sessions.get(session.id)
          expect(next.permission ?? []).toEqual([])

          const pending = yield* ask({
            id: PermissionID.make("permission_session_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionID.make("permission_session_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }

          const other = yield* sessions.create({})
          const blocked = yield* ask({
            id: PermissionID.make("permission_other_session"),
            sessionID: other.id,
            permission: "bash",
            patterns: ["pwd"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionID.make("permission_other_session"),
            reply: "reject",
          })

          const blockedExit = yield* Fiber.await(blocked)
          expect(Exit.isFailure(blockedExit)).toBe(true)
          if (Exit.isFailure(blockedExit)) {
            expect(Cause.squash(blockedExit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )
})
