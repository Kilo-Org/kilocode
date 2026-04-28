import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { Provider } from "../../types/messages"
import CustomProviderDialog from "./CustomProviderDialog"
import ProviderConnectDialog from "./ProviderConnectDialog"
import ProviderSelectDialog from "./ProviderSelectDialog"
import { CUSTOM_PROVIDER_ID, isPopularProvider, providerIcon, providerNoteKey, sortProviders } from "./provider-catalog"
import { disabledProviderOptions, providersWithKiloFallback, visibleConnectedIds } from "./provider-visibility"
import { KILO_PROVIDER_ID, CUSTOM_PROVIDER_PACKAGE } from "../../../../src/shared/provider-model"
import { createProviderAction } from "../../utils/provider-action"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderOption = { value: string; label: string }

const ProvidersTab: Component = () => {
  const dialog = useDialog()
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const server = useServer()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  const [disabled, setDisabled] = createSignal<ProviderOption | undefined>()

  onCleanup(action.dispose)

  const kiloLoggedIn = createMemo(() => !!server.profileData())

  const connectedProviders = createMemo(() => {
    const ids = visibleConnectedIds(provider.connected(), provider.authStates())
    const all = provider.providers()
    return ids
      .filter((id) => id !== KILO_PROVIDER_ID)
      .map((id) => all[id])
      .filter((item): item is Provider => !!item)
  })

  const popularProviders = createMemo(() => {
    const connected = new Set(provider.connected())
    const disabled = new Set(config().disabled_providers ?? [])
    const all = Object.values(provider.providers())
    return sortProviders(
      all.filter(
        (item) =>
          item.id !== KILO_PROVIDER_ID &&
          isPopularProvider(item.id) &&
          !connected.has(item.id) &&
          !disabled.has(item.id),
      ),
    )
  })

  const disabledProviders = createMemo(() => config().disabled_providers ?? [])
  const disabledIds = createMemo(() => new Set(disabledProviders()))
  const providers = createMemo(() => providersWithKiloFallback(provider.providers()))
  const disabledOptions = createMemo(() => disabledProviderOptions(providers(), disabledProviders()))

  function source(item: Provider): ProviderSource | undefined {
    if (!("source" in item)) return
    const value = (item as Provider & { source?: string }).source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  function sourceTag(item: Provider) {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      const cfg = config().provider?.[item.id]
      if (cfg?.npm === "@ai-sdk/openai-compatible") return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (item.id === "openai" && current === "custom") return language.t("settings.providers.tag.chatgpt")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  function canDisconnect(item: Provider) {
    return source(item) !== "env"
  }

  function isCustom(item: Provider) {
    const cfg = config().provider?.[item.id]
    return cfg?.npm === CUSTOM_PROVIDER_PACKAGE
  }

  function editProvider(item: Provider) {
    const cfg = config().provider?.[item.id]
    if (!cfg) return
    dialog.show(() => <CustomProviderDialog existing={{ providerID: item.id, name: item.name, config: cfg }} />)
  }

  function disconnect(providerID: string, name: string) {
    action.send(
      { type: "disconnectProvider", providerID },
      {
        onDisconnected: () => {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
            description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
          })
        },
        onError: (message) => {
          showToast({ title: language.t("common.requestFailed"), description: message.message })
        },
      },
    )
  }

  function disableProvider(providerID: string) {
    const current = disabledProviders()
    if (!providerID || current.includes(providerID)) return
    updateConfig({ disabled_providers: [...current, providerID] })
  }

  function enableProvider(index: number) {
    const next = [...disabledProviders()]
    next.splice(index, 1)
    updateConfig({ disabled_providers: next })
  }

  function disabledName(id: string) {
    const item = providers()[id]
    return item?.name ?? id
  }

  function connectProvider(item: Provider) {
    if (item.id === KILO_PROVIDER_ID) {
      server.startLogin()
      return
    }
    dialog.show(() => <ProviderConnectDialog providerID={item.id} />)
  }

  function connectChatGPT(item: Provider) {
    dialog.show(() => <ProviderConnectDialog providerID={item.id} oauthOnly />)
  }

  function chatgpt(item: Provider) {
    if (item.id !== "openai") return false
    if (source(item) === "custom") return false
    return (provider.authMethods()[item.id] ?? []).some((method) => method.type === "oauth")
  }

  return (
    <div>
      <Show when={!disabledIds().has(KILO_PROVIDER_ID)}>
        {/* Kilo Gateway — always at the top, not editable */}
        <Card>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "12px",
              "min-height": "56px",
              padding: "12px 0",
            }}
          >
            <ProviderIcon id="synthetic" width={20} height={20} />
            <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
              Kilo Gateway
            </span>
            <Show
              when={kiloLoggedIn()}
              fallback={
                <Button size="small" variant="secondary" onClick={() => server.startLogin()}>
                  {language.t("common.signIn")}
                </Button>
              }
            >
              <Tag>{language.t("settings.providers.tag.gateway")}</Tag>
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
          when={connectedProviders().length > 0}
          fallback={
            <div
              style={{
                padding: "16px 0",
                "font-size": "14px",
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
                      "font-size": "14px",
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
                        "font-size": "14px",
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
                    <Show when={isCustom(item)}>
                      <Button size="large" variant="ghost" onClick={() => editProvider(item)}>
                        {language.t("provider.custom.edit.title")}
                      </Button>
                    </Show>
                    <Button size="large" variant="ghost" onClick={() => disconnect(item.id, item.name)}>
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
                    <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
                      {item.name}
                    </span>
                  </div>
                  <Show when={noteKey}>
                    {(key) => (
                      <span
                        style={{
                          "font-size": "12px",
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
          }}
        >
          <div style={{ display: "flex", "flex-direction": "column", "min-width": 0 }}>
            <div style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "12px" }}>
              <ProviderIcon id="synthetic" width={20} height={20} />
              <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
                {language.t("provider.custom.title")}
              </span>
              <Tag>{language.t("settings.providers.tag.custom")}</Tag>
            </div>
            <span
              style={{
                "font-size": "12px",
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
            onClick={() => dialog.show(() => <CustomProviderDialog />)}
          >
            {language.t("common.connect")}
          </Button>
        </div>
      </Card>

      {/* View all providers link */}
      <div style={{ "margin-top": "16px" }}>
        <Button variant="ghost" onClick={() => dialog.show(() => <ProviderSelectDialog />)} style={{ padding: "0" }}>
          {language.t("dialog.provider.viewAll")}
        </Button>
      </div>

      {/* Disabled providers */}
      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>{language.t("settings.providers.disabled")}</h4>
      <Card>
        <div
          style={{
            "font-size": "12px",
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
              current={disabled()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setDisabled(item)}
              variant="secondary"
              triggerVariant="settings"
              placeholder={language.t("settings.providers.select.placeholder")}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              const item = disabled()
              if (!item) return
              disableProvider(item.value)
              setDisabled(undefined)
            }}
            disabled={!disabled()}
          >
            {language.t("common.add")}
          </Button>
        </div>
        <For each={disabledProviders()}>
          {(id, index) => (
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
                <ProviderIcon id={providerIcon(id)} width={20} height={20} />
                <span
                  style={{
                    "font-size": "14px",
                    "font-weight": "500",
                    color: "var(--vscode-foreground)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                >
                  {disabledName(id)}
                </span>
                <Tag>{language.t("settings.providers.disabled")}</Tag>
              </div>
              <Button size="large" variant="ghost" onClick={() => enableProvider(index())}>
                {language.t("common.delete")}
              </Button>
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ProvidersTab
