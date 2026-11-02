import { describe, expect, test } from "bun:test"
import {
  parseCommandModel,
  serializeCommandModel,
} from "../webview-ui/src/components/settings/agent-behaviour/command-model"

describe("parseCommandModel", () => {
  test("reads the short string form", () => {
    expect(parseCommandModel("openai/gpt-5")).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("reads the variant suffix", () => {
    expect(parseCommandModel("openai/gpt-5#high")).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" })
  })

  test("reads the explicit object form", () => {
    expect(parseCommandModel({ providerID: "openai", model: "gpt-5", variant: "low" })).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "low",
    })
  })

  test("rejects values without a provider or model", () => {
    expect(parseCommandModel("gpt-5")).toBeUndefined()
    expect(parseCommandModel({ model: "gpt-5" })).toBeUndefined()
    expect(parseCommandModel(undefined)).toBeUndefined()
  })
})

test("serializeCommandModel keeps the variant when present", () => {
  expect(serializeCommandModel({ providerID: "openai", modelID: "gpt-5" })).toBe("openai/gpt-5")
  expect(serializeCommandModel({ providerID: "openai", modelID: "gpt-5", variant: "high" })).toBe("openai/gpt-5#high")
})
