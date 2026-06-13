import { describe, expect, test } from "bun:test"
import { FormatError } from "@/cli/error"

describe("model not found errors", () => {
  test("indicates when no models are available", () => {
    const data = {
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      modelsEmpty: true,
    }

    expect(FormatError({ name: "ProviderModelNotFoundError", data })).toContain(
      "No models are currently available.",
    )
    expect(FormatError({ _tag: "ProviderModelNotFoundError", ...data })).toContain(
      "No models are currently available.",
    )
  })

  test("omits the indication when models are available", () => {
    const error = FormatError({
      _tag: "ProviderModelNotFoundError",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      modelsEmpty: false,
    })

    expect(error).not.toContain("No models are currently available.")
  })
})
