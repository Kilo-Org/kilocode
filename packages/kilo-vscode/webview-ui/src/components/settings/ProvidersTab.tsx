import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { Provider } from "../../types/messages"
import DeviceAuthCard from "../profile/DeviceAuthCard"
import CustomProviderDialog from "./CustomProviderDialog"
import ProviderConnectDialog from "./ProviderConnectDialog"
import ProviderSelectDialog from "./ProviderSelectDialog"
import {
  CUSTOM_PROVIDER_ID,
  isPopularProvider,
  kiloFallbackProvider,
  providerIcon,
  providerNoteKey,
  sortProviders,
} from "./provider-catalog"
import { visibleConnectedIds } from "./provider-visibility"
import ProviderSelector, { type ProviderOption } from "./ProviderSelector"
import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { createProviderAction } from "../../utils/provider-action"

type ProviderSource = "env" | "api" | "config" | "custom"

const ProvidersTab: Component = () => {
  const dialog = useDialog()
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const server = useServer()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)

  onCleanup(action.dispose)

  // Optimistic local state for disabled_providers — applies immediately,
  // cleared back to null when the server-confirmed config arrives so the
  // signal falls through to the authoritative value.
  const [pendingDisabled, setPendingDisabled] = createSignal<string[] | null>(null)
  createEffect(() => {
    config().disabled_providers
    setPendingDisabled(null)
  })
  const effectiveDisabled = () => pendingDisabled() ?? config().disabled_providers ?? []

  const connectedProviders = createMemo(() => {
    const ids = visibleConnectedIds(provider.connected(), provider.authStates())
    const all = provider.providers()
    return ids.map((id) => all[id]).filter((item): item is Provider => !!item)
  })

  const popularProviders = createMemo(() => {
    const connected = new Set(provider.connected())
    const disabled = new Set(effectiveDisabled())
    const all = Object.values(provider.providers())
    const withKilo = all.some((item) => item.id === KILO_PROVIDER_ID) ? all : [kiloFallbackProvider(), ...all]
    const available = withKilo.filter(
      (item) => isPopularProvider(item.id) && !connected.has(item.id) && !disabled.has(item.id),
    )
    return sortProviders(available)
  })

  const disabledProviders = createMemo(() => {
    const ids = effectiveDisabled()
    const all = provider.providers()
    return ids.map((id) => all[id] ?? { id, name: id, models: {} })
  })

  const providerOptions = createMemo<ProviderOption[]>(() =>
    sortProviders(Object.values(provider.providers())).map((item) => ({ value: item.id, label: item.name })),
  )

  const disabledOptions = createMemo(() =>
    providerOptions().filter((item) => !effectiveDisabled().includes(item.value)),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()

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
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  function canDisconnect(item: Provider) {
    return source(item) !== "env"
  }

  function isConfigCustom(providerID: string) {
    const cfg = config().provider?.[providerID]
    if (!cfg) return false
    if (cfg.npm !== "@ai-sdk/openai-compatible") return false
    if (!cfg.models || Object.keys(cfg.models).length === 0) return false
    return true
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

  function connectProvider(item: Provider) {
    if (item.id === KILO_PROVIDER_ID) {
      server.startLogin()
      return
    }
    dialog.show(() => <ProviderConnectDialog providerID={item.id} />)
  }

  function addDisabled(value: string) {
    const current = effectiveDisabled()
    if (!value || current.includes(value)) return
    const next = [...current, value]
    setPendingDisabled(next)
    updateConfig({ disabled_providers: next })
  }

  function removeDisabled(providerID: string) {
    const next = effectiveDisabled().filter((id) => id !== providerID)
    setPendingDisabled(next)
    updateConfig({ disabled_providers: next })
  }

  return (
    <div>
      {/* Connected providers */}
      <h4 style={{ "margin-bottom": "8px" }}>{language.t("settings.providers.section.connected")}</h4>
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
                <Show
                  when={canDisconnect(item)}
                  fallback={
                    <span
                      style={{
                        "font-size": "14px",
                        color: "var(--text-base, var(--vscode-descriptionForeground))",
                        "padding-right": "12px",
                      }}
                    >
                      {language.t("settings.providers.connected.environmentDescription")}
                    </span>
                  }
                >
                  <Button size="large" variant="ghost" onClick={() => disconnect(item.id, item.name)}>
                    {language.t("common.disconnect")}
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Card>

      {/* Device auth card for Kilo login */}
      <Show when={server.deviceAuth().status !== "idle"}>
        <div style={{ "margin-top": "16px" }}>
          <DeviceAuthCard
            status={server.deviceAuth().status}
            code={server.deviceAuth().code}
            verificationUrl={server.deviceAuth().verificationUrl}
            expiresIn={server.deviceAuth().expiresIn}
            error={server.deviceAuth().error}
            onCancel={() => vscode.postMessage({ type: "cancelLogin" })}
            onRetry={() => server.startLogin()}
          />
        </div>
      </Show>

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
                    <Show when={item.id === KILO_PROVIDER_ID}>
                      <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                    </Show>
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
            onClick={() => {
              dialog.show(() => <CustomProviderDialog />)
            }}
          >
            {language.t("common.connect")}
          </Button>
        </div>
      </Card>

      {/* View all providers link */}
      <div style={{ "margin-top": "16px" }}>
        <Button
          variant="ghost"
          onClick={() => {
            dialog.show(() => <ProviderSelectDialog />)
          }}
          style={{ padding: "0" }}
        >
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
            <ProviderSelector
              options={disabledOptions()}
              value={newDisabled()}
              onSelect={(item) => setNewDisabled(item)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              const item = newDisabled()
              if (!item) return
              addDisabled(item.value)
              setNewDisabled(undefined)
            }}
          >
            {language.t("common.add")}
          </Button>
        </div>
        <For each={disabledProviders()}>
          {(item, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 0",
                "border-bottom":
                  index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                <ProviderIcon id={providerIcon(item.id)} width={16} height={16} />
                <span style={{ "font-size": "12px" }}>{item.name}</span>
              </div>
              <IconButton variant="ghost" icon="close" onClick={() => removeDisabled(item.id)} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ProvidersTab
