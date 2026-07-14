import { describe, expect, it } from "vitest"
import { getAutocompleteSelection } from "../../webview-ui/src/components/settings/autocomplete-model-selector"

describe("autocomplete model selector", () => {
  it("preserves a model from the normal connected-provider list", () => {
    expect(getAutocompleteSelection("lmstudio", "qwen2.5-coder-1.5b")).toEqual({
      providerID: "lmstudio",
      modelID: "qwen2.5-coder-1.5b",
    })
  })

  it("renders the clear state when neither setting is configured", () => {
    expect(getAutocompleteSelection()).toBeNull()
  })
})
