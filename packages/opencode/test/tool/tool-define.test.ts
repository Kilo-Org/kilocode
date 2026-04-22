import { describe, test, expect } from "bun:test"
import { Cause, Effect, Layer, ManagedRuntime } from "effect" // kilocode_change
import z from "zod"
import { Agent } from "../../src/agent/agent"
import { Tool } from "../../src/tool"
import { Truncate } from "../../src/tool"
// kilocode_change start
import { SessionID, MessageID } from "../../src/session/schema"
// kilocode_change end

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const params = z.object({ input: z.string() })

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    execute() {
      executeFn?.()
      return Effect.succeed({ title: "test", output: "ok", metadata: {} })
    },
  }
}

// kilocode_change start
function makeCtx(): Tool.Context {
  return {
    sessionID: SessionID.make("session_test"),
    messageID: MessageID.make("msg_test"),
    agent: "default",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

async function runTool(def: Tool.Def, args: unknown) {
  return Effect.runPromise(def.execute(args as any, makeCtx()).pipe(Effect.sandbox, Effect.flip))
}

describe("Tool.execute invalid JSON args", () => {
  test("reports non-object args as invalid JSON", async () => {
    const info = await runtime.runPromise(Tool.define("json-test", Effect.succeed(makeTool("json-test"))))
    const def = await Effect.runPromise(Tool.init(info))

    const cause = await runTool(def, "not-an-object")
    const msg = Cause.pretty(cause)
    expect(msg).toContain("json-test")
    expect(msg).toContain("invalid JSON")
  })

  test("reports null args as invalid JSON", async () => {
    const info = await runtime.runPromise(Tool.define("json-null", Effect.succeed(makeTool("json-null"))))
    const def = await Effect.runPromise(Tool.init(info))

    const cause = await runTool(def, null)
    const msg = Cause.pretty(cause)
    expect(msg).toContain("json-null")
    expect(msg).toContain("invalid JSON")
  })

  test("reports invalid Zod args with tool name", async () => {
    const info = await runtime.runPromise(Tool.define("zod-test", Effect.succeed(makeTool("zod-test"))))
    const def = await Effect.runPromise(Tool.init(info))

    const cause = await runTool(def, { input: 42 })
    const msg = Cause.pretty(cause)
    expect(msg).toContain("zod-test")
    expect(msg).toContain("invalid arguments")
  })
})
// kilocode_change end

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const info = await runtime.runPromise(Tool.define("test-tool", Effect.succeed(original)))

    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())

    expect(original.execute).toBe(originalExecute)
  })

  test("effect-defined tool returns fresh objects and is unaffected", async () => {
    const info = await runtime.runPromise(
      Tool.define(
        "test-fn-tool",
        Effect.succeed(() => Effect.succeed(makeTool("test"))),
      ),
    )

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const info = await runtime.runPromise(Tool.define("test-copy", Effect.succeed(makeTool("test"))))

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })
})
