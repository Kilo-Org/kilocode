import { describe, expect, it } from "bun:test"
import { initial, options } from "../../webview-ui/agent-manager/cloud-agent/models"
import type { EnrichedModel } from "../../webview-ui/src/context/provider-utils"

function model(id: string, providerID: string): EnrichedModel {
  return { id, name: id, providerID, providerName: providerID }
}

const fallback = {
  id: "kilo-auto/free",
  name: "Kilo Auto",
  providerID: "kilo",
  providerName: "Kilo Gateway",
}

describe("Cloud Agent model options", () => {
  it("provides the enriched Kilo default when the provider catalog is empty", () => {
    expect(options([])).toEqual([fallback])
  })

  it("provides the enriched Kilo default when only other providers are available", () => {
    expect(options([model("gpt-5", "openai")])).toEqual([fallback])
  })

  it("preserves enriched Kilo models without exposing other providers", () => {
    const kilo = { ...model("anthropic/claude-sonnet-4-6", "kilo"), options: { description: "Recommended" } }
    expect(options([model("gpt-5", "openai"), kilo])).toEqual([kilo])
  })

  it("defaults to the current regular chat Kilo model", () => {
    const items = [model("kilo-auto/frontier", "kilo"), model("kilo-auto/free", "kilo")]
    expect(initial(items, { providerID: "kilo", modelID: "kilo-auto/free" })).toBe("kilo-auto/free")
  })

  it("falls back to the first Cloud Agent model when the current chat model is unavailable", () => {
    const items = [model("kilo-auto/frontier", "kilo"), model("kilo-auto/free", "kilo")]
    expect(initial(items, { providerID: "openai", modelID: "gpt-5" })).toBe("kilo-auto/frontier")
    expect(initial(items, { providerID: "kilo", modelID: "missing" })).toBe("kilo-auto/frontier")
  })
})
