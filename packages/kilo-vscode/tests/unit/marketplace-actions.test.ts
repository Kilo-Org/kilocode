import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import {
  removeMarketplaceItem,
  removeMarketplaceItemFromAllScopes,
  type MarketplaceActionContext,
  type MarketplaceRemoveContext,
} from "../../src/services/marketplace/actions"
import type { McpMarketplaceItem } from "../../src/services/marketplace/types"

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
  url: "",
  content: "",
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
