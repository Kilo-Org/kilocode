import { describe, expect, test } from "bun:test"
import {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_AUTOCOMPLETE_PROVIDER_ID,
  getAutocompleteModel,
  validAutocompleteModel,
  validAutocompleteProvider,
} from "../src/autocomplete"

describe("DEFAULT_AUTOCOMPLETE_MODEL", () => {
  test("resolves to Codestral through Kilo Gateway", () => {
    const match = AUTOCOMPLETE_MODELS.find(
      (m) => m.providerID === DEFAULT_AUTOCOMPLETE_PROVIDER_ID && m.modelID === DEFAULT_AUTOCOMPLETE_MODEL_ID,
    )
    expect(DEFAULT_AUTOCOMPLETE_PROVIDER_ID).toBe("kilo")
    expect(DEFAULT_AUTOCOMPLETE_MODEL_ID).toBe("mistralai/codestral-2508")
    expect(match).toBeDefined()
    expect(DEFAULT_AUTOCOMPLETE_MODEL).toBe(match!)
  })
})

describe("retired autocomplete models", () => {
  test("fall back to the default model", () => {
    expect(getAutocompleteModel("kilo", "inception/mercury-next-edit")).toBe(DEFAULT_AUTOCOMPLETE_MODEL)
    expect(getAutocompleteModel("inception", "mercury-edit-2")).toBe(DEFAULT_AUTOCOMPLETE_MODEL)
  })

  test("are not valid provider or model values", () => {
    expect(validAutocompleteProvider("inception")).toBe(false)
    expect(validAutocompleteModel("mercury-next-edit")).toBe(false)
  })
})
