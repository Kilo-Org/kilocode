import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { decideChildMcp, type ChildMcpCtx } from "../../src/kilocode/gate/mcp-codemode"
import type { McpJudgeInput, MessageView, Verdict } from "../../src/kilocode/gate/action-judge"

// Exercises the Code Mode child-MCP adapter (code-mode.ts invokeChildTool -> decideChildMcp) WITHOUT a
// live MCP server: the adapter only DECIDES the verdict from a fake judge; code-mode.ts applies it
// (block -> throw; ask -> run the child call through DegradedGate.withDegraded(ctx) so the child MCP
// tool's OWN permission ask becomes the degraded prompt). Here we prove the adapter derives
// identity/intent/child correctly and returns the right verdict.
const allowJudge = () => Effect.succeed<Verdict>({ decision: "allow", reasonCode: "matches_intent" })
const blockJudge = () => Effect.succeed<Verdict>({ decision: "block", reasonCode: "off_intent" })
const askJudge = () => Effect.succeed<Verdict>({ decision: "ask", reasonCode: "classifier_error" })
const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

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

describe("decideChildMcp — Code Mode child-MCP verdict routing", () => {
  test("allow judge -> allow", async () => {
    expect(await run(decideChildMcp({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => allowJudge }))).toEqual({
      decision: "allow",
      reasonCode: "matches_intent",
    })
  })

  test("block judge -> block(off_intent)", async () => {
    expect(await run(decideChildMcp({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => blockJudge }))).toEqual({
      decision: "block",
      reasonCode: "off_intent",
    })
  })

  test("ask judge (classifier infra failure) -> ask(classifier_error) [code-mode escalates to a prompt]", async () => {
    expect(await run(decideChildMcp({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => askJudge }))).toEqual({
      decision: "ask",
      reasonCode: "classifier_error",
    })
  })

  test("child session (parentSessionID set) -> block(unverified_child_intent); judge NOT called", async () => {
    let judged = 0
    const v = await run(
      decideChildMcp({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx({ parentSessionID: "parent-session" }),
        makeJudge: () => () => { judged++; return allowJudge() },
      }),
    )
    expect(v).toEqual({ decision: "block", reasonCode: "unverified_child_intent" })
    expect(judged).toBe(0)
  })

  test("missing intent (userMessageID not in messages) -> block(intent_missing); judge NOT called", async () => {
    let judged = 0
    const v = await run(
      decideChildMcp({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx({ userMessageID: "absent" }),
        makeJudge: () => () => { judged++; return allowJudge() },
      }),
    )
    expect(v).toEqual({ decision: "block", reasonCode: "intent_missing" })
    expect(judged).toBe(0)
  })

  test("judge sees derived server + tool + argKeys and the turn intent (values never included)", async () => {
    let seen: McpJudgeInput | undefined
    await run(
      decideChildMcp({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx(),
        makeJudge: () => (mi) => { seen = mi; return allowJudge() },
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
      decideChildMcp({
        tool: TOOL,
        args: ARGS,
        ctx: mkCtx(),
        makeJudge: (model) => { gotModel = model; return allowJudge },
      }),
    )
    expect(gotModel).toEqual(MODEL)
  })

  test("abort inside judge -> interruption propagates", async () => {
    const abortJudge = () => Effect.interrupt as unknown as Effect.Effect<Verdict>
    const exit = await runExit(decideChildMcp({ tool: TOOL, args: ARGS, ctx: mkCtx(), makeJudge: () => abortJudge }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
