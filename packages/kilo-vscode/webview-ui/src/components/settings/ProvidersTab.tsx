import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, Provider } from "../../types/messages"
import DeviceAuthCard from "../profile/DeviceAuthCard"
import { providerSortKey } from "../shared/model-selector-utils"
import ProviderConnectDialog from "./ProviderConnectDialog"
import ProviderSelector, { type ProviderOption } from "./ProviderSelector"

function sortProviders(items: Provider[]) {
  return items.slice().sort((a, b) => {
    const rank = providerSortKey(a.id) - providerSortKey(b.id)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const server = useServer()
  const language = useLanguage()
  const dialog = useDialog()
  const vscode = useVSCode()

  const [newConnected, setNewConnected] = createSignal<ProviderOption | undefined>()
  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [disconnecting, setDisconnecting] = createSignal(new Set<string>())

  const disabledProviders = () => config().disabled_providers ?? []

  const connectedProviders = createMemo(() =>
    sortProviders(
      provider
        .connected()
        .map((id) => provider.providers()[id])
        .filter((item): item is NonNullable<typeof item> => !!item),
    ),
  )

  const providerOptions = createMemo<ProviderOption[]>(() =>
    sortProviders(Object.values(provider.providers())).map((item) => ({ value: item.id, label: item.name })),
  )

  const kilo = createMemo<Provider>(() => {
    return (
      provider.providers().kilo ?? {
        id: "kilo",
        name: "Kilo Gateway",
        source: "custom",
        env: ["KILO_API_KEY"],
        models: {},
      }
    )
  })
  const kiloConnected = createMemo(() => provider.connected().includes("kilo"))

  const availableOptions = createMemo(() => {
    const connected = new Set(provider.connected())
    const disabled = new Set(disabledProviders())
    return providerOptions().filter(
      (item) => !connected.has(item.value) && !disabled.has(item.value) && item.value !== "kilo",
    )
  })

  const disabledOptions = createMemo(() =>
    providerOptions().filter((item) => !disabledProviders().includes(item.value)),
  )

  const pendingDisconnects = new Map<string, { providerID: string; name: string }>()

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "providerDisconnected") {
      const pending = pendingDisconnects.get(message.requestId)
      if (!pending) return
      pendingDisconnects.delete(message.requestId)
      setDisconnecting((prev) => {
        const next = new Set(prev)
        next.delete(pending.providerID)
        return next
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.disconnect.toast.disconnected.title", { provider: pending.name }),
        description: language.t("provider.disconnect.toast.disconnected.description", { provider: pending.name }),
      })
      return
    }

    if (message.type === "providerActionError" && message.action === "disconnect") {
      const pending = pendingDisconnects.get(message.requestId)
      if (!pending) return
      pendingDisconnects.delete(message.requestId)
      setDisconnecting((prev) => {
        const next = new Set(prev)
        next.delete(pending.providerID)
        return next
      })
      showToast({
        title: language.t("common.requestFailed"),
        description: message.message,
      })
    }
  })

  onCleanup(unsubscribe)

  function addDisabled(value: string) {
    const current = [...disabledProviders()]
    if (!value || current.includes(value)) return
    current.push(value)
    updateConfig({ disabled_providers: current })
  }

  function hide(item: Provider) {
    addDisabled(item.id)
  }

  function removeDisabled(index: number) {
    const current = [...disabledProviders()]
    current.splice(index, 1)
    updateConfig({ disabled_providers: current })
  }

  function disconnect(item: Provider) {
    const requestId = crypto.randomUUID()
    pendingDisconnects.set(requestId, { providerID: item.id, name: item.name })
    setDisconnecting((prev) => new Set(prev).add(item.id))
    vscode.postMessage({ type: "disconnectProvider", requestId, providerID: item.id })
  }

  function type(item: Provider) {
    const auth = provider.authStates()[item.id]
    if (item.id === "kilo") return language.t("settings.providers.tag.gateway")
    if (item.source === "env") return language.t("settings.providers.tag.environment")
    if (auth === "oauth") return language.t("settings.providers.tag.oauth")
    if (auth === "api") return language.t("provider.connect.method.apiKey")
    if (item.source === "config") return language.t("settings.providers.tag.configured")
    if (item.source === "custom") return language.t("settings.providers.tag.customProvider")
    return language.t("settings.providers.tag.connected")
  }

  function canDisconnect(item: Provider) {
    return item.source !== "env"
  }

  function canHide(item: Provider) {
    return item.id !== "kilo" && item.source === "env"
  }

  function openConnectDialog() {
    const item = newConnected()
    if (!item) return
    dialog.show(() => <ProviderConnectDialog providerID={item.value} />)
    setNewConnected(undefined)
  }

  function cancelKiloLogin() {
    vscode.postMessage({ type: "cancelLogin" })
  }

  return (
    <div>
      <Show when={!kiloConnected()}>
        <h4 style={{ "margin-bottom": "8px" }}>{kilo().name}</h4>
        <Show
          when={server.deviceAuth().status !== "idle"}
          fallback={
            <Card>
              <div
                style={{ display: "flex", "justify-content": "space-between", gap: "12px", "align-items": "center" }}
              >
                <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                  <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                    <span style={{ "font-size": "12px", "font-weight": "500" }}>{kilo().name}</span>
                    <span
                      style={{
                        "font-size": "11px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        padding: "2px 6px",
                        border: "1px solid var(--border-weak-base)",
                        "border-radius": "999px",
                      }}
                    >
                      {language.t("settings.providers.tag.gateway")}
                    </span>
                  </div>
                  <span
                    style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}
                  >
                    {language.t("profile.notLoggedIn")}
                  </span>
                </div>
                <Button variant="primary" size="small" onClick={server.startLogin}>
                  {language.t("profile.action.login")}
                </Button>
              </div>
            </Card>
          }
        >
          <DeviceAuthCard
            status={server.deviceAuth().status}
            code={server.deviceAuth().code}
            verificationUrl={server.deviceAuth().verificationUrl}
            expiresIn={server.deviceAuth().expiresIn}
            error={server.deviceAuth().error}
            onCancel={cancelKiloLogin}
            onRetry={server.startLogin}
          />
        </Show>
      </Show>

      <h4 style={{ "margin-bottom": "8px" }}>{language.t("settings.providers.section.connected")}</h4>
      <Card>
        <Show
          when={connectedProviders().length > 0}
          fallback={
            <div style={{ "font-size": "12px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
              {language.t("settings.providers.connected.empty")}
            </div>
          }
        >
          <For each={connectedProviders()}>
            {(item, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "12px",
                  padding: "8px 0",
                  "border-bottom":
                    index() < connectedProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "min-width": 0 }}>
                  <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                    <span style={{ "font-size": "12px", "font-weight": "500" }}>{item.name}</span>
                    <span
                      style={{
                        "font-size": "11px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        padding: "2px 6px",
                        border: "1px solid var(--border-weak-base)",
                        "border-radius": "999px",
                      }}
                    >
                      {type(item)}
                    </span>
                  </div>
                  <span
                    style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}
                  >
                    {item.id}
                  </span>
                </div>
                <Show
                  when={canDisconnect(item)}
                  fallback={
                    <Show when={canHide(item)}>
                      <Button variant="ghost" size="small" onClick={() => hide(item)}>
                        {language.t("settings.providers.action.hideModels")}
                      </Button>
                    </Show>
                  }
                >
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={disconnecting().has(item.id)}
                    onClick={() => disconnect(item)}
                  >
                    {language.t("common.disconnect")}
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Card>

      <Show when={availableOptions().length > 0}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("common.connect")}</h4>
        <Card>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <div style={{ flex: 1 }}>
              <ProviderSelector
                options={availableOptions()}
                value={newConnected()}
                onSelect={(item) => setNewConnected(item)}
              />
            </div>
            <Button variant="secondary" onClick={openConnectDialog} disabled={!newConnected()}>
              {language.t("common.connect")}
            </Button>
          </div>
        </Card>
      </Show>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.disabled")}</h4>
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
          {(id, index) => {
            const item = providerOptions().find((option) => option.value === id)
            return (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "6px 0",
                  "border-bottom":
                    index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                  <span style={{ "font-size": "12px" }}>{item?.label ?? id}</span>
                  <Show when={item?.label && item.value !== item.label}>
                    <span
                      style={{
                        "font-size": "11px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                      }}
                    >
                      {id}
                    </span>
                  </Show>
                </div>
                <IconButton variant="ghost" icon="close" onClick={() => removeDisabled(index())} />
              </div>
            )
          }}
        </For>
      </Card>
    </div>
  )
}

export default ProvidersTab
