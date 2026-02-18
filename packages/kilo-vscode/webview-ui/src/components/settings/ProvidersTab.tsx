import { Component, For, createSignal, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { ModelSelectorBase } from "../chat/ModelSelector"
import type { ModelSelection } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface ProviderOption {
  value: string
  label: string
}

/** Parse a "provider/model" config string into a ModelSelection (or null). */
function parseModelConfig(raw: string | undefined): ModelSelection | null {
  if (!raw) {
    return null
  }
  const slash = raw.indexOf("/")
  if (slash <= 0) {
    return null
  }
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.keys(provider.providers())
      .sort()
      .map((id) => ({ value: id, label: id })),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<ProviderOption | undefined>()

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []

  const addToList = (key: "disabled_providers" | "enabled_providers", value: string) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    if (value && !current.includes(value)) {
      current.push(value)
      updateConfig({ [key]: current })
    }
  }

  const removeFromList = (key: "disabled_providers" | "enabled_providers", index: number) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    current.splice(index, 1)
    updateConfig({ [key]: current })
  }

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: undefined })
      } else {
        updateConfig({ [configKey]: `${providerID}/${modelID}` })
      }
    }
  }

  return (
    <div>
      {/* Model selection */}
      <Card>
        <SettingsRow
          title={language.t("settings.providers.defaultModel.title")}
          description={language.t("settings.providers.defaultModel.description")}
        >
          <ModelSelectorBase
            value={parseModelConfig(config().model)}
            onSelect={handleModelSelect("model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.smallModel.title")}
          description={language.t("settings.providers.smallModel.description")}
          last
        >
          <ModelSelectorBase
            value={parseModelConfig(config().small_model)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
      </Card>

      {/* Disabled providers */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.disabled")}</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
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
              options={providerOptions().filter((o) => !disabledProviders().includes(o.value))}
              current={newDisabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewDisabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder="Select provider…"
            />
          </div>
          <Button
            size="small"
            onClick={() => {
              if (newDisabled()) {
                addToList("disabled_providers", newDisabled()!.value)
                setNewDisabled(undefined)
              }
            }}
          >
            {language.t("common.add")}
          </Button>
        </div>
        <For each={disabledProviders()}>
          {(id, index) => (
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
              <span style={{ "font-size": "12px" }}>{id}</span>
              <IconButton
                size="small"
                variant="ghost"
                icon="close"
                onClick={() => removeFromList("disabled_providers", index())}
              />
            </div>
          )}
        </For>
      </Card>

      {/* Enabled providers (allowlist) */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.enabled")}</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          {language.t("settings.providers.enabled.description")}
        </div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": enabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <Select
              options={providerOptions().filter((o) => !enabledProviders().includes(o.value))}
              current={newEnabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewEnabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder="Select provider…"
            />
          </div>
          <Button
            size="small"
            onClick={() => {
              if (newEnabled()) {
                addToList("enabled_providers", newEnabled()!.value)
                setNewEnabled(undefined)
              }
            }}
          >
            {language.t("common.add")}
          </Button>
        </div>
        <For each={enabledProviders()}>
          {(id, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span style={{ "font-size": "12px" }}>{id}</span>
              <IconButton
                size="small"
                variant="ghost"
                icon="close"
                onClick={() => removeFromList("enabled_providers", index())}
              />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ProvidersTab
