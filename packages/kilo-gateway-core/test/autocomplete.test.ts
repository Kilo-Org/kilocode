import { describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

describe("KiloAutocomplete models", () => {
  test("defaults to Mercury Next Edit through the Kilo Gateway", () => {
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_PROVIDER_ID).toBe("kilo")
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL_ID).toBe("inception/mercury-next-edit")
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL).toBe(
      KiloAutocomplete.AUTOCOMPLETE_MODELS.find(
        (model) =>
          model.providerID === KiloAutocomplete.DEFAULT_AUTOCOMPLETE_PROVIDER_ID &&
          model.modelID === KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL_ID,
      )!,
    )
    expect(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL.kind).toBe("edit")
  })

  test("Next Edit models reference a FIM model of the same provider", () => {
    const edits = KiloAutocomplete.AUTOCOMPLETE_MODELS.filter((model) => model.kind === "edit")
    expect(edits.length).toBeGreaterThan(0)
    for (const model of edits) {
      const sibling = KiloAutocomplete.AUTOCOMPLETE_MODELS.find((candidate) => candidate.id === model.fimModelID)
      expect(sibling?.kind).not.toBe("edit")
      expect(sibling?.providerID).toBe(model.providerID)
    }
  })

  test("resolves the legacy Mercury alias and falls back to the default model", () => {
    expect(KiloAutocomplete.getAutocompleteModel("kilo", "inception/mercury-edit").id).toBe("kilo/inception/mercury-edit-2")
    expect(KiloAutocomplete.getAutocompleteModel("kilo", "unknown/model")).toBe(KiloAutocomplete.DEFAULT_AUTOCOMPLETE_MODEL)
  })
})
