import { For, Show, createSignal, onMount } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"
import { createMarketplace } from "../../v2/marketplace"
import type { InstallInput, MarketplaceItem, MarketplaceRecord, MarketplaceScope } from "../../v2/marketplace-data"
import { message } from "../../v2/scope"
import { InstallModal } from "./InstallModal"
import { MarketplaceListView } from "./MarketplaceListView"
import { RemoveDialog } from "./RemoveDialog"
import { entryKey } from "./utils"
import "./marketplace.css"

export const MarketplaceView = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const marketplace = createMarketplace()
  const telemetry = (event: string, properties?: Record<string, unknown>) =>
    vscode.postMessage({ type: "telemetry", event, properties: properties ?? {} })
  const describe = (item: { id: string; kind: string }, name: string) => ({
    itemId: item.id,
    itemType: item.kind,
    itemName: name,
  })
  onMount(() => telemetry(TelemetryEventName.MARKETPLACE_TAB_VIEWED))
  const [search, setSearch] = createSignal("")
  const [actionErrors, setActionErrors] = createSignal<string[]>([])

  const nameOf = (record: MarketplaceRecord) =>
    marketplace.items().find((item) => entryKey(item) === entryKey(record))?.name ?? record.id
  const open = (url: string) => marketplace.open(url, true)
  const fail = (error: string) => setActionErrors((current) => [...current, error])

  // A repair reuses the install dialog with the record's own scope and method, so it writes the same
  // configuration the record was installed with instead of the item's first option.
  const show = (item: MarketplaceItem, existing?: MarketplaceRecord, scope?: MarketplaceScope) => {
    if (!existing) telemetry(TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED, describe(item, item.name))
    const install = async (target: MarketplaceItem, input: InstallInput) => {
      const record = await marketplace.install(target, input)
      telemetry(TelemetryEventName.MARKETPLACE_ITEM_INSTALLED, {
        ...describe(target, target.name),
        target: input.scope,
        ...(Object.keys(input.params ?? {}).length > 0 && { hasParameters: true }),
        ...(input.option && { installationMethodName: input.option }),
      })
      return record
    }
    dialog.show(() => (
      <InstallModal
        item={item}
        workspace={marketplace.workspace}
        defaultScope={existing?.scope ?? scope}
        defaultOption={existing?.option}
        mcp={marketplace.mcp}
        onClose={() => dialog.close()}
        onPreview={marketplace.preview}
        onInstall={install}
        onOpen={open}
      />
    ))
  }

  const remove = (record: MarketplaceRecord) => {
    dialog.show(() => (
      <RemoveDialog
        record={record}
        name={nameOf(record)}
        onClose={() => dialog.close()}
        onConfirm={() => {
          dialog.close()
          void marketplace
            .uninstall(record)
            .then(() =>
              telemetry(TelemetryEventName.MARKETPLACE_ITEM_REMOVED, {
                ...describe(record, nameOf(record)),
                target: record.scope,
              }),
            )
            .catch((error) => fail(message(error)))
        }}
      />
    ))
  }

  const signIn = async (server: string) => {
    await marketplace.mcp.signIn(server)
    await marketplace.mcp.sync().catch(() => undefined)
    if (marketplace.mcp.status(server)?.status !== "connected") {
      fail(language.t("marketplace.install.mcp.signIn.failed", { name: server }))
    }
  }

  return (
    <div class="marketplace-view">
      <For each={marketplace.errors()}>
        {(error, index) => (
          <Card variant="error" class="marketplace-error-banner">
            <span>{error}</span>
            <Button variant="ghost" size="small" onClick={() => marketplace.dismissError(index())}>
              {language.t("marketplace.error.dismiss")}
            </Button>
          </Card>
        )}
      </For>
      <Show when={marketplace.installedError()}>
        <Card variant="error" class="marketplace-error-banner">
          <span>{marketplace.installedError()}</span>
          <Button variant="ghost" size="small" onClick={() => marketplace.dismissInstalledError()}>
            {language.t("marketplace.error.dismiss")}
          </Button>
        </Card>
      </Show>
      <For each={actionErrors()}>
        {(error, index) => (
          <Card variant="error" class="marketplace-error-banner">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setActionErrors((current) => current.filter((_, position) => position !== index()))}
            >
              {language.t("marketplace.error.dismiss")}
            </Button>
          </Card>
        )}
      </For>
      <MarketplaceListView
        items={marketplace.items()}
        records={marketplace.records()}
        fetching={marketplace.fetching()}
        installedFetching={marketplace.installedFetching()}
        search={search()}
        onSearchChange={setSearch}
        mcp={marketplace.mcp}
        onInstall={(item, scope) => show(item, undefined, scope)}
        onRemove={remove}
        onRepair={(item, record) => show(item, record)}
        onSignIn={(server) => void signIn(server)}
        onOpen={open}
        onRefresh={() => void marketplace.refresh()}
      />
    </div>
  )
}
