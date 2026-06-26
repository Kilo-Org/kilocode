import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const ext = fs.readFileSync(path.join(root, "src/extension.ts"), "utf-8")
const kilo = fs.readFileSync(path.join(root, "src/KiloProvider.ts"), "utf-8")
const panel = fs.readFileSync(path.join(root, "src/MarketplacePanelProvider.ts"), "utf-8")
const settings = fs.readFileSync(path.join(root, "src/SettingsEditorProvider.ts"), "utf-8")
const subagent = fs.readFileSync(path.join(root, "src/SubAgentViewerProvider.ts"), "utf-8")
const host = fs.readFileSync(path.join(root, "src/agent-manager/vscode-host.ts"), "utf-8")
const remove = fs.readFileSync(path.join(root, "src/kilo-provider/remove-config-item.ts"), "utf-8")

describe("standalone Marketplace architecture", () => {
  it("keeps Marketplace webview cases out of KiloProvider", () => {
    for (const type of [
      "fetchMarketplaceData",
      "installMarketplaceItem",
      "removeInstalledMarketplaceItem",
      "dismissAgentMigrationBanner",
    ]) {
      expect(kilo).not.toContain(`case \"${type}\"`)
      expect(panel).toContain(`case \"${type}\"`)
    }
  })

  it("uses a dedicated Marketplace webview bundle", () => {
    expect(panel).toContain('"dist", "marketplace.js"')
    expect(panel).not.toContain('"dist", "webview.js"')
  })

  it("shares one extension-owned Marketplace service", () => {
    expect(ext.match(/new MarketplaceService\(\)/g)).toHaveLength(1)
    expect(ext).toContain("context.subscriptions.push(marketplace)")
    expect(kilo).not.toContain("new MarketplaceService()")
    expect(panel).not.toContain("new MarketplaceService()")
    expect(kilo).not.toContain("this.marketplace.dispose()")
    expect(panel).not.toContain("this.marketplace.dispose()")
  })

  it("injects only the narrow installer into interactive chat providers", () => {
    expect(ext.match(/setAgentRequirementsInstallHandler\(installRequirements\)/g)).toHaveLength(4)
    expect(host).toContain("setAgentRequirementsInstallHandler(this.installRequirements)")
    expect(settings).not.toContain("MarketplaceService")
    expect(settings).not.toContain("setAgentRequirementsInstallHandler")
    expect(subagent).not.toContain("MarketplaceService")
    expect(subagent).not.toContain("setAgentRequirementsInstallHandler")
  })

  it("keeps sidebar removal behind a narrow adapter", () => {
    expect(kilo).toContain("removeAgent(this.removeConfigItemCtx, name)")
    expect(kilo).toContain("removeMcp(this.removeConfigItemCtx, name)")
    expect(remove).toContain("createMarketplaceRemover")
    expect(remove).not.toContain("new MarketplaceService()")
    expect(remove).not.toContain("AgentMarketplaceItem")
    expect(remove).not.toContain("McpMarketplaceItem")
  })
})
