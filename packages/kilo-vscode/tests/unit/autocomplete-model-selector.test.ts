import { describe, expect, it } from "vitest"
import {
  AUTOCOMPLETE_PROVIDER_ID,
  AUTOCOMPLETE_PROVIDER_NAME,
  AUTOCOMPLETE_SELECTOR_MODELS,
} from "../../webview-ui/src/components/settings/autocomplete-model-selector"
import { AUTOCOMPLETE_MODELS } from "../../src/shared/autocomplete-models"

describe("autocomplete model selector", () => {
  it("shows only Kilo Gateway autocomplete models", () => {
    expect(AUTOCOMPLETE_SELECTOR_MODELS).toEqual(
      AUTOCOMPLETE_MODELS.map((m) => ({
        id: m.id,
        name: m.label,
        providerID: AUTOCOMPLETE_PROVIDER_ID,
        providerName: AUTOCOMPLETE_PROVIDER_NAME,
      })),
    )
  })
})
