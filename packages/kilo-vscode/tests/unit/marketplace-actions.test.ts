import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import {
  removeMarketplaceItem,
  removeMarketplaceItemFromAllScopes,
  type MarketplaceActionContext,
  type MarketplaceRemoveContext,
} from "../../src/services/marketplace/actions"
import type { McpMarketplaceItem } from "../../src/services/marketplace/types"
import {
  filterItems,
  hasRelevantItems,
  installedScopes,
  retain,
} from "../../webview-ui/src/components/marketplace/utils"
import type { MarketplaceItem } from "../../webview-ui/src/types/marketplace"

const project = "/repo"
const storage = vscode.Uri.file("/storage")
const local = `${project}/.kilo/mcp.json`
const legacy = `${project}/.kilocode/mcp.json`
const global = `${storage.fsPath}/settings/mcp_settings.json`
const item: McpMarketplaceItem = {
  id: "memory",
  type: "mcp",
  name: "Memory",
  description: "",
  category: "development",
  url: "",
  content: "",
}
const agent = {
  id: "reviewer",
  type: "agent" as const,
  name: "Code Reviewer",
  description: "",
  category: "development",
  content: { mode: "all" as const, description: "Reviews code", prompt: "Review code" },
}
const fs = vscode.workspace.fs as unknown as {
  readFile: (uri: vscode.Uri) => Promise<Uint8Array>
  writeFile: (uri: vscode.Uri, data: Uint8Array) => Promise<void>
}
const original = { readFile: fs.readFile, writeFile: fs.writeFile }

function setup() {
  const files = new Map([
    [local, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
    [legacy, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
    [global, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
  ])
  fs.readFile = async (uri) => {
    const body = files.get(uri.fsPath)
    if (!body) throw new Error("missing file")
    return Buffer.from(body)
  }
  fs.writeFile = async (uri, data) => {
    files.set(uri.fsPath, Buffer.from(data).toString("utf8"))
  }
  return files
}

function has(files: Map<string, string>, file: string) {
  return !!JSON.parse(files.get(file)!).mcpServers.memory
}

function connection() {
  return {
    getClientAsync: mock(async () => ({
      global: { config: { update: mock(async () => {}) } },
      instance: { dispose: mock(async () => {}) },
    })),
  } as unknown as MarketplaceActionContext["connection"]
}

afterEach(() => {
  fs.readFile = original.readFile
  fs.writeFile = original.writeFile
})

describe("Marketplace installation metadata", () => {
  it("tracks colliding IDs independently by item type", () => {
    const metadata = {
      project: {
        "mcp:dbt": { type: "mcp" },
        "skill:dbt": { type: "skill" },
      },
      global: {},
    }

    expect(installedScopes("dbt", "mcp", metadata)).toEqual(["project"])
    expect(installedScopes("dbt", "skill", metadata)).toEqual(["project"])
    expect(installedScopes("dbt", "agent", metadata)).toEqual([])
  })

  it("removes filters that are no longer available", () => {
    expect(retain(["agent", "mcp"], ["mcp", "skill"])).toEqual(["mcp"])
  })

  it("filters the mixed list by search, category, and status", () => {
    const items: MarketplaceItem[] = [
      {
        type: "agent",
        id: "reviewer",
        name: "Code Reviewer",
        description: "Reviews code",
        category: "development",
        content: { mode: "all", description: "Reviews code", prompt: "Review" },
      },
      {
        type: "mcp",
        id: "warehouse",
        name: "Warehouse",
        description: "Queries data",
        category: "web-automation",
        url: "https://example.com",
        content: "{}",
      },
      {
        type: "skill",
        id: "campaign-writer",
        name: "Campaign Writer",
        displayName: "Campaign Writer",
        description: "Writes campaigns",
        category: "business",
        displayCategory: "Business",
        githubUrl: "https://example.com",
        content: "https://example.com/skill.tar.gz",
      },
    ]
    const metadata = { project: { "mcp:warehouse": { type: "mcp" } }, global: {} }

    expect(filterItems(items, metadata, "reviewer", "all", [], []).map((item) => item.id)).toEqual(["reviewer"])
    expect(filterItems(items, metadata, "web automation", "all", [], []).map((item) => item.id)).toEqual(["warehouse"])
    expect(
      filterItems(items, metadata, "servidor mcp", "all", [], [], { mcp: "Servidor MCP" }).map((item) => item.id),
    ).toEqual(["warehouse"])
    expect(filterItems(items, metadata, "", "all", ["business"], []).map((item) => item.id)).toEqual([
      "campaign-writer",
    ])
    expect(filterItems(items, metadata, "", "installed", [], []).map((item) => item.id)).toEqual(["warehouse"])
    expect(filterItems(items, metadata, "", "all", [], ["mcp"]).map((item) => item.id)).toEqual(["warehouse"])
    expect(
      filterItems(items, metadata, "", "all", [], [], {}, true, {
        "agent:reviewer": { filename: ["*.review.ts"] },
        "mcp:warehouse": { vscodeExtension: ["data.warehouse"] },
      }).map((item) => item.id),
    ).toEqual(["reviewer", "warehouse"])
    const relevance = { "agent:reviewer": { filename: ["*.review.ts"] } }
    expect(filterItems(items, metadata, "warehouse", "all", [], [], {}, true, relevance)).toEqual([])
    expect(hasRelevantItems(items, relevance)).toBe(true)
    expect(hasRelevantItems(items, {})).toBe(false)
  })
})

describe("Marketplace legacy MCP cleanup", () => {
  it("preserves global legacy config during project removal", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      marketplace: { remove: mock(async () => ({ success: true, slug: item.id })) },
      storage,
    } as unknown as MarketplaceActionContext

    await removeMarketplaceItem(ctx, item, "project", project, project)

    expect(has(files, local)).toBe(false)
    expect(has(files, legacy)).toBe(false)
    expect(has(files, global)).toBe(true)
  })

  it("preserves project legacy config during global removal", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      marketplace: { remove: mock(async () => ({ success: true, slug: item.id })) },
      storage,
    } as unknown as MarketplaceActionContext

    await removeMarketplaceItem(ctx, item, "global", project, project)

    expect(has(files, local)).toBe(true)
    expect(has(files, legacy)).toBe(true)
    expect(has(files, global)).toBe(false)
  })

  it("removes project and global legacy config during sidebar cleanup", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      remove: mock(async () => ({ success: true, slug: item.id })),
      storage,
    } as MarketplaceRemoveContext

    await removeMarketplaceItemFromAllScopes(ctx, item, project, project)

    expect(has(files, local)).toBe(false)
    expect(has(files, legacy)).toBe(false)
    expect(has(files, global)).toBe(false)
  })
})

describe("Marketplace agent removal", () => {
  it("uses the authoritative CLI removal and invalidates the resolved directory", async () => {
    const remove = mock(async () => ({ data: true }))
    const dispose = mock(async () => ({}))
    const getClientAsync = mock(async () => ({
      kilocode: { removeAgent: remove },
      global: { config: { update: mock(async () => ({})) } },
      instance: { dispose },
    }))
    const marketplace = { remove: mock(async () => ({ success: true, slug: agent.id })) }
    const ctx = { connection: { getClientAsync }, marketplace } as unknown as MarketplaceActionContext

    const result = await removeMarketplaceItem(ctx, agent, "global", project, project)

    expect(result).toEqual({ success: true, slug: agent.id })
    expect(remove).toHaveBeenCalledWith({ name: agent.id, directory: project, scope: "global" })
    expect(marketplace.remove).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledWith({ directory: project })
  })

  it("returns a failure when the authoritative removal rejects the agent", async () => {
    const getClientAsync = mock(async () => ({
      kilocode: { removeAgent: mock(async () => ({ error: { message: "Agent is still configured" } })) },
      instance: { dispose: mock(async () => ({})) },
    }))
    const ctx = {
      connection: { getClientAsync },
      marketplace: { remove: mock(async () => ({ success: true, slug: agent.id })) },
    } as unknown as MarketplaceActionContext

    const result = await removeMarketplaceItem(ctx, agent, "project", project, project)

    expect(result).toEqual({ success: false, slug: agent.id, error: "Agent is still configured" })
  })

  it("uses friendly fallbacks for empty backend errors", async () => {
    const remove = mock(async () => ({ error: new Error("") }))
    const getClientAsync = mock(async () => ({ kilocode: { removeAgent: remove } }))
    const ctx = {
      connection: { getClientAsync },
      marketplace: { remove: mock(async () => ({ success: true, slug: agent.id })) },
    } as unknown as MarketplaceActionContext

    const rejected = await removeMarketplaceItem(ctx, agent, "project", project, project)
    expect(rejected).toEqual({
      success: false,
      slug: agent.id,
      error: `Agent "${agent.id}" is still provided by another configuration.`,
    })

    getClientAsync.mockImplementation(async () => {
      throw new Error("")
    })
    const failed = await removeMarketplaceItem(ctx, agent, "global", project, project)
    expect(failed).toEqual({ success: false, slug: agent.id, error: `Failed to remove agent "${agent.id}".` })
  })
})
