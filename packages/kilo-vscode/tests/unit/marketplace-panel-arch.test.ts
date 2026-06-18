import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const panel = fs.readFileSync(path.join(root, "src/MarketplacePanelProvider.ts"), "utf-8")
const remove = fs.readFileSync(path.join(root, "src/kilo-provider/remove-config-item.ts"), "utf-8")
const cliMarketplace = fs
  .readdirSync(path.join(root, "..", "opencode", "src", "kilocode", "marketplace"))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => fs.readFileSync(path.join(root, "..", "opencode", "src", "kilocode", "marketplace", file), "utf-8"))
  .join("\n")

describe("standalone Marketplace architecture", () => {
  it("keeps Marketplace webview cases out of KiloProvider", () => {
    for (const type of [
      "fetchMarketplaceData",
      "installMarketplaceItem",
      "removeInstalledMarketplaceItem",
      "dismissAgentMigrationBanner",
    ]) {
      expect(panel).toContain(`case \"${type}\"`)
    }
  })

  it("uses a dedicated Marketplace webview bundle", () => {
    expect(panel).toContain('"dist", "marketplace.js"')
    expect(panel).not.toContain('"dist", "webview.js"')
  })

  it("keeps sidebar removal behind a narrow adapter", () => {
    expect(remove).toContain("removeMarketplaceItemFromAllScopes")
    expect(remove).not.toContain("new MarketplaceService()")
    expect(remove).not.toContain("AgentMarketplaceItem")
    expect(remove).not.toContain("McpMarketplaceItem")
  })

  it("keeps VS Code storage cleanup out of CLI marketplace code", () => {
    expect(cliMarketplace).not.toContain("vscodeGlobalStorage")
    expect(cliMarketplace).not.toContain("globalStorage")
    expect(cliMarketplace).not.toContain("mcp_settings.json")
  })
})
