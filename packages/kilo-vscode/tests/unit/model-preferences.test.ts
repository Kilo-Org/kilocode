import { describe, expect, it } from "bun:test"
import { updateFavorites } from "../../src/kilo-provider/model-preferences"

describe("updateFavorites", () => {
  it("adds a favorite that is not present", () => {
    const current = [{ providerID: "anthropic", modelID: "claude-sonnet-4" }]

    expect(updateFavorites(current, "add", { providerID: "openai", modelID: "gpt-5" })).toEqual([
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      { providerID: "openai", modelID: "gpt-5" },
    ])
  })

  it("does not add a duplicate favorite", () => {
    const current = [{ providerID: "openai", modelID: "gpt-5" }]

    expect(updateFavorites(current, "add", { providerID: "openai", modelID: "gpt-5" })).toBe(current)
  })

  it("removes an existing favorite", () => {
    const current = [
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      { providerID: "openai", modelID: "gpt-5" },
    ]

    expect(updateFavorites(current, "remove", { providerID: "openai", modelID: "gpt-5" })).toEqual([
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
    ])
  })

  it("keeps favorites unchanged when removing a missing favorite", () => {
    const current = [{ providerID: "anthropic", modelID: "claude-sonnet-4" }]

    expect(updateFavorites(current, "remove", { providerID: "openai", modelID: "gpt-5" })).toBe(current)
  })
})
