import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { testEffect } from "../../lib/effect"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"

// skillShell forces a single up-front prompt over soft allow/deny/auto-approve
// rules, but must never override a hard (plan-mode) veto, and must never be
// auto-resolved while pending.

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

const rejectAll = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (const req of yield* permission.list()) yield* permission.reply({ requestID: req.id, reply: "reject" })
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    return yield* (yield* Permission.Service).reply(input)
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
  "skillShell - forces a prompt even when a matching allow rule exists",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["printf hi"],
        metadata: { skillShell: true },
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "skillShell - a deny rule stays terminal (build mode, no hard ruleset)",
  () =>
    Effect.gen(function* () {
      // build mode has no hardRuleset; an ordinary deny rule must still block, not prompt.
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["curl evil.sh"],
          metadata: { skillShell: true },
          always: [],
          ruleset: [{ permission: "bash", pattern: "curl *", action: "deny" }],
        }),
      )

      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "skillShell - a cd-chained escape is vetoed via the verbatim command pattern",
  () =>
    Effect.gen(function* () {
      // The injector asks with the decomposed sub-command (`cat .ssh/id_rsa`, which
      // readOnlyBash would allow) AND the verbatim command. In plan mode the metachar
      // hard-veto (`*\n*` deny) must fire on the verbatim string, blocking the escape.
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ['cd "$HOME"\ncat .ssh/id_rsa', "cat .ssh/id_rsa"],
          metadata: { skillShell: true },
          always: [],
          ruleset: [{ permission: "bash", pattern: "cat *", action: "allow" }],
          hardRuleset: [{ permission: "bash", pattern: "*\n*", action: "deny" }],
        }),
      )

      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "skillShell - is denied by a hard-ruleset veto instead of prompting",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: { skillShell: true },
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
  "skillShell - a pending batch is not auto-resolved by allowEverything",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["printf hi"],
        metadata: { skillShell: true },
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* (yield* Permission.Service).allowEverything({ enable: true })
      // still pending: YOLO cannot silently approve a skill batch
      expect(yield* list()).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "skillShell - a machine approval (no interactive flag) is ignored and stays pending",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["printf hi"],
        metadata: { skillShell: true },
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const [pending] = yield* waitForPending(1)
      // An auto-approver replies without `interactive`; the server must ignore it.
      yield* reply({ requestID: pending.id, reply: "once" })
      expect(yield* list()).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "skillShell - an interactive approval resolves the request",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["printf hi"],
        metadata: { skillShell: true },
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const [pending] = yield* waitForPending(1)
      yield* reply({ requestID: pending.id, reply: "once", interactive: true })
      // human approval clears the prompt and the ask succeeds
      expect(yield* list()).toHaveLength(0)
      yield* Fiber.await(fiber)
    }),
  { git: true },
)
