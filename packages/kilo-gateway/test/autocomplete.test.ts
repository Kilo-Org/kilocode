import { describe, expect, test } from "bun:test"
import {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AUTOCOMPLETE_PROVIDER_ID,
} from "../src/autocomplete"

describe("DEFAULT_AUTOCOMPLETE_MODEL", () => {
  test("resolves to Mercury Next Edit through Kilo Gateway", () => {
    const match = AUTOCOMPLETE_MODELS.find(
      (m) => m.providerID === DEFAULT_AUTOCOMPLETE_PROVIDER_ID && m.modelID === DEFAULT_AUTOCOMPLETE_MODEL_ID,
    )
    expect(DEFAULT_AUTOCOMPLETE_PROVIDER_ID).toBe("kilo")
    expect(DEFAULT_AUTOCOMPLETE_MODEL_ID).toBe("inception/mercury-next-edit")
    expect(match).toBeDefined()
    expect(DEFAULT_AUTOCOMPLETE_MODEL).toBe(match!)
    expect(DEFAULT_AUTOCOMPLETE_MODEL.kind).toBe("edit")
  })
})

describe("Next Edit FIM models", () => {
  test("reference a FIM model from the same provider", () => {
    for (const model of AUTOCOMPLETE_MODELS) {
      if (model.kind !== "edit") continue
      const sibling = AUTOCOMPLETE_MODELS.find((candidate) => candidate.id === model.fimModelID)
      expect(sibling).toBeDefined()
      expect(sibling?.kind).not.toBe("edit")
      expect(sibling?.providerID).toBe(model.providerID)
    }
  })
})

describe("configured autocomplete models", () => {
  test("preserves arbitrary configured provider and model IDs", async () => {
    const { getAutocompleteModel } = await import("../src/autocomplete")
    const model = getAutocompleteModel("lmstudio", "qwen2.5-coder-1.5b")

    expect(model).toMatchObject({
      id: "lmstudio/qwen2.5-coder-1.5b",
      providerID: "lmstudio",
      modelID: "qwen2.5-coder-1.5b",
      requestModel: "qwen2.5-coder-1.5b",
      configuredProvider: true,
      temperature: 0,
      maxTokens: 64,
    })
    expect(model.directProvider).toBeUndefined()
  })
})
