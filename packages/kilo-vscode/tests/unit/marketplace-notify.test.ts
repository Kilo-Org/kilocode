import { describe, expect, it } from "bun:test"
import { selectSuggestions, suggestionSlug } from "../../src/services/marketplace/notify"
import type { MarketplaceItem, MarketplaceRelevanceMetadata } from "../../src/services/marketplace/types"

const agent: MarketplaceItem = {
  type: "agent",
  id: "angular",
  name: "Angular",
  description: "Angular specialist",
  category: "development",
  content: { mode: "all", description: "Angular specialist", prompt: "Help with Angular" },
  suggest_for: { filename: ["*.component.ts"] },
}

const mcp: MarketplaceItem = {
  type: "mcp",
  id: "jupyter",
  name: "Jupyter",
  description: "Jupyter notebooks",
  category: "data",
  url: "https://example.com",
  content: "{}",
  suggest_for: { vscode_extension: ["ms-toolsai.jupyter"] },
}

const items = [agent, mcp]

describe("Marketplace suggestion notification", () => {
  it("derives a stable discardable slug from type and id", () => {
    expect(suggestionSlug(agent)).toBe("agent:angular")
    expect(suggestionSlug(mcp)).toBe("mcp:jupyter")
  })

  it("selects only relevant, non-dismissed items", () => {
    const relevance: MarketplaceRelevanceMetadata = {
      "agent:angular": { filename: ["*.component.ts"] },
      "mcp:jupyter": { vscodeExtension: ["ms-toolsai.jupyter"] },
    }

    expect(selectSuggestions(items, relevance, [])).toEqual([agent, mcp])
    expect(selectSuggestions(items, relevance, ["agent:angular"])).toEqual([mcp])
    expect(selectSuggestions(items, relevance, ["agent:angular", "mcp:jupyter"])).toEqual([])
  })

  it("ignores items without a relevance match", () => {
    const relevance: MarketplaceRelevanceMetadata = { "mcp:jupyter": { vscodeExtension: ["ms-toolsai.jupyter"] } }
    expect(selectSuggestions(items, relevance, [])).toEqual([mcp])
  })
})
