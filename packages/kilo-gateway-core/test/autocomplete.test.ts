import { describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

describe("KiloAutocomplete models", () => {
  test("defaults to Codestral through the Kilo Gateway", () => {
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_PROVIDER_ID).toBe("kilo")
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL_ID).toBe("mistralai/codestral-2508")
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL).toBe(
      KiloAutocomplete.AUTOCOMPLETE_MODELS.find(
        (model) =>
          model.providerID === KiloAutocomplete.DEFAULT_AUTOCOMPLETE_PROVIDER_ID &&
          model.modelID === KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL_ID,
      )!,
    )
  })

  test("falls back to the default model for unknown and retired models", () => {
    expect(KiloAutocomplete.getAutocompleteModel("kilo", "unknown/model")).toBe(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL)
    expect(KiloAutocomplete.getAutocompleteModel("kilo", "inception/mercury-next-edit")).toBe(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL)
    expect(KiloAutocomplete.getAutocompleteModel("inception", "mercury-edit-2")).toBe(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL)
  })

  test("looks models up by ID and validates stored provider and model settings", () => {
    expect(KiloAutocomplete.getAutocompleteModelById("mistral/codestral-2508").providerID).toBe("mistral")
    expect(KiloAutocomplete.getAutocompleteModelById("missing")).toBe(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL)
    expect(["kilo", "mistral"].every(KiloAutocomplete.validAutocompleteProvider)).toBe(true)
    expect(KiloAutocomplete.validAutocompleteProvider("inception")).toBe(false)
    expect(KiloAutocomplete.validAutocompleteModel("mistralai/codestral-2508")).toBe(true)
    expect(KiloAutocomplete.validAutocompleteModel("codestral-2508")).toBe(true)
    expect(KiloAutocomplete.validAutocompleteModel("mercury-next-edit")).toBe(false)
    expect(KiloAutocomplete.validAutocompleteModel("gpt-5")).toBe(false)
    expect(KiloAutocomplete.validAutocompleteModel(1)).toBe(false)
  })
})
