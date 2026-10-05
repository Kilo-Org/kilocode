import { describe, expect, it } from "bun:test"
import { detectMarketplaceRelevance, filenamePatterns, matchesPattern } from "../../src/services/marketplace/relevance"
import type { MarketplaceItem } from "../../src/services/marketplace/types"

const items: MarketplaceItem[] = [
  {
    type: "agent",
    id: "angular",
    name: "Angular",
    description: "Angular specialist",
    category: "development",
    content: { mode: "all", description: "Angular specialist", prompt: "Help with Angular" },
    suggest_for: { filename: ["*.component.ts"] },
  },
  {
    type: "mcp",
    id: "jupyter",
    name: "Jupyter",
    description: "Jupyter notebooks",
    category: "data",
    url: "https://example.com",
    content: "{}",
    suggest_for: {
      filename: ["*.component.ts", "*.ipynb"],
      vscode_extension: ["ms-toolsai.jupyter"],
    },
  },
  {
    type: "skill",
    id: "unmatched",
    name: "Unmatched",
    displayName: "Unmatched",
    description: "No matching context",
    category: "development",
    displayCategory: "Development",
    githubUrl: "https://example.com",
    content: "https://example.com/skill.tar.gz",
    suggest_for: { filename: ["*.rs"] },
  },
]

describe("Marketplace relevance", () => {
  it("combines backend filename matches with installed extensions", () => {
    const relevance = detectMarketplaceRelevance(items, ["*.component.ts"], ["MS-ToolsAI.Jupyter"])

    expect(relevance).toEqual({
      "agent:angular": { filename: ["*.component.ts"] },
      "mcp:jupyter": {
        filename: ["*.component.ts"],
        vscodeExtension: ["ms-toolsai.jupyter"],
      },
    })
  })

  it("ignores malformed suggestion metadata", () => {
    const malformed = {
      ...items[0],
      suggest_for: { filename: "*.component.ts", vscode_extension: [42] },
    } as unknown as MarketplaceItem

    expect(detectMarketplaceRelevance([malformed], ["*.component.ts"], ["test.extension"])).toEqual({})
  })

  it("matches created paths against filename patterns", () => {
    expect(filenamePatterns(items)).toEqual(["*.component.ts", "*.ipynb", "*.rs"])
    expect(matchesPattern("notebooks/analysis.ipynb", "*.ipynb")).toBe(true)
    expect(matchesPattern("src\\app\\app.component.ts", "*.component.ts")).toBe(true)
    expect(matchesPattern("src/main.ts", "*.component.ts")).toBe(false)
  })
})
