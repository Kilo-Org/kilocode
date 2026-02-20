import { describe, it, expect } from "bun:test"
import { flattenModels, findModel } from "../../webview-ui/src/context/provider-utils"
import type { Provider } from "../../webview-ui/src/types/messages"

function makeProvider(id: string, name: string, modelIds: string[]): Provider {
  const models: Provider["models"] = {}
  for (const mid of modelIds) {
    models[mid] = { id: mid, name: mid.toUpperCase() }
  }
  return { id, name, models }
}

describe("flattenModels", () => {
  it("returns empty array for empty providers", () => {
    expect(flattenModels({})).toEqual([])
  })

  it("enriches each model with providerID and providerName", () => {
    const providers = { openai: makeProvider("openai", "OpenAI", ["gpt-4"]) }
    const models = flattenModels(providers)
    expect(models).toHaveLength(1)
    expect(models[0]!.providerID).toBe("openai")
    expect(models[0]!.providerName).toBe("OpenAI")
    expect(models[0]!.id).toBe("gpt-4")
  })

  it("flattens multiple providers", () => {
    const providers = {
      openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
      anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
    }
    const models = flattenModels(providers)
    expect(models).toHaveLength(3)
    const ids = models.map((m) => m.id)
    expect(ids).toContain("gpt-4")
    expect(ids).toContain("gpt-3.5")
    expect(ids).toContain("claude-3")
  })

  it("handles provider with no models", () => {
    const providers = { empty: makeProvider("empty", "Empty", []) }
    expect(flattenModels(providers)).toEqual([])
  })
})

describe("findModel", () => {
  const providers = {
    openai: makeProvider("openai", "OpenAI", ["gpt-4", "gpt-3.5"]),
    anthropic: makeProvider("anthropic", "Anthropic", ["claude-3"]),
  }
  const models = flattenModels(providers)

  it("returns undefined for null selection", () => {
    expect(findModel(models, null)).toBeUndefined()
  })

  it("finds model by providerID and modelID", () => {
    const result = findModel(models, { providerID: "openai", modelID: "gpt-4" })
    expect(result).not.toBeUndefined()
    expect(result?.id).toBe("gpt-4")
    expect(result?.providerID).toBe("openai")
  })

  it("returns undefined when providerID does not match", () => {
    expect(findModel(models, { providerID: "unknown", modelID: "gpt-4" })).toBeUndefined()
  })

  it("returns undefined when modelID does not match", () => {
    expect(findModel(models, { providerID: "openai", modelID: "unknown-model" })).toBeUndefined()
  })

  it("finds model from second provider", () => {
    const result = findModel(models, { providerID: "anthropic", modelID: "claude-3" })
    expect(result?.providerName).toBe("Anthropic")
  })

  it("returns undefined for empty model list", () => {
    expect(findModel([], { providerID: "openai", modelID: "gpt-4" })).toBeUndefined()
  })
})
