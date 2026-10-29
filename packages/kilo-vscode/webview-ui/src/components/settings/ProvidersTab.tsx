// The Providers tab: connected and popular providers, the connect dialogs and Disconnect are v2 integrations and
// credentials (v2/settings.tsx). The custom provider dialog writes `providers.<id>` through `useSettingsConfig` and
// stores the key as a credential. Disabled providers are `provider.use` deny policies. The Anaconda Desktop action
// has no v2 integration.
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { IntegrationInfo } from "@opencode/client"
import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"
import { useSettingsConfig } from "../../v2/settings-config"
import CustomProviderDialog from "./CustomProviderDialog"
import type { CustomProviderConfigValue } from "./CustomProviderValidation"
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
import { disabledProviderOptions, isCustomProvider } from "./provider-visibility"

// Providers whose credentials can only be changed through their own sign-in flow, not an API-key field.
const FIXED_KEY = [
  KILO_PROVIDER_ID,
  "anaconda-desktop",
  "ollama",
  "amazon-bedrock",
  "google-vertex",
  "google-vertex-anthropic",
]

type Policy = { action: string; resource: string; effect: string }

const ProvidersTab: Component<{ settings: SettingsData; onLogin: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const config = useSettingsConfig()
  const [disabledChoice, setDisabledChoice] = createSignal<{ value: string; label: string } | undefined>()

  const kilo = createMemo(() => props.settings.integration(KILO_PROVIDER_ID))
  const kiloLoggedIn = createMemo(() => (kilo()?.connections.length ?? 0) > 0)
  // v2 reports a Kilo account that needs a new sign-in on the connection.
  const kiloFailure = createMemo(() => kilo()?.connections.find((item) => item.status)?.status?.message)

  const policies = createMemo<Policy[]>(() => {
    const value = config.value(["policies"])
    return Array.isArray(value) ? (value as Policy[]) : []
  })

  const disabledIds = createMemo(
    () => new Set(policies().flatMap((item) => (item.action === "provider.use" ? [item.resource] : []))),
  )

  /** The custom providers defined in `providers.<id>` config. */
  const configuredCustoms = createMemo(() => {
    const providers = config.value(["providers"])
    if (!providers || typeof providers !== "object") return []
    return Object.entries(providers)
      .filter(([, value]) => isCustomProvider(value))
      .map(([id, value]) => ({ id, name: (value as { name?: string }).name ?? id, config: value }))
  })

  const connectedProviders = createMemo(() =>
    props.settings
      .integrations()
      .filter(
        (item) => item.id !== KILO_PROVIDER_ID && item.connections.length > 0 && !disabledIds().has(item.id),
      )
      // Environment connections first, then stored credentials in the order they were added (IDs ascend).
      .toSorted((a, b) => {
        const left = credentials(a)[0]?.id ?? ""
        const right = credentials(b)[0]?.id ?? ""
        if (left !== right) return left < right ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
  )

  /** Custom providers that carry no credential yet, so they do not appear through an integration connection. */
  const unconnectedCustoms = createMemo(() => {
    const connected = new Set(connectedProviders().map((item) => item.id))
    return configuredCustoms().filter((item) => !connected.has(item.id) && !disabledIds().has(item.id))
  })

  const popularProviders = createMemo(() =>
    sortProviders(
      props.settings
        .integrations()
        .filter(
          (item) =>
            item.id !== KILO_PROVIDER_ID &&
            isPopularProvider(item.id) &&
            item.connections.length === 0 &&
            !disabledIds().has(item.id) &&
            !configuredCustoms().some((custom) => custom.id === item.id),
        ),
    ),
  )

  const disabledProviders = createMemo(() =>
    [...disabledIds()].map((id) => ({
      id,
      name: props.settings.integrations().find((item) => item.id === id)?.name ?? id,
    })),
  )

  const disabledOptions = createMemo(() => disabledProviderOptions(props.settings.integrations(), [...disabledIds()]))

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

  function isCustom(item: IntegrationInfo) {
    const value = config.value(["providers", item.id])
    return isCustomProvider(value)
  }

  /** Delete removes a custom provider's `providers.<id>` config and its credential; Disconnect clears the credential. */
  function disconnect(item: IntegrationInfo) {
    const custom = isCustom(item)
    const scope = config.source(["providers", item.id]) ?? "global"
    const removal = custom ? config.unset(["providers", item.id], scope) : Promise.resolve(true)
    props.settings.disconnect(item).then(
      async () => {
        await removal
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

  /** Removes a custom provider that has no credential connection yet. */
  function removeCustom(providerID: string, name: string) {
    const scope = config.source(["providers", providerID]) ?? "global"
    void (async () => {
      try {
        const ok = await config.unset(["providers", providerID], scope)
        if (!ok) return
        const integration = props.settings.integration(providerID)
        if (integration) await props.settings.disconnect(integration)
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      } catch (err) {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }

  function editCustom(providerID: string, name: string, value: CustomProviderConfigValue) {
    dialog.show(() => (
      <CustomProviderDialog settings={props.settings} existing={{ providerID, name, config: value }} />
    ))
  }

  function writeDisabled(next: string[]) {
    const kept = policies().filter((item) => item.action !== "provider.use")
    const denied = next.map((id) => ({ action: "provider.use", resource: id, effect: "deny" }))
    const scope = config.source(["policies"]) ?? "global"
    const value = [...kept, ...denied]
    if (value.length === 0) {
      void config.unset(["policies"], scope)
      return
    }
    void config.set(["policies"], value, scope)
  }

  function disableProvider(providerID: string) {
    if (!providerID || disabledIds().has(providerID)) return
    writeDisabled([...disabledIds(), providerID])
  }

  function enableProvider(providerID: string) {
    writeDisabled([...disabledIds()].filter((id) => id !== providerID))
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
      <Show when={!disabledIds().has(KILO_PROVIDER_ID)}>
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
      </Show>

      {/* Connected providers (excluding Kilo) */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.connected")}
      </h4>
      <Card>
        <Show
          when={connectedProviders().length > 0 || unconnectedCustoms().length > 0}
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
                  <Tag>{isCustom(item) ? language.t("settings.providers.tag.custom") : sourceTag(item)}</Tag>
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
                    <Show when={isCustom(item)}>
                      <Button size="large" variant="ghost" onClick={() => editCustom(item.id, item.name, config.value(["providers", item.id]) as CustomProviderConfigValue)}>
                        {language.t("provider.custom.edit.title")}
                      </Button>
                    </Show>
                    <Button size="large" variant="ghost" onClick={() => disconnect(item)}>
                      {language.t(isCustom(item) ? "common.delete" : "common.disconnect")}
                    </Button>
                  </Show>
                </div>
              </div>
            )}
          </For>

          <For each={unconnectedCustoms()}>
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
                  <ProviderIcon id="synthetic" width={20} height={20} />
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
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                  <Button size="large" variant="ghost" onClick={() => editCustom(item.id, item.name, item.config)}>
                    {language.t("provider.custom.edit.title")}
                  </Button>
                  <Button size="large" variant="ghost" onClick={() => removeCustom(item.id, item.name)}>
                    {language.t("common.delete")}
                  </Button>
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

        {/* Custom provider entry */}
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
            <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "12px" }}>
              <ProviderIcon id="synthetic" width={20} height={20} />
              <span
                style={{
                  "font-size": "var(--kilo-font-size-14)",
                  "font-weight": "500",
                  color: "var(--vscode-foreground)",
                }}
              >
                {language.t("provider.custom.title")}
              </span>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </div>
            <span
              style={{
                "font-size": "var(--kilo-font-size-12)",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "padding-left": "32px",
              }}
            >
              {language.t("settings.providers.custom.description")}
            </span>
          </div>
          <Button
            size="large"
            variant="secondary"
            icon="plus-small"
            onClick={() => dialog.show(() => <CustomProviderDialog settings={props.settings} />)}
          >
            {language.t("common.connect")}
          </Button>
        </div>

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

      {/* Disabled providers — collapsed by default to keep the focus on active providers */}
      <div style={{ "margin-top": "24px" }}>
        <Collapsible variant="ghost">
          <Collapsible.Trigger>
            <span
              style={{
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {language.t("settings.providers.disabled")}
            </span>
            <Collapsible.Arrow />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Card style={{ "margin-top": "8px" }}>
              <div
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  "padding-bottom": "8px",
                  "border-bottom": "1px solid var(--border-weak-base)",
                }}
              >
                {language.t("settings.providers.disabled.description")}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  padding: "8px 0",
                  "border-bottom": disabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ flex: 1 }}>
                  <Select
                    options={disabledOptions()}
                    current={disabledChoice()}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => setDisabledChoice(item)}
                    variant="secondary"
                    triggerVariant="settings"
                    placeholder={language.t("settings.providers.select.placeholder")}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const item = disabledChoice()
                    if (!item) return
                    disableProvider(item.value)
                    setDisabledChoice(undefined)
                  }}
                  disabled={!disabledChoice()}
                >
                  {language.t("common.add")}
                </Button>
              </div>
              <For each={disabledProviders()}>
                {(item, index) => (
                  <div
                    style={{
                      display: "flex",
                      "flex-wrap": "wrap",
                      "align-items": "center",
                      "justify-content": "space-between",
                      gap: "16px",
                      "min-height": "56px",
                      padding: "12px 0",
                      "border-bottom":
                        index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
                      <Tag>{language.t("settings.providers.disabled")}</Tag>
                    </div>
                    <Button size="large" variant="ghost" onClick={() => enableProvider(item.id)}>
                      {language.t("settings.providers.disabled.enable")}
                    </Button>
                  </div>
                )}
              </For>
            </Card>
          </Collapsible.Content>
        </Collapsible>
      </div>
    </div>
  )
}

export default ProvidersTab
