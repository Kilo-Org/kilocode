import { describe, expect, test } from "bun:test"
import { resolveFimTarget } from "../src/fim"

describe("FIM target resolution", () => {
  test("keeps gateway autocomplete models on Kilo Gateway", () => {
    expect(resolveFimTarget("kilo", "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
  })

  test("routes explicit provider autocomplete models directly", () => {
    expect(resolveFimTarget("mistral", "codestral-2508")).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
  })

  test("falls back to the default Gateway model for retired direct providers", () => {
    expect(resolveFimTarget("inception", "mercury-edit-2")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
  })

  test("preserves gateway model pass-through behavior", () => {
    expect(resolveFimTarget()).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
    expect(resolveFimTarget(undefined, "mistralai/codestral-2508")).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
    expect(resolveFimTarget("kilo", "custom/fim-model")).toEqual({
      provider: "kilo",
      model: "custom/fim-model",
      url: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    })
  })
})
