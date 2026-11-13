import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { makeTools, type Runtime } from "../src/agent-manager/tool"

const context = {
  sessionID: SessionID.make("ses_test"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_test"),
  id: Tool.CallID.make("call_agent_manager_models"),
  progress: () => Effect.void,
}

function model(providerID: string, id: string, name: string, variants: ReadonlyArray<string> = []) {
  const base = Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id))
  return {
    ...base,
    name,
    variants: variants.map((variant) => ({ id: Model.VariantID.make(variant) })),
  }
}

const bulk = Array.from({ length: 22 }, (_, index) => {
  const id = `bulk-${String(index + 1).padStart(2, "0")}`
  return model("gamma", id, `Bulk ${String(index + 1).padStart(2, "0")}`)
})

const models = [
  model("alpha", "reasoning/one", "Reasoning One", ["low", "high"]),
  model("alpha", "reasoning/two", "Reasoning Two", ["medium"]),
  model("alpha", "basic", "Basic"),
  model("alpha", "shared", "Shared", ["low"]),
  model("beta", "other", "Other"),
  model("beta", "shared", "Shared", ["high"]),
  ...bulk,
]

const runtime: Runtime = {
  permission: { assert: () => Effect.void },
  session: { model: () => Effect.succeed(undefined) },
  agents: { list: () => Effect.succeed([]), get: () => Effect.succeed(undefined) },
  models: { list: () => Effect.succeed(models), default: () => Effect.succeed(undefined) },
  manager: {
    request: () => Effect.die(new Error("unused")),
    list: () => Effect.succeed([]),
    reply: () => Effect.void,
    reject: () => Effect.void,
    dispose: Effect.void,
  },
  start: () => Effect.void,
}

const tool = makeTools(runtime).models

function run(params: { query?: string; offset?: number; limit?: number }) {
  return Effect.runPromise(tool.execute(params, context))
}

function json<T>(value: string): T {
  return JSON.parse(value) as T
}

describe("agent_manager_models tool", () => {
  test("explains Task selection", async () => {
    const result = await run({ query: "shared" })
    expect(json<{ hint: string }>(result.output!).hint).toContain("to task or agent_manager")
  })

  test("returns models grouped by name, capped at 20", async () => {
    const result = await run({})
    const output = json<{ models: Array<{ name: string }>; total: number; nextOffset?: number }>(result.output!)

    expect(output.total).toBe(27)
    expect(output.models).toHaveLength(20)
    expect(output.nextOffset).toBe(20)
    expect(result.metadata).toMatchObject({ count: 20, total: 27 })
  })

  test("deduplicates a model offered by several providers and unions variants", async () => {
    const result = await run({ query: "shared" })
    const output = json<{ models: Array<{ name: string; providers: string[]; variants: string[] }> }>(result.output!)

    expect(output.models).toEqual([{ name: "Shared", providers: ["alpha", "beta"], variants: ["low", "high"] }])
  })

  test("searches by name with bounded pagination and variant names", async () => {
    const result = await run({ query: "reasoning", limit: 1 })
    const output = json<{
      models: Array<{ name: string; providers: string[]; variants: string[] }>
      total: number
      nextOffset?: number
    }>(result.output!)

    expect(output.total).toBe(2)
    expect(output.nextOffset).toBe(1)
    expect(output.models).toEqual([{ name: "Reasoning One", providers: ["alpha"], variants: ["low", "high"] }])
  })

  test("matches a qualified provider/model id whose model id contains slashes", async () => {
    const result = await run({ query: "alpha/reasoning/two" })
    const output = json<{ models: Array<{ name: string }>; total: number }>(result.output!)

    expect(output.total).toBe(1)
    expect(output.models[0]?.name).toBe("Reasoning Two")
  })

  test("matches leniently: order-independent, punctuation- and case-insensitive", async () => {
    const reordered = json<{ models: Array<{ name: string }>; total: number }>(
      (await run({ query: "one reasoning" })).output!,
    )
    expect(reordered.models.map((item) => item.name)).toEqual(["Reasoning One"])

    const collapsed = json<{ models: Array<{ name: string }> }>((await run({ query: "reasoningtwo" })).output!)
    expect(collapsed.models.map((item) => item.name)).toEqual(["Reasoning Two"])
  })

  test("hard-caps results at 20 even when a larger limit is requested", async () => {
    const result = await run({ query: "bulk", limit: 100 })
    const output = json<{ models: unknown[]; total: number; nextOffset?: number }>(result.output!)

    expect(output.total).toBe(22)
    expect(output.models).toHaveLength(20)
    expect(output.nextOffset).toBe(20)
  })
})