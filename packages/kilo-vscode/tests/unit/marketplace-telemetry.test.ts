import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import type { InstallMarketplaceItemOptions, MarketplaceItem } from "../../src/services/marketplace/types"
import { installed, removed } from "../../src/services/marketplace/telemetry"
import { TelemetryProxy } from "../../src/services/telemetry"
import { mcpAuth } from "../../src/services/mcp-auth"

const { MarketplacePanelProvider } = await import("../../src/MarketplacePanelProvider")

type Result = { success: boolean; slug: string; error?: string }

interface Internals {
  install(item: MarketplaceItem, opts: InstallMarketplaceItemOptions): Promise<void>
  remove(item: MarketplaceItem, scope: "project" | "global"): Promise<void>
  marketplace: {
    install: (...args: unknown[]) => Promise<Result>
    remove: (...args: unknown[]) => Promise<Result>
  }
}

const mcp = { id: "airbyte-agent-mcp", type: "mcp", name: "Airbyte Agent MCP" } as MarketplaceItem

describe("marketplace event properties", () => {
  it("uses the shared itemId/itemType keys and the method the host installed", () => {
    expect(installed(mcp, { target: "global", parameters: { __method: "Hosted", TOKEN: "secret-value" } })).toEqual({
      itemId: "airbyte-agent-mcp",
      itemType: "mcp",
      itemName: "Airbyte Agent MCP",
      target: "global",
      hasParameters: true,
      installationMethodName: "Hosted",
    })
  })

  it("never reports parameter values", () => {
    const props = installed(mcp, { parameters: { TOKEN: "secret-value" } })
    expect(JSON.stringify(props)).not.toContain("secret-value")
  })

  it("defaults the target to project like the installer, and omits absent extras", () => {
    expect(installed(mcp, {})).toEqual({
      itemId: "airbyte-agent-mcp",
      itemType: "mcp",
      itemName: "Airbyte Agent MCP",
      target: "project",
    })
  })

  it("does not count the method selector as a parameter", () => {
    expect(installed(mcp, { parameters: { __method: "Hosted" } }).hasParameters).toBeUndefined()
  })

  it("describes removals", () => {
    expect(removed(mcp, "project")).toEqual({
      itemId: "airbyte-agent-mcp",
      itemType: "mcp",
      itemName: "Airbyte Agent MCP",
      target: "project",
    })
  })
})

// The panel host, not the install dialog, owns these events so they survive the dialog closing.
// A real HTTP server stands in for the CLI's /telemetry/capture route.
describe("MarketplacePanelProvider marketplace telemetry", () => {
  const seen: { event: string; properties: Record<string, unknown> }[] = []
  const env = vscode.env as { isTelemetryEnabled: boolean }
  const before = env.isTelemetryEnabled
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/telemetry/capture") seen.push(await req.json())
      return Response.json(true)
    },
  })

  beforeAll(() => {
    env.isTelemetryEnabled = true
    TelemetryProxy.getInstance().configure(`http://127.0.0.1:${server.port}`, "pw")
  })

  afterAll(() => {
    env.isTelemetryEnabled = before
    server.stop(true)
  })

  beforeEach(() => {
    seen.length = 0
  })

  function panel(result: Result) {
    const connection = {
      getClient: () => undefined,
      getClientAsync: async () => ({}),
      onStateChange: () => () => {},
      onLanguageChanged: () => () => {},
      onEventFiltered: () => () => {},
    } as never
    mcpAuth(connection).refresh = mock(async () => [] as string[])
    const internal = new MarketplacePanelProvider({} as never, connection, {} as never) as unknown as Internals
    internal.marketplace.install = mock(async () => result)
    internal.marketplace.remove = mock(async () => result)
    return internal
  }

  async function settle(count: number) {
    for (let i = 0; i < 100 && seen.length < count; i++) await Bun.sleep(10)
  }

  it("emits Marketplace Item Installed when the install succeeds", async () => {
    await panel({ success: true, slug: mcp.id }).install(mcp, { target: "global", parameters: { __method: "Hosted" } })
    await settle(1)

    expect(seen.map((entry) => entry.event)).toEqual(["Marketplace Item Installed"])
    expect(seen[0]?.properties).toMatchObject({
      itemId: "airbyte-agent-mcp",
      itemType: "mcp",
      target: "global",
      installationMethodName: "Hosted",
    })
  })

  it("emits Marketplace Item Removed when the removal succeeds", async () => {
    await panel({ success: true, slug: mcp.id }).remove(mcp, "global")
    await settle(1)

    expect(seen.map((entry) => entry.event)).toEqual(["Marketplace Item Removed"])
    expect(seen[0]?.properties).toMatchObject({ itemId: "airbyte-agent-mcp", itemType: "mcp", target: "global" })
  })

  it("emits nothing when the install or removal fails", async () => {
    const failed = panel({ success: false, slug: mcp.id, error: "boom" })
    await failed.install(mcp, { target: "global" })
    await failed.remove(mcp, "global")
    await Bun.sleep(50)

    expect(seen).toEqual([])
  })
})
