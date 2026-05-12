import { afterAll, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Fiber, Layer } from "effect"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "../../../src/permission"
import { PermissionID } from "../../../src/permission/schema"
import { SessionID } from "../../../src/session/schema"
import { provideTmpdirInstance } from "../../fixture/fixture"
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

const allow = (input: Parameters<Permission.Interface["allowEverything"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.allowEverything(input)
  })

const rejectAll = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (const req of yield* permission.list()) {
      yield* permission.reply({ requestID: req.id, reply: "reject" })
    }
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

const rules = () =>
  Permission.fromConfig({
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
  })

function withDir(self: () => Effect.Effect<any, any, any>) {
  return provideTmpdirInstance(self, { git: true })
}

describe("env read permissions", () => {
  it.live("broad read allow does not bypass env ask", () =>
    Effect.sync(() => {
      const set = Permission.merge(rules(), Permission.fromConfig({ read: { "*": "allow" } }))
      expect(Permission.resolve("read", "project/.env", set).action).toBe("ask")
      expect(Permission.resolve("read", "project/.env.local", set).action).toBe("ask")
      expect(Permission.resolve("read", "project/.env.example", set).action).toBe("allow")
    }),
  )

  it.live("saved wildcard read approval does not bypass env ask", () =>
    withDir(() =>
      Effect.gen(function* () {
        const session = SessionID.make("session_env")
        const first = yield* ask({
          id: PermissionID.make("per_env_first"),
          sessionID: session,
          permission: "read",
          patterns: ["README.md"],
          metadata: {},
          always: ["*"],
          ruleset: Permission.fromConfig({ read: "ask" }),
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* reply({ requestID: PermissionID.make("per_env_first"), reply: "always" })
        yield* Fiber.join(first)

        const second = yield* ask({
          id: PermissionID.make("per_env_second"),
          sessionID: session,
          permission: "read",
          patterns: ["project/.env"],
          metadata: {},
          always: ["*"],
          ruleset: rules(),
        }).pipe(Effect.forkScoped)

        const items = yield* waitForPending(1)
        expect(items[0].id).toBe(PermissionID.make("per_env_second"))

        yield* rejectAll()
        yield* Fiber.await(second)
      }),
    ),
  )

  it.live("allow everything does not resolve pending env reads", () =>
    withDir(() =>
      Effect.gen(function* () {
        const asking = yield* ask({
          id: PermissionID.make("per_env_everything"),
          sessionID: SessionID.make("session_env"),
          permission: "read",
          patterns: ["project/.env"],
          metadata: {},
          always: ["*"],
          ruleset: rules(),
        }).pipe(Effect.forkScoped)

        yield* waitForPending(1)
        yield* allow({ enable: true, requestID: "per_env_everything" })

        const items = yield* waitForPending(1)
        expect(items[0].id).toBe(PermissionID.make("per_env_everything"))

        yield* rejectAll()
        yield* Fiber.await(asking)
      }),
    ),
  )
})
