import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import * as ToolJsonSchema from "../../src/tool/json-schema"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const node = AppNodeBuilder.build(CrossSpawnSpawner.node)
const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(Agent.node), AppNodeBuilder.build(ToolRegistry.node), node))

afterEach(async () => {
  await disposeAllInstances()
})

// Anthropic routes (direct, Bedrock, and Vertex) reject any tool whose input_schema
// omits `type` or uses a top-level anyOf/oneOf/allOf, with
// `tools.<n>.custom.input_schema.type: Field required`. That error fails the whole
// request, so one bad tool schema breaks every message for every Claude model, not
// just calls to that tool. Tools are sorted by ID before the provider call, so an
// early-sorting tool such as `agent_manager` lands on `tools.0`.
//
// This invariant deliberately lives outside any single tool's test file and covers
// every advertised tool at once. The same break shipped twice from a per-tool
// assertion being rewritten alongside the schema it was meant to protect.
describe("advertised tool schemas stay provider-compatible", () => {
  it.live("expose an object root without top-level combinators", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const prev = process.env["KILO_CLIENT"]
          // vscode advertises the widest tool set, including the Agent Manager tools.
          process.env["KILO_CLIENT"] = "vscode"

          try {
            const registry = yield* ToolRegistry.Service
            const tools = yield* registry.all()
            expect(tools.length).toBeGreaterThan(0)

            const ids = tools.map((tool) => tool.id)
            expect(ids).toContain("agent_manager")

            const bad = tools.flatMap((tool) => {
              const schema = ToolJsonSchema.fromTool(tool)
              const combinator = (["anyOf", "oneOf", "allOf"] as const).find((key) => schema[key] !== undefined)
              if (schema.type !== "object") return [`${tool.id}: input_schema.type is ${String(schema.type)}`]
              if (combinator) return [`${tool.id}: input_schema has top-level ${combinator}`]
              return []
            })

            expect(bad).toEqual([])
          } finally {
            if (prev === undefined) delete process.env["KILO_CLIENT"]
            else process.env["KILO_CLIENT"] = prev
          }
        }),
      { git: true },
    ),
  )
})
