import { describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

// A custom server keeps the expected URLs independent of KILO_API_URL and KILO_AI_GATEWAY_URL.
const server = "https://kilo.example.test"
const gateway = "https://kilo.example.test/api/gateway/fim/completions"

describe("FIM target", () => {
  test("keeps Gateway autocomplete models on the Kilo Gateway", () => {
    expect(KiloAutocomplete.resolveFimTarget("kilo", "mistralai/codestral-2508", server)).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2508",
      url: gateway,
    })
    expect(KiloAutocomplete.resolveFimTarget("kilo", "inception/mercury-edit-2", server)).toEqual({
      provider: "kilo",
      model: "inception/mercury-edit-2",
      url: gateway,
    })
  })

  test("routes explicit provider models directly to the provider", () => {
    expect(KiloAutocomplete.resolveFimTarget("mistral", "codestral-2508", server)).toEqual({
      provider: "mistral",
      model: "codestral-2508",
    })
    expect(KiloAutocomplete.resolveFimTarget("inception", "mercury-edit-2", server)).toEqual({
      provider: "inception",
      model: "mercury-edit-2",
      url: "https://api.inceptionlabs.ai/v1/fim/completions",
    })
  })

  test("passes Gateway model IDs through and defaults to Codestral 2501", () => {
    expect(KiloAutocomplete.resolveFimTarget(undefined, undefined, server)).toEqual({
      provider: "kilo",
      model: "mistralai/codestral-2501",
      url: gateway,
    })
    for (const model of ["mistralai/codestral-2508", "inception/mercury-edit", "custom/fim-model"]) {
      expect(KiloAutocomplete.resolveFimTarget(undefined, model, server)).toEqual({ provider: "kilo", model, url: gateway })
      expect(KiloAutocomplete.resolveFimTarget("kilo", model, server)).toEqual({ provider: "kilo", model, url: gateway })
    }
  })
})
