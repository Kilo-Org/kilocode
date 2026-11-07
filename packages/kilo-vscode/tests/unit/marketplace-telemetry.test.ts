import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import type { InstallMarketplaceItemOptions, MarketplaceItem } from "../../src/services/marketplace/types"
import { TelemetryProxy } from "../../src/services/telemetry"
import { TelemetryEventName } from "../../src/services/telemetry/types"
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

// The CLI reports `Marketplace Item Installed`/`Removed` for every client. The extension sending them
// too would count each install twice. A real HTTP server stands in for the CLI's /telemetry/capture.
describe("MarketplacePanelProvider marketplace telemetry", () => {
  const seen: { event: string }[] = []
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

  function panel() {
    const connection = {
      getClient: () => undefined,
      getClientAsync: async () => ({}),
      onStateChange: () => () => {},
      onLanguageChanged: () => () => {},
      onEventFiltered: () => () => {},
    } as never
    mcpAuth(connection).refresh = mock(async () => [] as string[])
    const internal = new MarketplacePanelProvider({} as never, connection, {} as never) as unknown as Internals
    internal.marketplace.install = mock(async () => ({ success: true, slug: mcp.id }))
    internal.marketplace.remove = mock(async () => ({ success: true, slug: mcp.id }))
    return internal
  }

  it("leaves install and removal events to the CLI", async () => {
    const internal = panel()
    await internal.install(mcp, { target: "global", parameters: { __method: "Hosted" } })
    await internal.remove(mcp, "global")
    // Proves the endpoint is reachable, so an empty result is not a dead proxy.
    TelemetryProxy.capture(TelemetryEventName.MARKETPLACE_TAB_VIEWED)
    for (let i = 0; i < 100 && seen.length === 0; i++) await Bun.sleep(10)

    expect(seen.map((entry) => entry.event)).toEqual(["Marketplace Tab Viewed"])
  })
})
