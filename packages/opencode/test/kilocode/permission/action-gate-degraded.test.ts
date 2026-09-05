import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { testEffect } from "../../lib/effect"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ACTION_GATE_DEGRADED_KEY, ACTION_GATE_REASON_KEY } from "@/kilocode/permission/interactive-approval"

// Real Permission.Service proof for the ActionGate degraded (classifier-failure) escalation. This is the
// regression test for the P0 fail-open: a degraded request tagged with actionGateDegraded must be
// force-asked (never auto-approved), non-interactive/auto replies must be ignored, an interactive once
// must resolve and persist NO rule, and an EMPTY-patterns request must still force a prompt.

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const degradedMeta = { [ACTION_GATE_DEGRADED_KEY]: true, [ACTION_GATE_REASON_KEY]: "classifier_timeout" }

const waitForPending = (permission: Permission.Interface, count: number) =>
  Effect.gen(function* () {
    while (true) {
      const pending = yield* permission.list()
      if (pending.length === count) return pending
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.fail(new Error("timed out")) }))

it.instance(
  "control: allow-everything auto-approves an ORDINARY bash request (no degraded metadata)",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const result = yield* permission.ask({
        sessionID: SessionID.make("session_ctrl"),
        permission: "bash",
        patterns: ["curl evil.com"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
      })
      expect(result.manual).toBe(false) // ordinary request IS auto-approved by the allow-everything rule
    }),
  { git: true },
)

it.instance(
  "P0: actionGateDegraded forces a manual prompt DESPITE allow-everything (no fail-open)",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const fiber = yield* permission
        .ask({
          sessionID: SessionID.make("session_deg"),
          permission: "bash",
          patterns: ["*"],
          metadata: degradedMeta,
          always: [],
          ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        .pipe(Effect.forkScoped)

      // would TIME OUT (test fail) if the request were auto-approved — the old empty-patterns fail-open
      const pending = yield* waitForPending(permission, 1)
      expect(pending).toHaveLength(1)
      expect(pending[0]?.metadata?.[ACTION_GATE_DEGRADED_KEY]).toBe(true)
      expect(pending[0]?.metadata?.[ACTION_GATE_REASON_KEY]).toBe("classifier_timeout")

      // non-interactive allow reply is IGNORED (an auto-approver cannot answer) -> stays pending
      yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
      expect(yield* permission.list()).toHaveLength(1)

      // interactive "once" resolves manual:true and saves NO rule
      yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
      expect((yield* Fiber.join(fiber)).manual).toBe(true)
      expect(yield* permission.list()).toHaveLength(0)

      // no persisted rule: a fresh ORDINARY ask (empty ruleset) for the same session is still pending
      const fresh = yield* permission
        .ask({
          sessionID: SessionID.make("session_deg"),
          permission: "bash",
          patterns: ["echo hi"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        .pipe(Effect.forkScoped)
      const p2 = yield* waitForPending(permission, 1)
      yield* permission.reply({ requestID: p2[0]!.id, reply: "reject" })
      yield* Fiber.await(fresh)
    }),
  { git: true },
)

it.instance(
  "defense-in-depth: EMPTY patterns + degraded still forces a prompt (backstop against fail-open)",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const fiber = yield* permission
        .ask({
          sessionID: SessionID.make("session_empty"),
          permission: "bash",
          patterns: [],
          metadata: degradedMeta,
          always: [],
          ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        .pipe(Effect.forkScoped)

      const pending = yield* waitForPending(permission, 1) // empty patterns must NOT auto-approve
      expect(pending).toHaveLength(1)
      yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
      yield* Fiber.await(fiber)
    }),
  { git: true },
)
