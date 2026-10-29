import { describe, expect, test } from "bun:test"
import { selection, write } from "../webview-ui/src/components/settings/models-selection"

describe("settings model selection mapping", () => {
  test("reads the short string form", () => {
    expect(selection("kilo/kilo-auto/free")).toEqual({ providerID: "kilo", modelID: "kilo-auto/free" })
  })

  test("reads the short string form with a variant", () => {
    expect(selection("anthropic/claude#high")).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "high",
    })
  })

  test("reads the explicit object form", () => {
    expect(selection({ providerID: "kilo", model: "kilo-auto/free" })).toEqual({
      providerID: "kilo",
      modelID: "kilo-auto/free",
    })
    expect(selection({ providerID: "kilo", model: "x", variant: "low" })).toEqual({
      providerID: "kilo",
      modelID: "x",
      variant: "low",
    })
  })

  test("reads malformed values as unset", () => {
    expect(selection(undefined)).toBeUndefined()
    expect(selection(null)).toBeUndefined()
    expect(selection("no-slash")).toBeUndefined()
    expect(selection("/model")).toBeUndefined()
    expect(selection("provider/")).toBeUndefined()
    expect(selection("provider/#high")).toBeUndefined()
    expect(selection({ model: "x" })).toBeUndefined()
  })

  test("writes the explicit object form and omits an empty variant", () => {
    expect(write({ providerID: "kilo", modelID: "gpt" })).toEqual({ providerID: "kilo", model: "gpt" })
    expect(write({ providerID: "kilo", modelID: "gpt", variant: "high" })).toEqual({
      providerID: "kilo",
      model: "gpt",
      variant: "high",
    })
    expect(write(undefined)).toBeUndefined()
  })

  test("round trips a value", () => {
    const value = { providerID: "anthropic", modelID: "claude", variant: "max" }
    expect(selection(write(value))).toEqual(value)
  })
})
