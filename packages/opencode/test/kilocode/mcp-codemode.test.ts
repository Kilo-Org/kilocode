import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { guardChildMcpCall, type ChildMcpCtx } from "../../src/kilocode/gate/mcp-codemode"
import type { McpJudgeInput, MessageView, Verdict } from "../../src/kilocode/gate/action-judge"

// Exercises the Code Mode child-MCP wiring (code-mode.ts invokeChildTool -> guardChildMcpCall) WITHOUT a
// live MCP server: fake makeJudge + fake execute. The generic McpGate.guardedExecute behavior is proven
// separately (mcp-gate.test.ts); here we prove the ADAPTER derives identity/intent/child correctly and
// hands off to the real gate + child call.
const allowJudge = () => Effect.succeed<Verdict>({ decision: "allow", reasonCode: "matches_intent" })
const blockJudge = () => Effect.succeed<Verdict>({ decision: "block", reasonCode: "off_intent" })
const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)
const causeText = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")

const TOOL = { clientName: "github", def: { name: "create_issue" } }
const ARGS = { title: "x", token: "SECRET-CANARY" }
const MODEL = { providerID: "openrouter", modelID: "test-model" }

const userMsg = (id: string, text: string): MessageView => ({
  info: { id, role: "user", model: MODEL },
  parts: [{ type: "text", text }],
})

const mkCtx = (over: Partial<ChildMcpCtx> = {}): ChildMcpCtx => ({
  messages: [userMsg("u1", "open a github issue")],
  userMessageID: "u1",
  parentSessionID: undefined,
  abort: new AbortController().signal,
  sessionID: "s1",
  callID: "c1",
  ...over,
})

const counted = () => {
  let ran = 0
  return { execute: () => Effect.sync(() => { ran++; return "MCP_RESULT" }), calls: () => ran }
}

describe("guardChildMcpCall — Code Mode child-MCP gate wiring", () => {
  test("allow -> child execute called EXACTLY once, returns its value", async () => {
    const { execute, calls } = counted()
    const out = await run(guardChildMcpCall({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => allowJudge, execute }))
    expect(out).toBe("MCP_RESULT")
    expect(calls()).toBe(1)
  })

  test("block -> child execute NOT called", async () => {
    const { execute, calls } = counted()
    const exit = await runExit(guardChildMcpCall({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => blockJudge, execute }))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls()).toBe(0)
  })

  test("child session (parentSessionID set) -> unverified_child_intent; judge and child execute NOT called", async () => {
    let judged = 0
    const { execute, calls } = counted()
    const exit = await runExit(
      guardChildMcpCall({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx({ parentSessionID: "parent-session" }),
        makeJudge: () => () => { judged++; return allowJudge() },
        execute,
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(causeText(exit)).toContain("unverified_child_intent")
    expect(judged).toBe(0)
    expect(calls()).toBe(0)
  })

  test("missing intent (userMessageID not in messages) -> intent_missing; judge and child execute NOT called", async () => {
    let judged = 0
    const { execute, calls } = counted()
    const exit = await runExit(
      guardChildMcpCall({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx({ userMessageID: "absent" }),
        makeJudge: () => () => { judged++; return allowJudge() },
        execute,
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(causeText(exit)).toContain("intent_missing")
    expect(judged).toBe(0)
    expect(calls()).toBe(0)
  })

  test("judge sees derived server + tool + argKeys and the turn intent (values never included)", async () => {
    let seen: McpJudgeInput | undefined
    await run(
      guardChildMcpCall({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx(),
        makeJudge: () => (mi) => { seen = mi; return allowJudge() },
        execute: () => Effect.sync(() => "MCP_RESULT"),
      }),
    )
    expect(seen?.surface).toBe("mcp")
    expect(seen?.server).toBe("github")
    expect(seen?.tool).toBe("create_issue")
    expect(seen?.argKeys).toEqual(["title", "token"])
    expect(seen?.userIntent).toBe("open a github issue")
    expect(JSON.stringify(seen).includes("SECRET-CANARY")).toBe(false)
  })

  test("model from the turn-initiating message is threaded to the judge factory", async () => {
    let gotModel: unknown
    await run(
      guardChildMcpCall({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx(),
        makeJudge: (model) => { gotModel = model; return allowJudge },
        execute: () => Effect.sync(() => "MCP_RESULT"),
      }),
    )
    expect(gotModel).toEqual(MODEL)
  })
})
