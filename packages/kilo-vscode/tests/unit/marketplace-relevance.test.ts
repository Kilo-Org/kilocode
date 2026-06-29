import { describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import { detectMarketplaceRelevance } from "../../src/services/marketplace/relevance"
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
  it("matches workspace files and installed extensions with deduplicated bounded searches", async () => {
    const root = vscode.Uri.file("/repo")
    const find = mock(async (_root: vscode.Uri, pattern: string) => pattern === "*.component.ts")

    const relevance = await detectMarketplaceRelevance(items, [root], {
      extensions: ["MS-ToolsAI.Jupyter"],
      find,
    })

    expect(relevance).toEqual({
      "agent:angular": { filename: ["*.component.ts"] },
      "mcp:jupyter": {
        filename: ["*.component.ts"],
        vscodeExtension: ["ms-toolsai.jupyter"],
      },
    })
    expect(find).toHaveBeenCalledTimes(3)
    expect(find.mock.calls).toContainEqual([root, "*.component.ts"])
    expect(find.mock.calls).toContainEqual([root, "*.ipynb"])
    expect(find.mock.calls).toContainEqual([root, "*.rs"])
  })

  it("searches every workspace root and preserves remote URIs", async () => {
    const local = vscode.Uri.file("/repo")
    const remote = vscode.Uri.parse("vscode-remote://ssh-remote+host/workspace")
    const find = mock(async (root: vscode.Uri, pattern: string) => root === remote && pattern === "*.ipynb")

    const relevance = await detectMarketplaceRelevance(items, [local, remote], { extensions: [], find })

    expect(relevance).toEqual({ "mcp:jupyter": { filename: ["*.ipynb"] } })
    expect(find.mock.calls).toContainEqual([remote, "*.ipynb"])
  })

  it("ignores malformed suggestion metadata", async () => {
    const malformed = {
      ...items[0],
      suggest_for: { filename: "*.component.ts", vscode_extension: [42] },
    } as unknown as MarketplaceItem
    const find = mock(async () => true)

    const relevance = await detectMarketplaceRelevance([malformed], [vscode.Uri.file("/repo")], {
      extensions: ["test.extension"],
      find,
    })

    expect(relevance).toEqual({})
    expect(find).not.toHaveBeenCalled()
  })

  it("still matches installed extensions without a workspace", async () => {
    const find = mock(async () => true)

    const relevance = await detectMarketplaceRelevance(items, [], {
      extensions: ["ms-toolsai.jupyter"],
      find,
    })

    expect(relevance).toEqual({ "mcp:jupyter": { vscodeExtension: ["ms-toolsai.jupyter"] } })
    expect(find).not.toHaveBeenCalled()
  })
})
