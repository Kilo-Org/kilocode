import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { testEffect } from "../../lib/effect"

// A sensitive browser step (`metadata.browserSensitive`) behaves like a skill-shell batch: a
// config rule or an auto-approver cannot answer it, and only a human reply releases it.
// With browser.allowSensitive the flag is absent and an allow rule answers it as usual.

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    return yield* (yield* Permission.Service).ask(input)
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* Effect.gen(function* () {
      while (true) {
        const pending = yield* permission.list()
        if (pending.length === count) return pending
        yield* Effect.sleep("10 millis")
      }
    }).pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.fail(new Error("timed out")) }))
  })

const request = (metadata: Record<string, unknown>, ruleset: Permission.Ruleset) => ({
  sessionID: SessionID.make("session_browser"),
  permission: "browser_sensitive",
  patterns: ["https://example.com"],
  metadata,
  always: [],
  ruleset,
})

it.instance(
  "browserSensitive - prompts even when an allow rule matches",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask(
        request({ browserSensitive: true, reason: "password field" }, [
          { permission: "browser_sensitive", pattern: "*", action: "allow" },
        ]),
      ).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      const permission = yield* Permission.Service
      yield* permission.reply({ requestID: (yield* permission.list())[0].id, reply: "once", interactive: true })
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "browserSensitive - refuses a machine approval and keeps the request pending",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask(
        request({ browserSensitive: true, reason: "password field" }, [
          { permission: "browser_sensitive", pattern: "*", action: "allow" },
        ]),
      ).pipe(Effect.forkScoped)

      const [pending] = yield* waitForPending(1)
      const permission = yield* Permission.Service
      // An auto-approver (no `interactive`) must not release a sensitive step.
      yield* permission.reply({ requestID: pending.id, reply: "always" })
      expect(yield* permission.list()).toHaveLength(1)

      yield* permission.reply({ requestID: pending.id, reply: "once", interactive: true })
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "browserSensitive - a denial is always allowed through, even from a machine",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask(request({ browserSensitive: true }, [])).pipe(Effect.forkScoped)
      const [pending] = yield* waitForPending(1)
      const permission = yield* Permission.Service
      yield* permission.reply({ requestID: pending.id, reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
      }
    }),
  { git: true },
)

it.instance(
  "browser allowSensitive - an ordinary ask, answered by a config rule",
  () =>
    Effect.gen(function* () {
      const outcome = yield* ask(
        request({ browserSensitive: false, reason: "password field" }, [
          { permission: "browser_sensitive", pattern: "*", action: "allow" },
        ]),
      )
      expect(outcome.manual).toBe(false)
    }),
  { git: true },
)
