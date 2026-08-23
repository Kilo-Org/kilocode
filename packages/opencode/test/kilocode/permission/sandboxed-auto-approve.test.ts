import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { testEffect } from "../../lib/effect"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"

// A sandboxed shell command is already confined to the writable paths, so its
// bash/external-directory ask auto-approves like an allow rule — no prompt.
// Deny rules and plan-mode hard vetoes must still terminate the command.

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

const list = () =>
  Effect.gen(function* () {
    return yield* (yield* Permission.Service).list()
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

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

it.instance(
  "sandboxed - an ask outcome auto-approves without queuing a prompt",
  () =>
    Effect.gen(function* () {
      const outcome = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["npm run build"],
        metadata: { sandboxed: true },
        always: [],
        ruleset: [],
      })
      expect(outcome.manual).toBe(false)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "sandboxed - a deny rule still terminates the command",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf node_modules"],
          metadata: { sandboxed: true },
          always: [],
          ruleset: [{ permission: "bash", pattern: "rm -rf *", action: "deny" }],
        }),
      )

      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "sandboxed - a plan-mode hard veto still terminates the command",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf node_modules"],
          metadata: { sandboxed: true },
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
          hardRuleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      )

      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "sandboxed - an explicit allow rule is honored and still reports the rule",
  () =>
    Effect.gen(function* () {
      const outcome = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["git status"],
        metadata: { sandboxed: true },
        always: [],
        ruleset: [{ permission: "bash", pattern: "git *", action: "allow" }],
      })
      expect(outcome.manual).toBe(false)
      expect(outcome.rule?.action).toBe("allow")
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "without the sandboxed flag an ask outcome still prompts",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["npm run build"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const [pending] = yield* waitForPending(1)
      yield* (yield* Permission.Service).reply({ requestID: pending.id, reply: "once" })
      expect((yield* Fiber.join(fiber)).manual).toBe(true)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)
