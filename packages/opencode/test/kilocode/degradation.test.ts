import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { withDegraded, guardSurface } from "../../src/kilocode/gate/degraded"
import {
  requiresInteractiveApproval,
  ACTION_GATE_DEGRADED_KEY,
  ACTION_GATE_REASON_KEY,
} from "../../src/kilocode/permission/interactive-approval"
import { buildRecord, isRedacted } from "../../src/kilocode/gate/action-telemetry"
import type { Context } from "../../src/tool/tool"
import type { Verdict } from "../../src/kilocode/gate/action-judge"

type AnyReq = Parameters<Context["ask"]>[0]
const fakeCtx = (capture: (req: AnyReq) => void) =>
  ({
    ask: (req: AnyReq) => {
      capture(req)
      return Effect.succeed(undefined)
    },
  }) as unknown as Context
const meta = (req: AnyReq | undefined) => (req?.metadata ?? {}) as Record<string, unknown>
const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

// withDegraded tags ONLY the action-level ask (appliesTo(permission)); a tool's auxiliary asks (e.g.
// external_directory before edit) pass through untouched, so there is exactly one degraded prompt.
describe("withDegraded — tags ONLY the action-level ask; auxiliary asks pass through", () => {
  test("matching (action-level) ask: real permission/patterns + metadata kept, degraded tags added, always:[]", async () => {
    let seen: AnyReq | undefined
    const wrapped = withDegraded(fakeCtx((r) => (seen = r)), "classifier_timeout", (p) => p === "edit")
    await run(wrapped.ask({ permission: "edit", patterns: ["/p/*"], always: ["/p/*"], metadata: { command: "x" } }))
    const r = seen as AnyReq
    expect(r.permission).toBe("edit")
    expect(r.patterns).toEqual(["/p/*"]) // real patterns kept (forceAsk needs them)
    expect(r.always).toEqual([]) // one-shot: persists no rule
    expect(meta(r).command).toBe("x") // original metadata preserved
    expect(meta(r)[ACTION_GATE_DEGRADED_KEY]).toBe(true)
    expect(meta(r)[ACTION_GATE_REASON_KEY]).toBe("classifier_timeout")
  })

  test("non-matching (auxiliary) ask passes through UNCHANGED — external_directory is NOT tagged", async () => {
    let seen: AnyReq | undefined
    const wrapped = withDegraded(fakeCtx((r) => (seen = r)), "classifier_timeout", (p) => p === "edit")
    await run(wrapped.ask({ permission: "external_directory", patterns: ["/d/*"], always: ["/d/*"], metadata: {} }))
    const r = seen as AnyReq
    expect(r.always).toEqual(["/d/*"]) // untouched
    expect(meta(r)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined()
  })

  test("does NOT mutate the original ctx.ask", async () => {
    let baseSeen: AnyReq | undefined
    const base = fakeCtx((r) => (baseSeen = r))
    withDegraded(base, "classifier_error", () => true)
    await run(base.ask({ permission: "edit", patterns: ["x"], always: ["x"], metadata: {} }))
    expect((baseSeen as AnyReq).always).toEqual(["x"])
    expect(meta(baseSeen)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined()
  })
})

// guardSurface is the shared, testable production adapter every wrapper surface (write/mcp/codemode) uses:
// decide -> block (throw) | ask (run via selective withDegraded) | allow (run). The fake `run` mirrors a
// tool making an auxiliary external_directory ask then the action-level "edit" ask, then executing once.
describe("guardSurface — decide -> block | selective withDegraded -> run", () => {
  type AskLog = { permission: string; degraded: boolean; always: readonly string[] }
  const recCtx = (log: AskLog[], failOn?: string) =>
    ({
      ask: (req: AnyReq) => {
        log.push({
          permission: req.permission,
          degraded: meta(req)[ACTION_GATE_DEGRADED_KEY] === true,
          always: req.always,
        })
        return failOn && req.permission === failOn
          ? (Effect.fail(new Error("denied")) as unknown as Effect.Effect<void>)
          : Effect.succeed(undefined)
      },
    }) as unknown as Context
  // mirrors the write tool: an AUXILIARY external_directory ask, then the ACTION-level "edit" ask, then execute once.
  const runWriteLike = (ctx: Context, counter: { n: number }) =>
    Effect.gen(function* () {
      yield* ctx.ask({ permission: "external_directory", patterns: ["/w/*"], always: ["/w/*"], metadata: {} })
      yield* ctx.ask({ permission: "edit", patterns: ["/w/f"], always: ["/w/f"], metadata: {} })
      counter.n++
      return "EXECUTED"
    })
  const surface = (verdict: Verdict, ctx: Context, counter: { n: number }) =>
    guardSurface({
      decide: Effect.succeed(verdict),
      ctx,
      appliesTo: (p) => p === "edit",
      blockMessage: (rc) => `blocked ${rc}`,
      run: (c) => runWriteLike(c, counter),
    })

  test("allow -> execute once; NO ask tagged", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    const out = await run(surface({ decision: "allow", reasonCode: "matches_intent" }, recCtx(log), counter))
    expect(out).toBe("EXECUTED")
    expect(counter.n).toBe(1)
    expect(log.every((a) => !a.degraded)).toBe(true)
  })

  test("block -> execute ZERO (run never called)", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    const exit = await runExit(surface({ decision: "block", reasonCode: "off_intent" }, recCtx(log), counter))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(counter.n).toBe(0)
    expect(log).toHaveLength(0)
  })

  test("ask -> ONLY the action-level 'edit' ask tagged (external_directory untouched); execute once on approve", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    await run(surface({ decision: "ask", reasonCode: "classifier_timeout" }, recCtx(log), counter))
    const ext = log.find((a) => a.permission === "external_directory")!
    const edit = log.find((a) => a.permission === "edit")!
    expect(ext.degraded).toBe(false) // auxiliary ask NOT tagged
    expect(ext.always).toEqual(["/w/*"]) // and unchanged
    expect(edit.degraded).toBe(true) // action-level ask IS the degraded prompt
    expect(edit.always).toEqual([]) // one-shot
    expect(counter.n).toBe(1)
  })

  test("ask -> action-level ask denied (reject/headless) -> execute ZERO", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    const exit = await runExit(surface({ decision: "ask", reasonCode: "classifier_error" }, recCtx(log, "edit"), counter))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(counter.n).toBe(0) // execute after the (denied) edit ask never runs
  })
})

describe("requiresInteractiveApproval — degraded joins skillShell/sandboxEscalation", () => {
  test("true for actionGateDegraded / skillShell / sandboxEscalation", () => {
    expect(requiresInteractiveApproval({ [ACTION_GATE_DEGRADED_KEY]: true })).toBe(true)
    expect(requiresInteractiveApproval({ skillShell: true })).toBe(true)
    expect(requiresInteractiveApproval({ sandboxEscalation: true })).toBe(true)
  })
  test("false for ordinary / empty / undefined metadata", () => {
    expect(requiresInteractiveApproval({})).toBe(false)
    expect(requiresInteractiveApproval(undefined)).toBe(false)
    expect(requiresInteractiveApproval({ [ACTION_GATE_DEGRADED_KEY]: false })).toBe(false)
    expect(requiresInteractiveApproval({ some: "value" })).toBe(false)
  })
})

describe("telemetry accepts the ask decision and stays redacted", () => {
  test("decision=ask, tokens null (model call did not complete), only allowlisted keys", () => {
    const r = buildRecord({
      sessionID: "s",
      callID: "c",
      decision: "ask",
      reasonCode: "classifier_timeout",
      providerID: "openrouter",
      modelID: "inkling",
      durationMs: 5,
    })
    expect(r.decision).toBe("ask")
    expect(r.reasonCode).toBe("classifier_timeout")
    expect(r.inputTokens).toBe(null)
    expect(r.outputTokens).toBe(null)
    expect(isRedacted(r as unknown as Record<string, unknown>)).toBe(true)
  })
})
