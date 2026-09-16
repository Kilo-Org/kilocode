import { expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { testEffect } from "../../lib/effect"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import {
  ACTION_GATE_AUTHORIZED_KEY,
  ACTION_GATE_DEGRADED_KEY,
  ACTION_GATE_REASON_KEY,
} from "@/kilocode/permission/interactive-approval"

// Real Permission.Service proof for the classifier one-shot pre-approval (KILO_ACTION_GATE_AUTHORIZER). The
// permission layer honors the marker ONLY when the flag is also on (a marker alone — flag off, stale, forged —
// must NOT pre-approve). The pre-approval suppresses ONLY the marked action's prompt, persists NO rule, and
// NEVER weakens deny / hardRuleset / Config Protection / a forced (degraded) prompt.

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)

const FLAG = "KILO_ACTION_GATE_AUTHORIZER"
const authorized = { [ACTION_GATE_AUTHORIZED_KEY]: true }

/** Set KILO_ACTION_GATE_AUTHORIZER for the duration of `body`, restoring the prior value even on failure. */
const withFlag = <A, E, R>(value: string | undefined, body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env[FLAG]
      if (value === undefined) delete process.env[FLAG]
      else process.env[FLAG] = value
      return prev
    }),
    () => body,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env[FLAG]
        else process.env[FLAG] = prev
      }),
  )

const waitForPending = (permission: Permission.Interface, count: number) =>
  Effect.gen(function* () {
    while (true) {
      const pending = yield* permission.list()
      if (pending.length === count) return pending
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.fail(new Error("timed out")) }))

it.instance(
  "flag OFF (=0) + marker: NOT honored — an ordinary would-ask request still creates a pending prompt",
  () =>
    withFlag(
      "0",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const fiber = yield* permission
          .ask({
            sessionID: SessionID.make("session_off"),
            permission: "bash",
            patterns: ["curl example.com"],
            metadata: authorized, // marker present, but the feature is OFF
            always: [],
            ruleset: [], // default -> ask
          })
          .pipe(Effect.forkScoped)
        const pending = yield* waitForPending(permission, 1) // marker alone must not pre-approve
        expect(pending).toHaveLength(1)
        yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        yield* Fiber.await(fiber)
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON + marker: pre-approved (manual:false, source action_gate), NO prompt, saves NO rule",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("session_on")
        const result = yield* permission.ask({
          sessionID,
          permission: "bash",
          patterns: ["curl example.com"],
          metadata: authorized,
          always: [],
          ruleset: [], // would ASK without flag+marker
        })
        expect(result.manual).toBe(false) // no prompt
        expect((result.rule as { source?: string } | undefined)?.source).toBe("action_gate") // not default/yolo/manual
        expect(yield* permission.list()).toHaveLength(0) // no pending request left behind

        // BEHAVIORAL proof that no rule persisted: an identical request WITHOUT the marker must ask again.
        const fiber = yield* permission
          .ask({
            sessionID,
            permission: "bash",
            patterns: ["curl example.com"],
            metadata: {},
            always: [],
            ruleset: [],
          })
          .pipe(Effect.forkScoped)
        const pending = yield* waitForPending(permission, 1) // pre-approval was one-shot; the rule did NOT stick
        expect(pending).toHaveLength(1)
        yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        yield* Fiber.await(fiber)
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON: provenance is order-independent — one pattern allowed by a rule + one pre-approved -> source action_gate",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const result = yield* permission.ask({
          sessionID: SessionID.make("session_prov"),
          permission: "bash",
          patterns: ["a", "b"],
          metadata: authorized,
          always: [],
          ruleset: [{ permission: "bash", pattern: "a", action: "allow" }], // "a" allowed by rule, "b" would ask
        })
        expect(result.manual).toBe(false)
        expect((result.rule as { source?: string } | undefined)?.source).toBe("action_gate")
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON: explicit deny is NOT bypassed by the marker",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const exit = yield* permission
          .ask({
            sessionID: SessionID.make("session_deny"),
            permission: "bash",
            patterns: ["curl example.com"],
            metadata: authorized,
            always: [],
            ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true) // DeniedError, not a pre-approval
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON: hardRuleset deny is NOT bypassed by the marker",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const exit = yield* permission
          .ask({
            sessionID: SessionID.make("session_hard"),
            permission: "bash",
            patterns: ["curl example.com"],
            metadata: authorized,
            always: [],
            ruleset: [], // would-ask
            hardRuleset: [{ permission: "bash", pattern: "*", action: "deny" }],
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON: Config Protection still asks despite the marker (protected .kilo/kilo.json edit)",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const fiber = yield* permission
          .ask({
            sessionID: SessionID.make("session_cfg"),
            permission: "edit",
            patterns: [".kilo/kilo.json"],
            metadata: authorized,
            always: [],
            ruleset: [],
          })
          .pipe(Effect.forkScoped)
        const pending = yield* waitForPending(permission, 1) // protected path is NOT pre-approved
        expect(pending).toHaveLength(1)
        yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        yield* Fiber.await(fiber)
      }),
    ),
  { git: true },
)

it.instance(
  "flag ON: a forced (degraded) prompt wins even if the authorized marker is also present",
  () =>
    withFlag(
      "1",
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const fiber = yield* permission
          .ask({
            sessionID: SessionID.make("session_force"),
            permission: "bash",
            patterns: ["*"],
            metadata: { ...authorized, [ACTION_GATE_DEGRADED_KEY]: true, [ACTION_GATE_REASON_KEY]: "classifier_timeout" },
            always: [],
            ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          .pipe(Effect.forkScoped)
        const pending = yield* waitForPending(permission, 1) // forceAsk beats the pre-approval
        expect(pending).toHaveLength(1)
        yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
        yield* Fiber.await(fiber)
      }),
    ),
  { git: true },
)
