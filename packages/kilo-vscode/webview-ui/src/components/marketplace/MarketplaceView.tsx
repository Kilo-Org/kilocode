import { Component, createSignal, createMemo, onMount, onCleanup, Show } from "solid-js"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem, SkillMarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import SkillsMarketplace from "./SkillsMarketplace"
import InstallModal from "./InstallModal"
import RemoveDialog from "./RemoveDialog"
import "./marketplace.css"

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }

const MarketplaceView: Component = () => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()

  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [metadata, setMetadata] = createSignal<MarketplaceInstalledMetadata>(EMPTY_METADATA)
  const [fetching, setFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [tab, setTab] = createSignal("skill")

  // Install/Remove state
  const [installItem, setInstallItem] = createSignal<MarketplaceItem | null>(null)
  const [removeItem, setRemoveItem] = createSignal<{ item: MarketplaceItem; scope: "project" | "global" } | null>(null)
  const [pendingRemove, setPendingRemove] = createSignal<string | null>(null)
  const [removeError, setRemoveError] = createSignal<string | null>(null)

  const skills = createMemo(() => items().filter((i): i is SkillMarketplaceItem => i.type === "skill"))

  const fetchData = () => {
    setFetching(true)
    vscode.postMessage({ type: "fetchMarketplaceData" })
  }

  onMount(() => {
    fetchData()

    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === "marketplaceData") {
        setItems(msg.marketplaceItems ?? [])
        setMetadata(msg.marketplaceInstalledMetadata ?? EMPTY_METADATA)
        setErrors(msg.errors ?? [])
        setFetching(false)
      }
      if (msg?.type === "marketplaceRemoveResult") {
        if (msg.slug === pendingRemove()) {
          setPendingRemove(null)
          if (!msg.success) {
            setRemoveError(msg.error ?? "Failed to remove item")
          } else {
            fetchData()
          }
        }
      }
      // Re-fetch when agents or skills change (e.g. after install via CLI)
      if (msg?.type === "agentsLoaded" || msg?.type === "skillsLoaded") {
        fetchData()
      }
      // Re-fetch when workspace directory changes
      if (msg?.type === "workspaceDirectoryChanged") {
        fetchData()
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleInstall = (item: MarketplaceItem) => {
    setInstallItem(item)
  }

  const handleRemove = (item: MarketplaceItem, scope: "project" | "global") => {
    setRemoveItem({ item, scope })
  }

  const confirmRemove = () => {
    const r = removeItem()
    if (!r) return
    setPendingRemove(r.item.id)
    setRemoveError(null)
    vscode.postMessage({
      type: "removeInstalledMarketplaceItem",
      mpItem: r.item,
      mpInstallOptions: { target: r.scope },
    })
    setRemoveItem(null)
  }

  return (
    <div class="marketplace-view">
      <Tabs value={tab()} onChange={setTab}>
        <Tabs.List>
          <Tabs.Trigger value="skill">{t("marketplace.tab.skills")}</Tabs.Trigger>
          <Tabs.Trigger value="mcp">{t("marketplace.tab.mcpServers")}</Tabs.Trigger>
          <Tabs.Trigger value="mode">{t("marketplace.tab.modes")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="skill">
          <SkillsMarketplace
            items={skills()}
            metadata={metadata()}
            fetching={fetching()}
            onInstall={handleInstall}
            onRemove={handleRemove}
          />
        </Tabs.Content>

        <Tabs.Content value="mcp">
          <div class="marketplace-placeholder">
            <p>{t("marketplace.placeholder")}</p>
          </div>
        </Tabs.Content>

        <Tabs.Content value="mode">
          <div class="marketplace-placeholder">
            <p>{t("marketplace.placeholder")}</p>
          </div>
        </Tabs.Content>
      </Tabs>

      <Show when={errors().length > 0}>
        <div class="marketplace-errors">
          {errors().map((e) => (
            <p class="marketplace-error">{e}</p>
          ))}
        </div>
      </Show>

      <Show when={removeError()}>
        <div class="marketplace-errors">
          <p class="marketplace-error">{removeError()}</p>
        </div>
      </Show>

      <Show when={installItem()}>
        {(item) => (
          <InstallModal
            item={item()}
            onClose={() => setInstallItem(null)}
            onInstallResult={(success) => {
              if (success) {
                setInstallItem(null)
                fetchData()
              }
            }}
          />
        )}
      </Show>

      <Show when={removeItem()}>
        {(r) => (
          <RemoveDialog
            item={r().item}
            scope={r().scope}
            onClose={() => setRemoveItem(null)}
            onConfirm={confirmRemove}
          />
        )}
      </Show>
    </div>
  )
}

export default MarketplaceView
