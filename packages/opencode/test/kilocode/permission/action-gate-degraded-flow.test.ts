import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "@/permission"
import { testEffect } from "../../lib/effect"
import { SessionID } from "@/session/schema"
import * as Config from "@/config/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { guardSurface } from "@/kilocode/gate/degraded"
import type { Context } from "@/tool/tool"
import type { Verdict } from "@/kilocode/gate/action-judge"

// End-to-end proof of the ACTUAL degraded flow through the REAL production adapter (guardSurface) + the REAL
// Permission.Service. The `run` mirrors a write tool: an AUXILIARY external_directory ask (must pass through
// unchanged) then the ACTION-level "edit" ask (becomes the single degraded prompt). This is exactly what
// session/tools.ts / code-mode.ts do — the same guardSurface, wired with appliesTo = the action permission.

const env = Layer.mergeAll(
  AppNodeBuilder.build(Permission.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
)
const it = testEffect(env)
const SID = SessionID.make("session_flow")

// A ctx whose ask() routes to the real Permission.Service (mirrors session/tools.ts: adds sessionID + a
// static allow-everything ruleset, so we prove degraded overrides even an allow-everything rule).
const mkCtx = (permission: Permission.Interface): Context =>
  ({
    ask: (req: Parameters<Context["ask"]>[0]) =>
      permission.ask({ ...req, sessionID: SID, ruleset: [{ permission: "*", pattern: "*", action: "allow" }] }),
  }) as unknown as Context

// mirrors a real write tool: auxiliary external_directory ask, then the action-level "edit" ask, then execute once.
const runWriteTool = (ctx: Context, counter: { n: number }) =>
  Effect.gen(function* () {
    yield* ctx.ask({ permission: "external_directory", patterns: ["/w/*"], always: ["/w/*"], metadata: {} })
    yield* ctx.ask({ permission: "edit", patterns: ["/w/file"], always: ["/w/file"], metadata: { filepath: "/w/file" } })
    counter.n++
    return "EXECUTED"
  })

// The production adapter, wired exactly as the write surface wires it.
const surface = (verdict: Verdict, ctx: Context, counter: { n: number }) =>
  guardSurface({
    decide: Effect.succeed(verdict),
    ctx,
    appliesTo: (p) => p === "edit", // only the action-level ask is tagged
    blockMessage: (rc) => `Blocked by write gate (${rc}).`,
    run: (c) => runWriteTool(c, counter),
  })

const waitForPending = (permission: Permission.Interface, count: number) =>
  Effect.gen(function* () {
    while (true) {
      const pending = yield* permission.list()
      if (pending.length === count) return pending
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.fail(new Error("timed out")) }))

it.instance(
  "allow verdict -> both asks auto-approve -> execute once, no prompt",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const counter = { n: 0 }
      const out = yield* surface({ decision: "allow", reasonCode: "matches_intent" }, mkCtx(permission), counter)
      expect(out).toBe("EXECUTED")
      expect(counter.n).toBe(1)
      expect(yield* permission.list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "ask verdict -> exactly ONE prompt (the 'edit' ask); external_directory passes through; approve -> execute once",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const counter = { n: 0 }
      const fiber = yield* surface(
        { decision: "ask", reasonCode: "classifier_timeout" },
        mkCtx(permission),
        counter,
      ).pipe(Effect.forkScoped)
      // external_directory auto-approved (not tagged); only the degraded "edit" ask is pending.
      const pending = yield* waitForPending(permission, 1)
      expect(pending[0]?.permission).toBe("edit")
      expect(pending[0]?.metadata?.actionGateDegraded).toBe(true)
      expect(counter.n).toBe(0)
      yield* permission.reply({ requestID: pending[0]!.id, reply: "once", interactive: true })
      expect(yield* Fiber.join(fiber)).toBe("EXECUTED")
      expect(counter.n).toBe(1)
    }),
  { git: true },
)

it.instance(
  "ask verdict -> reject the prompt -> execute ZERO (deny-and-continue)",
  () =>
    // NOTE: this proves the reject path. In `kilo run` (headless) the client auto-replies reject
    // (cli/cmd/run.ts) which reaches here as the same reject; a bare `kilo serve` with NO permission
    // client would instead leave the request pending — that is out of scope for this test.
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const counter = { n: 0 }
      const fiber = yield* surface(
        { decision: "ask", reasonCode: "classifier_error" },
        mkCtx(permission),
        counter,
      ).pipe(Effect.forkScoped)
      const pending = yield* waitForPending(permission, 1)
      yield* permission.reply({ requestID: pending[0]!.id, reply: "reject" })
      yield* Fiber.await(fiber)
      expect(counter.n).toBe(0)
    }),
  { git: true },
)

it.instance(
  "ask verdict -> user/session abort during the prompt -> interrupt, execute ZERO",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const counter = { n: 0 }
      const fiber = yield* surface(
        { decision: "ask", reasonCode: "classifier_unavailable" },
        mkCtx(permission),
        counter,
      ).pipe(Effect.forkScoped)
      yield* waitForPending(permission, 1)
      yield* Fiber.interrupt(fiber)
      expect(counter.n).toBe(0)
    }),
  { git: true },
)
