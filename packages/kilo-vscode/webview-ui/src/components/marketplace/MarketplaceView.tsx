import { Component, createSignal, createMemo, onMount, onCleanup, Switch, Match } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import type { ExtensionMessage } from "../../types/messages"
import { MarketplaceListView } from "./MarketplaceListView"
import { SkillsMarketplace } from "./SkillsMarketplace"
import { InstallModal } from "./InstallModal"
import { RemoveDialog } from "./RemoveDialog"
import "./marketplace.css"

type Tab = "mcp" | "mode" | "skill"

const TAB_POSITIONS: Record<Tab, string> = {
  mcp: "0%",
  mode: "33.33%",
  skill: "66.66%",
}

export const MarketplaceView: Component = () => {
  const vscode = useVSCode()

  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [metadata, setMetadata] = createSignal<MarketplaceInstalledMetadata>({ project: {}, global: {} })
  const [fetching, setFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [tab, setTab] = createSignal<Tab>("mcp")
  const [organizationMcps, setOrganizationMcps] = createSignal<MarketplaceItem[]>([])

  const mcpItems = createMemo(() => items().filter((i) => i.type === "mcp"))
  const modeItems = createMemo(() => items().filter((i) => i.type === "mode"))
  const skillItems = createMemo(() => items().filter((i) => i.type === "skill"))
  const indicator = createMemo(() => TAB_POSITIONS[tab()])

  const [installItem, setInstallItem] = createSignal<MarketplaceItem | null>(null)
  const [removeItem, setRemoveItem] = createSignal<MarketplaceItem | null>(null)
  const [removeScope, setRemoveScope] = createSignal<"project" | "global">("project")
  const [pendingRemove, setPendingRemove] = createSignal<{ item: MarketplaceItem; scope: "project" | "global" } | null>(
    null,
  )

  const handleInstall = (item: MarketplaceItem) => {
    vscode.postMessage({
      type: "telemetry",
      event: "Marketplace Install Button Clicked",
      properties: { itemId: item.id, itemType: item.type, itemName: item.name },
    })
    setInstallItem(item)
  }

  const handleRemove = (item: MarketplaceItem, scope: "project" | "global") => {
    setRemoveItem(item)
    setRemoveScope(scope)
  }

  const handleInstallResult = (result: {
    success: boolean
    slug: string
    scope: "project" | "global"
    error?: string
  }) => {
    if (!result.success) return
    const item = installItem()
    if (item) {
      vscode.postMessage({
        type: "telemetry",
        event: "Marketplace Item Installed",
        properties: { itemId: item.id, itemType: item.type, itemName: item.name, target: result.scope },
      })
    }
    vscode.postMessage({ type: "fetchMarketplaceData" })
  }

  const handleRemoveConfirm = () => {
    const item = removeItem()
    if (!item) return
    const scope = removeScope()
    setPendingRemove({ item, scope })
    vscode.postMessage({
      type: "removeInstalledMarketplaceItem",
      mpItem: item,
      mpInstallOptions: { target: scope },
    })
    setRemoveItem(null)
  }

  onMount(() => {
    vscode.postMessage({ type: "telemetry", event: "Marketplace Tab Viewed" })
    vscode.postMessage({ type: "fetchMarketplaceData" })

    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type === "marketplaceData") {
        setItems(msg.marketplaceItems)
        setMetadata(msg.marketplaceInstalledMetadata)
        setOrganizationMcps(msg.organizationMcps)
        setErrors(msg.errors ?? [])
        setFetching(false)
        return
      }
      if (msg.type === "marketplaceInstallResult") {
        // Install result handled by InstallModal's onInstallResult callback,
        // which calls handleInstallResult and triggers fetchMarketplaceData
        return
      }
      if (msg.type === "marketplaceRemoveResult") {
        if (msg.success) {
          const pending = pendingRemove()
          if (pending) {
            vscode.postMessage({
              type: "telemetry",
              event: "Marketplace Item Removed",
              properties: {
                itemId: pending.item.id,
                itemType: pending.item.type,
                itemName: pending.item.name,
                target: pending.scope,
              },
            })
            setPendingRemove(null)
          }
        }
        // Re-fetch data after remove to update metadata
        vscode.postMessage({ type: "fetchMarketplaceData" })
      }
    })

    onCleanup(unsubscribe)
  })

  return (
    <div class="marketplace-view">
      <div class="marketplace-header">
        <div class="marketplace-tabs">
          <button class="marketplace-tab" classList={{ active: tab() === "mcp" }} onClick={() => setTab("mcp")}>
            MCP
          </button>
          <button class="marketplace-tab" classList={{ active: tab() === "mode" }} onClick={() => setTab("mode")}>
            Modes
          </button>
          <button class="marketplace-tab" classList={{ active: tab() === "skill" }} onClick={() => setTab("skill")}>
            Skills
          </button>
          <div class="marketplace-tab-indicator" style={{ left: indicator() }} />
        </div>
      </div>
      <div class="marketplace-content">
        <Switch>
          <Match when={tab() === "mcp"}>
            <MarketplaceListView
              type="mcp"
              items={mcpItems()}
              metadata={metadata()}
              fetching={fetching()}
              onInstall={handleInstall}
              onRemove={handleRemove}
            />
          </Match>
          <Match when={tab() === "mode"}>
            <MarketplaceListView
              type="mode"
              items={modeItems()}
              metadata={metadata()}
              fetching={fetching()}
              onInstall={handleInstall}
              onRemove={handleRemove}
            />
          </Match>
          <Match when={tab() === "skill"}>
            <SkillsMarketplace
              items={skillItems()}
              metadata={metadata()}
              fetching={fetching()}
              onInstall={handleInstall}
              onRemove={handleRemove}
            />
          </Match>
        </Switch>
      </div>
      <InstallModal item={installItem()} onClose={() => setInstallItem(null)} onInstallResult={handleInstallResult} />
      <RemoveDialog
        item={removeItem()}
        scope={removeScope()}
        onClose={() => setRemoveItem(null)}
        onConfirm={handleRemoveConfirm}
      />
    </div>
  )
}
