import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { argKeys, decide, enabled, type McpGateDeps } from "../../src/kilocode/gate/mcp-gate"
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

describe("McpGate.decide — verdict routing (fake judge; surface applies allow/block/ask)", () => {
  const askJudge = () => Effect.succeed<Verdict>({ decision: "ask", reasonCode: "classifier_unavailable" })
  test("allow -> allow", async () => {
    expect(await run(decide(mkDeps({}, allowJudge)))).toEqual({ decision: "allow", reasonCode: "matches_intent" })
  })
  test("block -> block(off_intent)", async () => {
    expect(await run(decide(mkDeps({}, blockJudge)))).toEqual({ decision: "block", reasonCode: "off_intent" })
  })
  test("ask (classifier infra failure) -> ask(classifier_unavailable) [surface will escalate to a prompt]", async () => {
    expect(await run(decide(mkDeps({}, askJudge)))).toEqual({ decision: "ask", reasonCode: "classifier_unavailable" })
  })
  test("abort inside judge -> interruption propagates", async () => {
    const abortJudge = () => Effect.interrupt as unknown as Effect.Effect<Verdict>
    expect(Exit.isFailure(await runExit(decide(mkDeps({}, abortJudge))))).toBe(true)
  })
})
