import {
  Component,
  createSignal,
  createMemo,
  createEffect,
  on,
  onMount,
  onCleanup,
  Switch,
  Match,
  Show,
  For,
} from "solid-js"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import type { ExtensionMessage } from "../../types/messages"
import { MarketplaceListView } from "./MarketplaceListView"
import { SkillsMarketplace } from "./SkillsMarketplace"
import { InstallModal } from "./InstallModal"
import { RemoveDialog } from "./RemoveDialog"
import "./marketplace.css"

type Tab = "mcp" | "mode" | "skill"

export const MarketplaceView: Component = () => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()

  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [metadata, setMetadata] = createSignal<MarketplaceInstalledMetadata>({ project: {}, global: {} })
  const [fetching, setFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [tab, setTab] = createSignal<Tab>("mcp")
  const mcpItems = createMemo(() => items().filter((i) => i.type === "mcp"))
  const modeItems = createMemo(() => items().filter((i) => i.type === "mode"))
  const skillItems = createMemo(() => items().filter((i) => i.type === "skill"))

  const [installItem, setInstallItem] = createSignal<MarketplaceItem | null>(null)
  const [removeItem, setRemoveItem] = createSignal<MarketplaceItem | null>(null)
  const [removeScope, setRemoveScope] = createSignal<"project" | "global">("project")
  const [pendingRemove, setPendingRemove] = createSignal<{ item: MarketplaceItem; scope: "project" | "global" } | null>(
    null,
  )
  const [removeError, setRemoveError] = createSignal<string | null>(null)

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
        const pending = pendingRemove()
        if (msg.success) {
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
          }
          setRemoveError(null)
          vscode.postMessage({ type: "fetchMarketplaceData" })
        } else {
          setRemoveError(msg.error ?? t("marketplace.remove.failed", { name: pending?.item.name ?? "item" }))
        }
        setPendingRemove(null)
      }
    })

    onCleanup(unsubscribe)
  })

  createEffect(
    on(
      () => server.workspaceDirectory(),
      () => {
        setFetching(true)
        vscode.postMessage({ type: "fetchMarketplaceData" })
      },
      { defer: true },
    ),
  )

  return (
    <div class="marketplace-view">
      <div class="marketplace-header">
        <div class="marketplace-tabs">
          <button class="marketplace-tab" classList={{ active: tab() === "mcp" }} onClick={() => setTab("mcp")}>
            {t("marketplace.tab.mcp")}
          </button>
          <button class="marketplace-tab" classList={{ active: tab() === "mode" }} onClick={() => setTab("mode")}>
            {t("marketplace.tab.modes")}
          </button>
          <button class="marketplace-tab" classList={{ active: tab() === "skill" }} onClick={() => setTab("skill")}>
            {t("marketplace.tab.skills")}
          </button>
        </div>
      </div>
      <div class="marketplace-content">
        <For each={errors()}>{(err) => <div class="marketplace-error-banner">{err}</div>}</For>
        <Show when={removeError()}>
          <div class="marketplace-error-banner">
            {removeError()}
            <button class="marketplace-error-dismiss" onClick={() => setRemoveError(null)}>
              ×
            </button>
          </div>
        </Show>
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
