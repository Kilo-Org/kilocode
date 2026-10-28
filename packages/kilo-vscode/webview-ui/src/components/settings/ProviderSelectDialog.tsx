// Main's provider catalog dialog on v2 integrations. It lists providers that are not connected, so a connection
// failure never shows here. Not rendered, no v2 contract: the Custom provider entry
// (it writes `provider.<id>`, and `api.config.update` patches only `shell`).
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { List } from "@kilocode/kilo-ui/list"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Show, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"
import ProviderConnectDialog from "./ProviderConnectDialog"
import { KILO_PROVIDER_ID, isPopularProvider, popularProviderIndex, providerIcon } from "./provider-catalog"

type ProviderItem = {
  id: string
  name: string
}

const ProviderSelectDialog = (props: { settings: SettingsData; onLogin: () => void }) => {
  const dialog = useDialog()
  const language = useLanguage()

  const items = createMemo<ProviderItem[]>(() => {
    language.locale()

    const all = props.settings.integrations()
    const withKilo = all.some((item) => item.id === KILO_PROVIDER_ID)
      ? all
      : [{ id: KILO_PROVIDER_ID, name: "Kilo Gateway", connections: [] }, ...all]
    const available = withKilo.filter((item) => item.connections.length === 0)

    return available.map((item) => ({ id: item.id, name: item.name }))
  })

  function open(item: ProviderItem) {
    if (item.id === KILO_PROVIDER_ID) {
      dialog.close()
      // Navigate to the Profile view so the full device-auth UI is visible.
      props.onLogin()
      return
    }

    dialog.show(() => <ProviderConnectDialog settings={props.settings} integrationID={item.id} />)
  }

  return (
    <Dialog title={language.t("command.provider.connect")} size="large" transition>
      <List<ProviderItem>
        search={{ placeholder: language.t("dialog.provider.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.provider.empty")}
        activeIcon="plus-small"
        key={(item) => item.id}
        items={items()}
        filterKeys={["id", "name"]}
        groupBy={(item) =>
          isPopularProvider(item.id)
            ? language.t("settings.providers.group.recommended")
            : language.t("dialog.provider.group.other")
        }
        sortBy={(a, b) => {
          const rank = popularProviderIndex(a.id) - popularProviderIndex(b.id)
          if (rank !== 0) return rank
          return a.name.localeCompare(b.name)
        }}
        sortGroupsBy={(a, b) => {
          const recommended = language.t("settings.providers.group.recommended")
          if (a.category === recommended && b.category !== recommended) return -1
          if (b.category === recommended && a.category !== recommended) return 1
          return 0
        }}
        onSelect={(item) => {
          if (!item) return
          open(item)
        }}
      >
        {(item) => (
          <div style={{ display: "flex", gap: "10px", "align-items": "center", width: "100%", "min-width": 0 }}>
            <ProviderIcon id={providerIcon(item.id)} width={18} height={18} data-slot="list-item-extra-icon" />
            <div style={{ display: "flex", "flex-direction": "column", "min-width": 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  "min-width": 0,
                  "flex-wrap": "wrap",
                }}
              >
                <span
                  style={{
                    "font-size": "var(--kilo-font-size-14)",
                    "line-height": "var(--kilo-font-size-20)",
                    color: "var(--vscode-foreground)",
                  }}
                >
                  {item.name}
                </span>
                <Show when={item.id === KILO_PROVIDER_ID}>
                  <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                </Show>
              </div>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}

export default ProviderSelectDialog
