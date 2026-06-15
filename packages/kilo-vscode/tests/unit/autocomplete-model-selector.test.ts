import { describe, expect, it } from "vitest"
import { AUTOCOMPLETE_SELECTOR_MODELS } from "../../webview-ui/src/components/settings/autocomplete-model-selector"
import { AUTOCOMPLETE_MODELS } from "../../src/shared/autocomplete-models"

describe("autocomplete model selector", () => {
  it("shows autocomplete models grouped by their configured provider", () => {
    expect(AUTOCOMPLETE_SELECTOR_MODELS).toEqual(
      AUTOCOMPLETE_MODELS.map((m) => ({
        id: m.modelID,
        name: m.label,
        providerID: m.providerID,
        providerName: m.provider,
      })),
    )
  })
})
