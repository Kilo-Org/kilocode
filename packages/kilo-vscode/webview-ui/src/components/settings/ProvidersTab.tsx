// Main's Providers tab on v2 integrations (v2/settings.tsx). Connected and popular providers, the connect dialogs and
// Disconnect are integrations and credentials. Not rendered, no v2 contract: the Custom provider row and its edit
// action (they write `provider.<id>`) and Disabled providers (`disabled_providers`), because `api.config.update`
// patches only `shell`. The Anaconda Desktop action has no v2 integration.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { IntegrationInfo } from "@opencode/client"
import { Component, For, Show, createMemo } from "solid-js"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"
import ProviderConnectDialog, { connectMethods } from "./ProviderConnectDialog"
import ProviderSelectDialog from "./ProviderSelectDialog"
import {
  KILO_PROVIDER_ID,
  credentials,
  isPopularProvider,
  providerIcon,
  providerNoteKey,
  sortProviders,
} from "./provider-catalog"

// main: provider-visibility.ts canChangeProviderKey
const FIXED_KEY = [
  KILO_PROVIDER_ID,
  "anaconda-desktop",
  "ollama",
  "amazon-bedrock",
  "google-vertex",
  "google-vertex-anthropic",
]

const ProvidersTab: Component<{ settings: SettingsData; onLogin: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const kilo = createMemo(() => props.settings.integration(KILO_PROVIDER_ID))
  const kiloLoggedIn = createMemo(() => (kilo()?.connections.length ?? 0) > 0)
  // v2 reports a Kilo account that needs a new sign-in on the connection.
  const kiloFailure = createMemo(() => kilo()?.connections.find((item) => item.status)?.status?.message)

  const connectedProviders = createMemo(() =>
    props.settings
      .integrations()
      .filter((item) => item.id !== KILO_PROVIDER_ID && item.connections.length > 0)
      // As v1: environment connections first, then stored credentials in the order they were added (IDs ascend).
      .toSorted((a, b) => {
        const left = credentials(a)[0]?.id ?? ""
        const right = credentials(b)[0]?.id ?? ""
        if (left !== right) return left < right ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
  )

  const popularProviders = createMemo(() =>
    sortProviders(
      props.settings
        .integrations()
        .filter((item) => item.id !== KILO_PROVIDER_ID && isPopularProvider(item.id) && item.connections.length === 0),
    ),
  )

  function sourceTag(item: IntegrationInfo) {
    const credential = credentials(item)[0]
    if (!credential) return language.t("settings.providers.tag.environment")
    if (credential.method === "key") return language.t("provider.connect.method.apiKey")
    if (item.id === "openai" && credential.method === "oauth") return language.t("settings.providers.tag.chatgpt")
    return language.t("settings.providers.tag.other")
  }

  function canDisconnect(item: IntegrationInfo) {
    return credentials(item).length > 0
  }

  function canChangeKey(item: IntegrationInfo) {
    if (FIXED_KEY.includes(item.id)) return false
    if (!credentials(item).some((credential) => credential.method === "key")) return false
    // Only offer key replacement when the dialog opens a standard API-key form.
    const methods = connectMethods(item)
    return methods.length === 1 && methods[0]?.type === "key" && !methods[0].form?.length
  }

  function disconnect(item: IntegrationInfo) {
    props.settings.disconnect(item).then(
      () => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: item.name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: item.name }),
        })
      },
      (err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      },
    )
  }

  function connectProvider(item: IntegrationInfo) {
    if (item.id === KILO_PROVIDER_ID) {
      // Route Kilo Gateway sign-in through the Profile view so the user sees
      // the full device-auth UI (URL, QR, code, timer, cancel).
      props.onLogin()
      return
    }
    dialog.show(() => <ProviderConnectDialog settings={props.settings} integrationID={item.id} />)
  }

  function connectChatGPT(item: IntegrationInfo) {
    dialog.show(() => <ProviderConnectDialog settings={props.settings} integrationID={item.id} oauthOnly />)
  }

  function chatgpt(item: IntegrationInfo) {
    if (item.id !== "openai") return false
    if (credentials(item).some((credential) => credential.method === "oauth")) return false
    return item.methods.some((method) => method.type === "oauth")
  }

  return (
    <div>
      {/* Kilo Gateway — always at the top, not editable */}
      <Card>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            gap: "4px",
            "min-height": "56px",
            padding: "12px 0",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <ProviderIcon id={providerIcon(KILO_PROVIDER_ID)} width={20} height={20} />
            <span
              style={{
                "font-size": "var(--kilo-font-size-14)",
                "font-weight": "500",
                color: "var(--vscode-foreground)",
              }}
            >
              Kilo Gateway
            </span>
            <Show
              when={kiloLoggedIn() && !kiloFailure()}
              fallback={
                <Button size="small" variant="secondary" onClick={() => props.onLogin()}>
                  {language.t("common.signIn")}
                </Button>
              }
            >
              <Tag>{language.t("settings.providers.tag.gateway")}</Tag>
            </Show>
          </div>
          <Show when={kiloFailure()}>
            {(failure) => (
              <span
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  color: "var(--vscode-errorForeground)",
                  "padding-left": "32px",
                }}
              >
                {failure()}
              </span>
            )}
          </Show>
        </div>
      </Card>

      {/* Connected providers (excluding Kilo) */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.connected")}
      </h4>
      <Card>
        <Show
          when={connectedProviders().length > 0}
          fallback={
            <div
              style={{
                padding: "16px 0",
                "font-size": "var(--kilo-font-size-14)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.providers.connected.empty")}
            </div>
          }
        >
          <For each={connectedProviders()}>
            {(item) => (
              <div
                style={{
                  display: "flex",
                  "flex-wrap": "wrap",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "16px",
                  "min-height": "56px",
                  padding: "12px 0",
                  "border-bottom": "1px solid var(--border-weak-base)",
                }}
              >
                <div style={{ display: "flex", "align-items": "center", gap: "12px", "min-width": 0 }}>
                  <ProviderIcon id={providerIcon(item.id)} width={20} height={20} />
                  <span
                    style={{
                      "font-size": "var(--kilo-font-size-14)",
                      "font-weight": "500",
                      color: "var(--vscode-foreground)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {item.name}
                  </span>
                  <Tag>{sourceTag(item)}</Tag>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                  <Show when={!canDisconnect(item)}>
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-14)",
                        color: "var(--text-base, var(--vscode-descriptionForeground))",
                        "padding-right": "12px",
                      }}
                    >
                      {language.t("settings.providers.connected.environmentDescription")}
                    </span>
                  </Show>
                  <Show when={chatgpt(item)}>
                    <Button size="large" variant="ghost" onClick={() => connectChatGPT(item)}>
                      {language.t("settings.providers.action.signInChatGPT")}
                    </Button>
                  </Show>
                  <Show when={canDisconnect(item)}>
                    <Show when={canChangeKey(item)}>
                      <Button size="large" variant="ghost" onClick={() => connectProvider(item)}>
                        {language.t("settings.providers.action.changeApiKey")}
                      </Button>
                    </Show>
                    <Button size="large" variant="ghost" onClick={() => disconnect(item)}>
                      {language.t("common.disconnect")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </Card>

      {/* Popular providers */}
      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.popular")}
      </h4>
      <Card>
        <For each={popularProviders()}>
          {(item) => {
            const noteKey = providerNoteKey(item.id)
            return (
              <div
                style={{
                  display: "flex",
                  "flex-wrap": "wrap",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "16px",
                  "min-height": "56px",
                  padding: "12px 0",
                  "border-bottom": "1px solid var(--border-weak-base)",
                }}
              >
                <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                    <ProviderIcon id={providerIcon(item.id)} width={20} height={20} />
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-14)",
                        "font-weight": "500",
                        color: "var(--vscode-foreground)",
                      }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <Show when={noteKey}>
                    {(key) => (
                      <span
                        style={{
                          "font-size": "var(--kilo-font-size-12)",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          "padding-left": "32px",
                        }}
                      >
                        {language.t(key())}
                      </span>
                    )}
                  </Show>
                </div>
                <Button size="large" variant="secondary" icon="plus-small" onClick={() => connectProvider(item)}>
                  {language.t("common.connect")}
                </Button>
              </div>
            )
          }}
        </For>

        {/* Show more providers — prominent entry point to the full catalog */}
        <button
          type="button"
          onClick={() => dialog.show(() => <ProviderSelectDialog settings={props.settings} onLogin={props.onLogin} />)}
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "16px",
            width: "100%",
            "min-height": "56px",
            padding: "12px 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            "text-align": "left",
            color: "var(--vscode-foreground)",
            font: "inherit",
          }}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "12px", "min-width": 0 }}>
            <Icon name="providers" size="small" />
            <span
              style={{
                "font-size": "var(--kilo-font-size-14)",
                "font-weight": "500",
              }}
            >
              {language.t("dialog.provider.viewAll")}
            </span>
          </div>
          <Icon name="chevron-right" size="small" />
        </button>
      </Card>
    </div>
  )
}

export default ProvidersTab
