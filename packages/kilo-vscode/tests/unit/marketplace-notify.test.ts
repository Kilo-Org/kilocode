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

const plugin: MarketplaceItem = {
  type: "plugin",
  id: "@acme/deploy",
  name: "Deploy Toolkit",
  description: "Deployment helpers",
  category: "devops",
  content: "@acme/deploy",
  url: "https://example.com/deploy",
  suggest_for: { filename: ["deploy.yml"] },
}

const items = [agent, mcp, plugin]

describe("Marketplace suggestion notification", () => {
  it("derives a stable discardable slug from type and id", () => {
    expect(suggestionSlug(agent)).toBe("agent:angular")
    expect(suggestionSlug(mcp)).toBe("mcp:jupyter")
    expect(suggestionSlug(plugin)).toBe("plugin:@acme/deploy")
  })

  it("selects only relevant, non-dismissed items", () => {
    const relevance: MarketplaceRelevanceMetadata = {
      "agent:angular": { filename: ["*.component.ts"] },
      "mcp:jupyter": { vscodeExtension: ["ms-toolsai.jupyter"] },
      "plugin:@acme/deploy": { filename: ["deploy.yml"] },
    }

    expect(selectSuggestions(items, relevance, [])).toEqual([agent, mcp, plugin])
    expect(selectSuggestions(items, relevance, ["agent:angular"])).toEqual([mcp, plugin])
    expect(selectSuggestions(items, relevance, ["agent:angular", "mcp:jupyter", "plugin:@acme/deploy"])).toEqual([])
  })

  it("ignores items without a relevance match", () => {
    const relevance: MarketplaceRelevanceMetadata = { "mcp:jupyter": { vscodeExtension: ["ms-toolsai.jupyter"] } }
    expect(selectSuggestions(items, relevance, [])).toEqual([mcp])
  })
})
