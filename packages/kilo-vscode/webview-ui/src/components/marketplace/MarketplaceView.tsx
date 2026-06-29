import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import type {
  MarketplaceItem,
  MarketplaceInstalledMetadata,
  MarketplaceRelevanceMetadata,
} from "../../types/marketplace"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import { MarketplaceListView } from "./MarketplaceListView"
import { InstallModal } from "./InstallModal"
import { RemoveDialog } from "./RemoveDialog"
import "./marketplace.css"

const EMPTY_METADATA: MarketplaceInstalledMetadata = { project: {}, global: {} }
const EMPTY_RELEVANCE: MarketplaceRelevanceMetadata = {}

export const MarketplaceView = () => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()
  const dialog = useDialog()

  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [metadata, setMetadata] = createSignal<MarketplaceInstalledMetadata>(EMPTY_METADATA)
  const [relevance, setRelevance] = createSignal<MarketplaceRelevanceMetadata>(EMPTY_RELEVANCE)
  const [fetching, setFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [pending, setPending] = createSignal<{ item: MarketplaceItem; scope: "project" | "global" } | null>(null)
  const [showMigrationBanner, setShowMigrationBanner] = createSignal(false)

  const fetchData = () => {
    setFetching(true)
    vscode.postMessage({ type: "fetchMarketplaceData" })
  }

  // Listen for messages
  createEffect(() => {
    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "marketplaceData") {
        setItems(msg.marketplaceItems ?? [])
        setMetadata(msg.marketplaceInstalledMetadata ?? EMPTY_METADATA)
        setRelevance(msg.marketplaceRelevance ?? EMPTY_RELEVANCE)
        setErrors(msg.errors ?? [])
        setFetching(false)
        setShowMigrationBanner(msg.showAgentMigrationBanner ?? false)
      }
      if (msg.type === "openInstallModal") {
        const match = items().find((i) => i.type === msg.mpItem.type && i.id === msg.mpItem.id)
        handleInstall(match ?? msg.mpItem)
      }
      if (msg.type === "marketplaceRemoveResult") {
        const removed = pending()
        setPending(null)
        if (msg.success) {
          if (removed) {
            telemetry(TelemetryEventName.MARKETPLACE_ITEM_REMOVED, {
              itemId: removed.item.id,
              itemType: removed.item.type,
              itemName: removed.item.name,
              target: removed.scope,
            })
          }
          fetchData()
        } else {
          setErrors((prev) => [...prev, msg.error ?? t("marketplace.remove.failed", { name: msg.slug })])
        }
      }
    })
    onCleanup(unsub)
  })

  // Re-fetch when workspace changes
  createEffect(() => {
    server.workspaceDirectory()
    fetchData()
  })

  const telemetry = (event: string, properties?: Record<string, unknown>) => {
    vscode.postMessage({ type: "telemetry", event, properties: properties ?? {} })
  }

  onMount(() => {
    telemetry(TelemetryEventName.MARKETPLACE_TAB_VIEWED)
  })

  const handleInstall = (item: MarketplaceItem) => {
    telemetry(TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED, {
      itemId: item.id,
      itemType: item.type,
      itemName: item.name,
    })
    dialog.show(() => (
      <InstallModal
        item={item}
        onClose={() => dialog.close()}
        onInstallResult={(success, scope, extra) => {
          if (success) {
            telemetry(TelemetryEventName.MARKETPLACE_ITEM_INSTALLED, {
              itemId: item.id,
              itemType: item.type,
              itemName: item.name,
              target: scope,
              ...(extra?.hasParameters && { hasParameters: true }),
              ...(extra?.installationMethodName && { installationMethodName: extra.installationMethodName }),
            })
            fetchData()
          }
        }}
      />
    ))
  }

  const handleRemove = (item: MarketplaceItem, scope: "project" | "global") => {
    dialog.show(() => (
      <RemoveDialog
        item={item}
        scope={scope}
        onClose={() => dialog.close()}
        onConfirm={() => {
          setPending({ item, scope })
          vscode.postMessage({
            type: "removeInstalledMarketplaceItem",
            mpItem: item,
            mpInstallOptions: { target: scope },
          })
          dialog.close()
        }}
      />
    ))
  }

  const dismissError = (idx: number) => {
    setErrors((prev) => prev.filter((_, i) => i !== idx))
  }

  const dismissMigrationBanner = () => {
    setShowMigrationBanner(false)
    vscode.postMessage({ type: "dismissAgentMigrationBanner" })
  }

  return (
    <div class="marketplace-view">
      <Show when={errors().length > 0}>
        {errors().map((err, idx) => (
          <Card variant="error" class="marketplace-error-banner">
            <span>{err}</span>
            <Button variant="ghost" size="small" onClick={() => dismissError(idx)}>
              {t("marketplace.error.dismiss")}
            </Button>
          </Card>
        ))}
      </Show>

      <Show when={showMigrationBanner()}>
        <Card variant="info" class="marketplace-error-banner">
          <span>{t("marketplace.migration.notice")}</span>
          <Button variant="ghost" size="small" onClick={dismissMigrationBanner}>
            {t("marketplace.error.dismiss")}
          </Button>
        </Card>
      </Show>
      <MarketplaceListView
        items={items()}
        metadata={metadata()}
        relevance={relevance()}
        fetching={fetching()}
        searchPlaceholder={t("marketplace.search")}
        emptyMessage={t("marketplace.empty")}
        relevantEmptyMessage={t("marketplace.empty.relevant")}
        onInstall={handleInstall}
        onRemove={handleRemove}
      />
    </div>
  )
}
