import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { argKeys, decide, guardedExecute, enabled, type McpGateDeps } from "../../src/kilocode/gate/mcp-gate"
import type { McpJudgeInput, Verdict } from "../../src/kilocode/gate/action-judge"

const allowJudge = () => Effect.succeed<Verdict>({ decision: "allow", reasonCode: "matches_intent" })
const blockJudge = () => Effect.succeed<Verdict>({ decision: "block", reasonCode: "off_intent" })
const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

const mkDeps = (over: Partial<McpGateDeps>, judge: McpGateDeps["judge"]): McpGateDeps => ({
  server: "github",
  tool: "create_issue",
  args: { title: "x", token: "SECRET-CANARY" },
  isChildSession: false,
  intent: "open a github issue",
  judge,
  ...over,
})

describe("McpGate — flag + argKeys (values never included)", () => {
  test("flag OFF by default", () => {
    expect(enabled).toBe(false)
  })
  test("argKeys are sorted keys only, no values", () => {
    const keys = argKeys({ token: "SECRET-CANARY", title: "x", body: "y" })
    expect(keys).toEqual(["body", "title", "token"])
    expect(JSON.stringify(keys).includes("SECRET-CANARY")).toBe(false)
  })
})

describe("McpGate.decide / guard — behavioral (fake judge)", () => {
  test("child-session -> block(unverified_child_intent); judge NOT called", async () => {
    let judged = 0
    const deps = mkDeps({ isChildSession: true }, () => {
      judged++
      return allowJudge()
    })
    expect(await run(decide(deps))).toEqual({ decision: "block", reasonCode: "unverified_child_intent" })
    expect(judged).toBe(0)
  })
  test("missing intent -> block(intent_missing); judge NOT called", async () => {
    let judged = 0
    const deps = mkDeps({ intent: undefined }, () => {
      judged++
      return allowJudge()
    })
    expect(await run(decide(deps))).toEqual({ decision: "block", reasonCode: "intent_missing" })
    expect(judged).toBe(0)
  })
  test("judge sees server + tool + argKeys, never values", async () => {
    let seen: McpJudgeInput | undefined
    await run(
      decide(
        mkDeps({}, (i) => {
          seen = i
          return allowJudge()
        }),
      ),
    )
    expect(seen?.server).toBe("github")
    expect(seen?.tool).toBe("create_issue")
    expect(seen?.argKeys).toEqual(["title", "token"])
    expect(JSON.stringify(seen).includes("SECRET-CANARY")).toBe(false)
  })
})

describe("McpGate.guardedExecute — external MCP execute called exactly once on allow, never otherwise", () => {
  const abortJudge = () => Effect.interrupt as unknown as Effect.Effect<Verdict>
  const counted = () => {
    let ran = 0
    const exec = () => Effect.sync(() => { ran++; return "MCP_RESULT" })
    return { exec, calls: () => ran }
  }

  test("allow -> execute called EXACTLY once, returns its value", async () => {
    const { exec, calls } = counted()
    const out = await run(guardedExecute(mkDeps({}, allowJudge), exec))
    expect(out).toBe("MCP_RESULT")
    expect(calls()).toBe(1)
  })
  test("block -> execute NOT called", async () => {
    const { exec, calls } = counted()
    const exit = await runExit(guardedExecute(mkDeps({}, blockJudge), exec))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls()).toBe(0)
  })
  test("child-session -> execute NOT called (judge not called either)", async () => {
    let judged = 0
    const { exec, calls } = counted()
    const exit = await runExit(guardedExecute(mkDeps({ isChildSession: true }, () => { judged++; return allowJudge() }), exec))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls()).toBe(0)
    expect(judged).toBe(0)
  })
  test("missing intent -> execute NOT called (judge not called either)", async () => {
    let judged = 0
    const { exec, calls } = counted()
    const exit = await runExit(guardedExecute(mkDeps({ intent: undefined }, () => { judged++; return allowJudge() }), exec))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls()).toBe(0)
    expect(judged).toBe(0)
  })
  test("abort inside judge -> interruption propagates; execute NOT called", async () => {
    const { exec, calls } = counted()
    const exit = await runExit(guardedExecute(mkDeps({}, abortJudge), exec))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls()).toBe(0)
  })
})
