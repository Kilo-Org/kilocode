import { describe, expect, test } from "bun:test"
import type { Model, Provider } from "@opencode-ai/core/models-dev"
import { overlay, TOKENHUB_PROVIDER_ID, TOKENPLAN_PROVIDER_ID } from "@/kilocode/tencent/provider"

const HY3 = "hy3"
const HY3_PREVIEW = "hy3-preview"

function preview(): Model {
  return {
    id: HY3_PREVIEW,
    name: "Hy3 Preview",
    family: "Hy",
    release_date: "2025-01-01",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost: { input: 1, output: 2 },
    limit: { context: 256_000, output: 64_000 },
    modalities: { input: ["text"], output: ["text"] },
  }
}

function tokenHub(models: Record<string, Model>): Provider {
  return {
    id: TOKENHUB_PROVIDER_ID,
    name: "Tencent TokenHub",
    env: ["TENCENT_TOKENHUB_API_KEY"],
    api: "https://tokenhub.tencentmaas.com/v1",
    npm: "@ai-sdk/openai-compatible",
    models,
  }
}

describe("tencent overlay", () => {
  test("adds hy3 to TokenHub without dropping hy3-preview", () => {
    const result = overlay({ [TOKENHUB_PROVIDER_ID]: tokenHub({ [HY3_PREVIEW]: preview() }) })
    const models = result[TOKENHUB_PROVIDER_ID].models
    expect(Object.keys(models).sort()).toEqual([HY3, HY3_PREVIEW])
    expect(models[HY3_PREVIEW]).toEqual(preview())
  })

  test("derives hy3 from hy3-preview so capabilities and limits stay aligned", () => {
    const result = overlay({ [TOKENHUB_PROVIDER_ID]: tokenHub({ [HY3_PREVIEW]: preview() }) })
    const hy3 = result[TOKENHUB_PROVIDER_ID].models[HY3]
    expect(hy3).toEqual({ ...preview(), id: HY3, name: "Hy3" })
  })

  test("creates a TokenPlan provider that exposes only hy3", () => {
    const result = overlay({ [TOKENHUB_PROVIDER_ID]: tokenHub({ [HY3_PREVIEW]: preview() }) })
    const plan = result[TOKENPLAN_PROVIDER_ID]
    expect(plan.name).toBe("Tencent Token Plan")
    expect(plan.env).toEqual(["TENCENT_TOKENPLAN_API_KEY"])
    expect(plan.api).toBe("https://api.lkeap.cloud.tencent.com/plan/v3")
    expect(plan.npm).toBe("@ai-sdk/openai-compatible")
    expect(Object.keys(plan.models)).toEqual([HY3])
    expect(plan.models[HY3]).toEqual({ ...preview(), id: HY3, name: "Hy3" })
  })

  test("falls back to a synthetic hy3 when the catalog has no hy3-preview", () => {
    const result = overlay({})
    const hub = result[TOKENHUB_PROVIDER_ID]
    expect(hub.models[HY3].id).toBe(HY3)
    expect(hub.models[HY3].reasoning).toBe(true)
    expect(hub.models[HY3].limit).toEqual({ context: 256_000, output: 64_000 })
    expect(result[TOKENPLAN_PROVIDER_ID].models[HY3]).toEqual(hub.models[HY3])
  })

  test("preserves unrelated providers in the catalog", () => {
    const other = { id: "openai", name: "OpenAI", env: [], models: {} } satisfies Provider
    const result = overlay({ openai: other })
    expect(result.openai).toBe(other)
  })
})
