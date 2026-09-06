import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { withAuthorizer, guardSurface } from "../../src/kilocode/gate/degraded"
import {
  isActionGateAuthorized,
  authorizerAllows,
  requiresInteractiveApproval,
  ACTION_GATE_AUTHORIZED_KEY,
  ACTION_GATE_DEGRADED_KEY,
} from "../../src/kilocode/permission/interactive-approval"

const FLAG = "KILO_ACTION_GATE_AUTHORIZER"
function withFlag<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env[FLAG]
  if (value === undefined) delete process.env[FLAG]
  else process.env[FLAG] = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env[FLAG]
    else process.env[FLAG] = prev
  }
}
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

// withAuthorizer tags ONLY the action-level ask (appliesTo(permission)) with the one-shot pre-approval marker;
// a tool's auxiliary asks (external_directory, sandbox_escalation) pass through untouched, so pre-approval
// never covers an auxiliary prompt.
describe("withAuthorizer — tags ONLY the action-level ask; auxiliary asks pass through", () => {
  test("matching (action-level) ask: marker added, always:[], real permission/patterns/metadata kept", async () => {
    let seen: AnyReq | undefined
    const wrapped = withAuthorizer(fakeCtx((r) => (seen = r)), (p) => p === "edit")
    await run(wrapped.ask({ permission: "edit", patterns: ["/p/*"], always: ["/p/*"], metadata: { command: "x" } }))
    const r = seen as AnyReq
    expect(r.permission).toBe("edit")
    expect(r.patterns).toEqual(["/p/*"])
    expect(r.always).toEqual([]) // one-shot: persists no rule
    expect(meta(r).command).toBe("x")
    expect(meta(r)[ACTION_GATE_AUTHORIZED_KEY]).toBe(true)
    expect(meta(r)[ACTION_GATE_DEGRADED_KEY]).toBeUndefined() // never conflated with degraded
  })

  test("non-matching (auxiliary) ask passes through UNCHANGED — external_directory is NOT marked", async () => {
    let seen: AnyReq | undefined
    const wrapped = withAuthorizer(fakeCtx((r) => (seen = r)), (p) => p === "edit")
    await run(wrapped.ask({ permission: "external_directory", patterns: ["/d/*"], always: ["/d/*"], metadata: {} }))
    const r = seen as AnyReq
    expect(r.always).toEqual(["/d/*"]) // untouched
    expect(meta(r)[ACTION_GATE_AUTHORIZED_KEY]).toBeUndefined()
  })

  test("does NOT mutate the original ctx.ask", async () => {
    let baseSeen: AnyReq | undefined
    const base = fakeCtx((r) => (baseSeen = r))
    withAuthorizer(base, () => true)
    await run(base.ask({ permission: "edit", patterns: ["x"], always: ["x"], metadata: {} }))
    expect((baseSeen as AnyReq).always).toEqual(["x"])
    expect(meta(baseSeen)[ACTION_GATE_AUTHORIZED_KEY]).toBeUndefined()
  })
})

// guardSurface: decide -> block (throw) | ask (withDegraded) | allow (withAuthorizer ONLY when canAuthorize).
describe("guardSurface — allow + canAuthorize -> selective pre-approval; else unchanged", () => {
  type AskLog = { permission: string; authorized: boolean; degraded: boolean; always: readonly string[] }
  const recCtx = (log: AskLog[]) =>
    ({
      ask: (req: AnyReq) => {
        log.push({
          permission: req.permission,
          authorized: meta(req)[ACTION_GATE_AUTHORIZED_KEY] === true,
          degraded: meta(req)[ACTION_GATE_DEGRADED_KEY] === true,
          always: req.always,
        })
        return Effect.succeed(undefined)
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
  const surface = (verdict: Verdict, ctx: Context, counter: { n: number }, canAuthorize?: boolean) =>
    guardSurface({
      decide: Effect.succeed(verdict),
      ctx,
      appliesTo: (p) => p === "edit",
      blockMessage: (rc) => `blocked ${rc}`,
      run: (c) => runWriteLike(c, counter),
      canAuthorize,
    })
  const allow: Verdict = { decision: "allow", reasonCode: "matches_intent" }

  test("authorizer ON (canAuthorize=true): ONLY the action-level 'edit' ask marked; external_directory untouched; execute once", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    const out = await run(surface(allow, recCtx(log), counter, true))
    expect(out).toBe("EXECUTED")
    expect(counter.n).toBe(1)
    const ext = log.find((a) => a.permission === "external_directory")!
    const edit = log.find((a) => a.permission === "edit")!
    expect(ext.authorized).toBe(false) // auxiliary ask NOT pre-approved
    expect(ext.always).toEqual(["/w/*"]) // and unchanged
    expect(edit.authorized).toBe(true) // action-level ask IS pre-approved
    expect(edit.always).toEqual([]) // one-shot: no rule
    expect(log.every((a) => !a.degraded)).toBe(true) // never a degraded escalation
  })

  test("authorizer OFF (canAuthorize=false, e.g. flag off or child session): allow -> NO ask marked (prior behavior)", async () => {
    for (const canAuthorize of [false, undefined]) {
      const log: AskLog[] = []
      const counter = { n: 0 }
      await run(surface(allow, recCtx(log), counter, canAuthorize))
      expect(counter.n).toBe(1)
      expect(log.every((a) => !a.authorized)).toBe(true)
      expect(log.find((a) => a.permission === "edit")!.always).toEqual(["/w/f"]) // untouched
    }
  })

  test("regression: block still throws and never executes, even with canAuthorize", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    const exit = await runExit(surface({ decision: "block", reasonCode: "off_intent" }, recCtx(log), counter, true))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(counter.n).toBe(0)
    expect(log).toHaveLength(0)
  })

  test("regression: ask still tags degraded (not authorized), even with canAuthorize", async () => {
    const log: AskLog[] = []
    const counter = { n: 0 }
    await run(surface({ decision: "ask", reasonCode: "classifier_timeout" }, recCtx(log), counter, true))
    const edit = log.find((a) => a.permission === "edit")!
    expect(edit.degraded).toBe(true)
    expect(edit.authorized).toBe(false)
  })
})

// isActionGateAuthorized requires BOTH the flag AND the marker: a marker alone (flag off / stale / forged)
// must never authorize. It is also SEPARATE from requiresInteractiveApproval.
describe("isActionGateAuthorized requires flag AND marker; separate from requiresInteractiveApproval", () => {
  test("flag ON + marker -> true; flag ON without marker -> false", () => {
    withFlag("1", () => {
      expect(isActionGateAuthorized({ [ACTION_GATE_AUTHORIZED_KEY]: true })).toBe(true)
      expect(isActionGateAuthorized({ [ACTION_GATE_AUTHORIZED_KEY]: false })).toBe(false)
      expect(isActionGateAuthorized({})).toBe(false)
      expect(isActionGateAuthorized(undefined)).toBe(false)
    })
  })
  test("flag OFF / 0: even a present marker does NOT authorize", () => {
    for (const v of [undefined, "0"]) {
      withFlag(v, () => expect(isActionGateAuthorized({ [ACTION_GATE_AUTHORIZED_KEY]: true })).toBe(false))
    }
  })
  test("the authorized marker does NOT count as requires-interactive (not conflated with degraded/skillShell)", () => {
    withFlag("1", () => expect(requiresInteractiveApproval({ [ACTION_GATE_AUTHORIZED_KEY]: true })).toBe(false))
  })
})

// authorizerAllows is the marker-setting gate: flag AND a ROOT session (child/subagent refused).
describe("authorizerAllows — flag AND root session", () => {
  test("flag ON: root (null/undefined parent) -> true; genuine child (parent set) -> false", () => {
    withFlag("1", () => {
      expect(authorizerAllows(null)).toBe(true)
      expect(authorizerAllows(undefined)).toBe(true)
      expect(authorizerAllows("session_parent")).toBe(false) // child/subagent never pre-approved
    })
  })
  test("flag OFF: never, even for a root session", () => {
    for (const v of [undefined, "0"]) {
      withFlag(v, () => {
        expect(authorizerAllows(null)).toBe(false)
        expect(authorizerAllows("session_parent")).toBe(false)
      })
    }
  })
})
