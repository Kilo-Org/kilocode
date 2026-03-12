import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Component, For, JSX, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, Provider } from "../../types/messages"
import DeviceAuthCard from "../profile/DeviceAuthCard"
import CustomProviderDialog from "./CustomProviderDialog"
import ProviderConnectDialog from "./ProviderConnectDialog"
import {
  CUSTOM_PROVIDER_ID,
  POPULAR_PROVIDER_IDS,
  providerIcon,
  providerNoteKey,
  sortProviders,
} from "./provider-catalog"
import ProviderSelector, { type ProviderOption } from "./ProviderSelector"
import ProviderSelectDialog from "./ProviderSelectDialog"

type ProviderSource = "env" | "api" | "config" | "custom"

const kiloFallback: Provider = {
  id: "kilo",
  name: "Kilo Gateway",
  source: "custom",
  env: ["KILO_API_KEY"],
  models: {},
}

function ProviderGlyph(props: { id: string }): JSX.Element {
  if (props.id === "kilo") {
    return (
      <div
        style={{
          width: "20px",
          height: "20px",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "border-radius": "6px",
          background: "var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background))",
          color: "var(--vscode-foreground)",
          "font-size": "12px",
          "font-weight": "700",
          "flex-shrink": 0,
        }}
      >
        K
      </div>
    )
  }

  return <ProviderIcon id={providerIcon(props.id)} width={20} height={20} />
}

function rowStyle(bordered: boolean) {
  return {
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "16px",
    padding: "14px 0",
    "border-bottom": bordered ? "1px solid var(--border-weak-base)" : "none",
  } as const
}

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const server = useServer()
  const language = useLanguage()
  const dialog = useDialog()
  const vscode = useVSCode()

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

  const kilo = createMemo<Provider>(() => provider.providers().kilo ?? kiloFallback)
  const kiloConnected = createMemo(() => provider.connected().includes("kilo"))
  const showKiloAuth = createMemo(() => !kiloConnected() && server.deviceAuth().status !== "idle")

  const popularProviders = createMemo(() => {
    const connected = new Set(provider.connected())
    const disabled = new Set(disabledProviders())
    return POPULAR_PROVIDER_IDS.map((id) => (id === "kilo" ? kilo() : provider.providers()[id]))
      .filter((item): item is Provider => !!item)
      .filter((item) => !connected.has(item.id) && !disabled.has(item.id))
      .filter((item) => !(showKiloAuth() && item.id === "kilo"))
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
        description: disconnectDescription(pending.providerID, pending.name),
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

  function source(item: Provider): ProviderSource | undefined {
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  function type(item: Provider) {
    const current = source(item)
    const auth = provider.authStates()[item.id]
    if (item.id === "kilo") return language.t("settings.providers.tag.gateway")
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (auth === "oauth") return language.t("settings.providers.tag.oauth")
    if (auth === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") return language.t("settings.providers.tag.configured")
    if (current === "custom") return language.t("settings.providers.tag.customProvider")
    return language.t("settings.providers.tag.connected")
  }

  function canDisconnect(item: Provider) {
    return source(item) !== "env"
  }

  function canHide(item: Provider) {
    return item.id !== "kilo" && source(item) === "env"
  }

  function addDisabled(value: string) {
    const current = [...disabledProviders()]
    if (!value || current.includes(value)) return
    current.push(value)
    updateConfig({ disabled_providers: current })
  }

  function removeDisabled(index: number) {
    const current = [...disabledProviders()]
    current.splice(index, 1)
    updateConfig({ disabled_providers: current })
  }

  function hide(item: Provider) {
    addDisabled(item.id)
  }

  function disconnect(item: Provider) {
    const requestId = crypto.randomUUID()
    pendingDisconnects.set(requestId, { providerID: item.id, name: item.name })
    setDisconnecting((prev) => new Set(prev).add(item.id))
    vscode.postMessage({ type: "disconnectProvider", requestId, providerID: item.id })
  }

  function disconnectDescription(providerID: string, name: string) {
    if (providerID === "kilo") {
      return language.t("provider.disconnect.toast.disconnected.description.kilo", { provider: name })
    }
    return language.t("provider.disconnect.toast.disconnected.description", { provider: name })
  }

  function providerNote(providerID: string) {
    const key = providerNoteKey(providerID)
    if (!key) return undefined
    return language.t(key)
  }

  function openPopular(item: Provider) {
    if (item.id === "kilo") {
      server.startLogin()
      return
    }
    dialog.show(() => <ProviderConnectDialog providerID={item.id} />)
  }

  function openCustom() {
    dialog.show(() => <CustomProviderDialog />)
  }

  function openAllProviders() {
    dialog.show(() => <ProviderSelectDialog />)
  }

  function renderProviderRow(item: Provider, bordered: boolean, action: JSX.Element) {
    return (
      <div style={rowStyle(bordered)}>
        <div style={{ display: "flex", gap: "12px", "align-items": "center", "min-width": 0, flex: 1 }}>
          <ProviderGlyph id={item.id} />
          <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap", "min-width": 0 }}>
            <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
              {item.name}
            </span>
            <Tag>{type(item)}</Tag>
          </div>
        </div>
        {action}
      </div>
    )
  }

  function renderPopularRow(item: Provider, bordered: boolean) {
    return (
      <div style={rowStyle(bordered)}>
        <div style={{ display: "flex", gap: "12px", "align-items": "center", "min-width": 0, flex: 1 }}>
          <ProviderGlyph id={item.id} />
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "min-width": 0 }}>
            <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
              <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
                {item.name}
              </span>
              <Show when={item.id === "kilo"}>
                <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
              </Show>
            </div>
            <Show when={providerNote(item.id)}>
              {(note) => (
                <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>{note()}</span>
              )}
            </Show>
          </div>
        </div>
        <Button variant="secondary" size="small" onClick={() => openPopular(item)}>
          <span style={{ display: "flex", gap: "6px", "align-items": "center" }}>
            <Icon name="plus-small" size="small" />
            {language.t("common.connect")}
          </span>
        </Button>
      </div>
    )
  }

  return (
    <div>
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
            {(item, index) =>
              renderProviderRow(
                item,
                index() < connectedProviders().length - 1,
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
                </Show>,
              )
            }
          </For>
        </Show>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
        {language.t("settings.providers.section.popular")}
      </h4>
      <Show when={showKiloAuth()}>
        <div style={{ "margin-bottom": "12px" }}>
          <DeviceAuthCard
            status={server.deviceAuth().status}
            code={server.deviceAuth().code}
            verificationUrl={server.deviceAuth().verificationUrl}
            expiresIn={server.deviceAuth().expiresIn}
            error={server.deviceAuth().error}
            onCancel={() => vscode.postMessage({ type: "cancelLogin" })}
            onRetry={server.startLogin}
          />
        </div>
      </Show>
      <Card>
        <For each={popularProviders()}>
          {(item, index) => renderPopularRow(item, index() < popularProviders().length)}
        </For>

        <div style={rowStyle(false)}>
          <div style={{ display: "flex", gap: "12px", "align-items": "center", "min-width": 0, flex: 1 }}>
            <ProviderGlyph id={CUSTOM_PROVIDER_ID} />
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "min-width": 0 }}>
              <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
                  {language.t("settings.providers.tag.customProvider")}
                </span>
                <Tag>{language.t("settings.providers.tag.custom")}</Tag>
              </div>
              <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                {language.t("settings.providers.custom.note")}
              </span>
            </div>
          </div>
          <Button variant="secondary" size="small" onClick={openCustom}>
            <span style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <Icon name="plus-small" size="small" />
              {language.t("common.connect")}
            </span>
          </Button>
        </div>
      </Card>

      <Button
        variant="secondary"
        size="small"
        style={{ margin: "12px 0 0", "justify-content": "flex-start" }}
        onClick={openAllProviders}
      >
        <span style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <Icon name="plus-small" size="small" />
          {language.t("settings.providers.action.addProvider")}
        </span>
      </Button>

      {/* Beta notice */}
      <Card
        variant="warning"
        style={{
          "margin-top": "16px",
          display: "flex",
          "flex-direction": "row",
          "align-items": "flex-start",
          gap: "8px",
        }}
      >
        <Icon name="warning" style={{ "flex-shrink": "0", "margin-top": "2px" }} />
        <p style={{ margin: 0, "line-height": "1.5" }}>{language.t("settings.providers.betaNotice")}</p>
      </Card>

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
