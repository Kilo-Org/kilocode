import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { AgentManagerModelsTool } from "../../src/kilocode/tool/agent-manager-models"
import { Provider } from "../../src/provider/provider"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"

const bulk = Object.fromEntries(
  Array.from({ length: 22 }, (_, index) => {
    const id = `bulk-${String(index + 1).padStart(2, "0")}`
    return [id, { id, providerID: "gamma", name: `Bulk ${String(index + 1).padStart(2, "0")}` }]
  }),
)

const providers = {
  alpha: {
    id: "alpha",
    name: "Alpha Provider",
    models: {
      "reasoning/one": {
        id: "reasoning/one",
        providerID: "alpha",
        name: "Reasoning One",
        variants: { low: {}, high: {} },
      },
      "reasoning/two": { id: "reasoning/two", providerID: "alpha", name: "Reasoning Two", variants: { medium: {} } },
      basic: { id: "basic", providerID: "alpha", name: "Basic" },
      shared: { id: "shared", providerID: "alpha", name: "Shared", variants: { low: {} } },
    },
  } as unknown as Provider.Info,
  beta: {
    id: "beta",
    name: "Beta Provider",
    models: {
      other: { id: "other", providerID: "beta", name: "Other" },
      shared: { id: "shared", providerID: "beta", name: "Shared", variants: { high: {} } },
    },
  } as unknown as Provider.Info,
  gamma: {
    id: "gamma",
    name: "Gamma Provider",
    models: bulk,
  } as unknown as Provider.Info,
}

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    Truncate.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Layer.mock(Provider.Service, { list: () => Effect.succeed(providers) }),
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_agent_manager_models",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function run(params: Record<string, unknown>) {
  return runtime.runPromise(
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* AgentManagerModelsTool)
        return yield* tool.execute(params, ctx)
      }),
    ).pipe(Effect.scoped),
  )
}

function json<T>(value: string): T {
  return JSON.parse(value) as T
}

describe("agent_manager_models tool", () => {
  test("returns models grouped by name, capped at 20", async () => {
    const result = await run({})
    const output = json<{ models: Array<{ name: string }>; total: number; nextOffset?: number }>(result.output)

    // 5 named models (Basic, Other, Reasoning One/Two, Shared) + 22 bulk = 27 distinct names.
    expect(output.total).toBe(27)
    expect(output.models).toHaveLength(20)
    expect(output.nextOffset).toBe(20)
    expect(result.metadata).toMatchObject({ count: 20, total: 27 })
  })

  test("deduplicates a model offered by several providers and unions variants", async () => {
    const result = await run({ query: "shared" })
    const output = json<{ models: Array<{ name: string; providers: string[]; variants: string[] }> }>(result.output)

    expect(output.models).toEqual([{ name: "Shared", providers: ["alpha", "beta"], variants: ["low", "high"] }])
  })

  test("searches by name with bounded pagination and variant names", async () => {
    const result = await run({ query: "reasoning", limit: 1 })
    const output = json<{
      models: Array<{ name: string; providers: string[]; variants: string[] }>
      total: number
      nextOffset?: number
    }>(result.output)

    expect(output.total).toBe(2)
    expect(output.nextOffset).toBe(1)
    expect(output.models).toEqual([{ name: "Reasoning One", providers: ["alpha"], variants: ["low", "high"] }])
  })

  test("matches a qualified provider/model id whose model id contains slashes", async () => {
    const result = await run({ query: "alpha/reasoning/two" })
    const output = json<{ models: Array<{ name: string }>; total: number }>(result.output)

    expect(output.total).toBe(1)
    expect(output.models[0]?.name).toBe("Reasoning Two")
  })

  test("matches leniently: order-independent, punctuation- and case-insensitive", async () => {
    // "reasoning one" reordered, lowercased, no exact substring of the display name order.
    const reordered = json<{ models: Array<{ name: string }>; total: number }>(
      (await run({ query: "one reasoning" })).output,
    )
    expect(reordered.models.map((m) => m.name)).toEqual(["Reasoning One"])

    // Collapsed across punctuation/spacing.
    const collapsed = json<{ models: Array<{ name: string }> }>((await run({ query: "reasoningtwo" })).output)
    expect(collapsed.models.map((m) => m.name)).toEqual(["Reasoning Two"])
  })

  test("hard-caps results at 20 even when a larger limit is requested", async () => {
    const result = await run({ query: "bulk", limit: 100 })
    const output = json<{ models: unknown[]; total: number; nextOffset?: number }>(result.output)

    expect(output.total).toBe(22)
    expect(output.models).toHaveLength(20)
    expect(output.nextOffset).toBe(20)
  })
})
