import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Agent.defaultLayer, ToolRegistry.defaultLayer, node))

afterEach(async () => {
  await disposeAllInstances()
})

describe("apply_patch model selection", () => {
  test("recognizes supported GPT families", () => {
    const cases = [
      { modelID: "routed-model", family: "gpt", expected: true },
      { modelID: "routed-model", family: "gpt-codex", expected: true },
      { modelID: "routed-model", family: "gpt-mini", expected: true },
      { modelID: "routed-model", family: "gpt-oss", expected: false },
      { modelID: "routed-model", family: "gpt-image", expected: false },
      { modelID: "routed-model", family: "claude", expected: false },
      { modelID: "gpt-4.1", family: undefined, expected: false },
      { modelID: "gpt-5.3-codex", family: undefined, expected: true },
      { modelID: "gpt-image-1", family: "gpt-image", expected: false },
      { modelID: "gpt-5-alias", family: "gpt-oss", expected: false },
    ]

    for (const item of cases) {
      expect(KiloToolRegistry.usePatch(item)).toBe(item.expected)
    }
  })

  it.live("uses family metadata when filtering editing tools", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const agent = yield* agents.get("build")
          const registry = yield* ToolRegistry.Service
          const tools = yield* registry.tools({
            providerID: ProviderID.make("kilo"),
            modelID: ModelID.make("routed-model"),
            family: "gpt-codex",
            agent,
          })
          const ids = tools.map((tool) => tool.id)

          expect(ids).toContain("apply_patch")
          expect(ids).not.toContain("edit")
        }),
      { git: true },
    ),
  )
})
