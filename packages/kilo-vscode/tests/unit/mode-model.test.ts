import { describe, expect, it } from "bun:test"

import { modelPatch } from "../../webview-ui/src/components/settings/mode-model"

describe("modelPatch", () => {
  it("clears model and variant together", () => {
    expect(modelPatch("", "", [], "high")).toEqual({ model: null, variant: null })
  })

  it("keeps current variant when next model supports it", () => {
    expect(modelPatch("kilo", "anthropic/claude-sonnet-4-6", ["low", "high"], "high")).toEqual({
      model: "kilo/anthropic/claude-sonnet-4-6",
    })
  })

  it("clears stale variant when next model does not support it", () => {
    expect(modelPatch("kilo", "anthropic/claude-sonnet-4-6", ["low", "medium"], "high")).toEqual({
      model: "kilo/anthropic/claude-sonnet-4-6",
      variant: null,
    })
  })
})
