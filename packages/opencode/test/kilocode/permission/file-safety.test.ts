import { expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer, Ref } from "effect"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Permission } from "../../../src/permission"
import { SessionID } from "../../../src/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { TestConfig } from "../../fixture/config"
import { provideTmpdirInstance } from "../../fixture/fixture"

function env(get: Config.Interface["get"]) {
  return Layer.mergeAll(
    Permission.layer.pipe(
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(TestConfig.layer({ get })),
      Layer.provide(Database.defaultLayer),
    ),
    Bus.layer,
    CrossSpawnSpawner.defaultLayer,
  )
}

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

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const wait = (count: number) =>
  Effect.gen(function* () {
    for (const _ of Array.from({ length: 100 })) {
      const requests = yield* list()
      if (requests.length >= count) return requests
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

test("unguarded config edits can persist ordinary approvals", async () => {
  const get = () => Effect.succeed({ dangerously_disable_file_safety_guards: true })
  await Effect.runPromise(
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const ruleset = Permission.fromConfig({ edit: "ask" })
        const first = PermissionV1.ID.make("permission_file_safety_first")
        const pending = yield* ask({
          id: first,
          sessionID: SessionID.make("session_file_safety"),
          permission: "edit",
          patterns: ["AGENTS.md"],
          metadata: {},
          always: ["AGENTS.md"],
          ruleset,
        }).pipe(Effect.forkScoped)

        const requests = yield* wait(1)
        expect(requests[0].metadata).not.toMatchObject({ disableAlways: true, configProtected: true })
        yield* reply({ requestID: first, reply: "always" })
        yield* Fiber.join(pending)

        const outcome = yield* ask({
          id: PermissionV1.ID.make("permission_file_safety_second"),
          sessionID: SessionID.make("session_file_safety"),
          permission: "edit",
          patterns: ["AGENTS.md"],
          metadata: {},
          always: ["AGENTS.md"],
          ruleset,
        })
        expect(outcome.manual).toBe(false)
        expect(yield* list()).toHaveLength(0)
      }),
    ).pipe(Effect.scoped, Effect.provide(env(get))),
  )
})

test("unguarded config edits are covered by allow everything", async () => {
  const get = () => Effect.succeed({ dangerously_disable_file_safety_guards: true })
  await Effect.runPromise(
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const id = PermissionV1.ID.make("permission_file_safety_everything")
        const pending = yield* ask({
          id,
          sessionID: SessionID.make("session_file_safety_everything"),
          permission: "edit",
          patterns: ["AGENTS.md"],
          metadata: {},
          always: ["AGENTS.md"],
          ruleset: Permission.fromConfig({ edit: "ask" }),
        }).pipe(Effect.forkScoped)

        yield* wait(1)
        yield* allow({ enable: true, requestID: id })
        yield* Fiber.join(pending)
        expect(yield* list()).toHaveLength(0)
      }),
    ).pipe(Effect.scoped, Effect.provide(env(get))),
  )
})

test("pending config edits keep their file guard policy", async () => {
  const config = await Effect.runPromise(Ref.make({}))
  await Effect.runPromise(
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const id = PermissionV1.ID.make("permission_file_safety_stable")
        const pending = yield* ask({
          id,
          sessionID: SessionID.make("session_file_safety_stable"),
          permission: "edit",
          patterns: ["AGENTS.md"],
          metadata: {},
          always: ["AGENTS.md"],
          ruleset: Permission.fromConfig({ edit: "ask" }),
        }).pipe(Effect.forkScoped)

        yield* wait(1)
        yield* Ref.set(config, { dangerously_disable_file_safety_guards: true })
        yield* allow({ enable: true, requestID: id })
        expect((yield* list()).map((item) => item.id)).toContain(id)
        yield* reply({ requestID: id, reply: "reject" })
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
      }),
    ).pipe(Effect.scoped, Effect.provide(env(() => Ref.get(config)))),
  )
})
