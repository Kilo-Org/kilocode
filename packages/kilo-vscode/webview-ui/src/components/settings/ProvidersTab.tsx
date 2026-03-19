import { Component, For, createSignal, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { ModelSelectorBase } from "../shared/ModelSelector"
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
  const session = useSession()

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.keys(provider.providers())
      .sort()
      .map((id) => ({ value: id, label: id })),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()

  const disabledProviders = () => config().disabled_providers ?? []

  const addDisabled = (value: string) => {
    const current = [...disabledProviders()]
    if (value && !current.includes(value)) {
      current.push(value)
      updateConfig({ disabled_providers: current })
    }
  }

  const removeDisabled = (index: number) => {
    const current = [...disabledProviders()]
    current.splice(index, 1)
    updateConfig({ disabled_providers: current })
  }

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: null })
      } else {
        updateConfig({ [configKey]: `${providerID}/${modelID}` })
      }
    }
  }

  const allAgents = createMemo(() => session.agents())

  function handleModeModelSelect(agentName: string) {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ agent: { [agentName]: { model: null } } })
      } else {
        updateConfig({ agent: { [agentName]: { model: `${providerID}/${modelID}` } } })
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
            value={parseModelConfig(config().model ?? undefined)}
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
            value={parseModelConfig(config().small_model ?? undefined)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
            includeAutoSmall
          />
        </SettingsRow>
      </Card>

      {/* Model per Mode */}
      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>{language.t("settings.providers.modeModels")}</h4>
      <Card>
        <For each={allAgents()}>
          {(agent, index) => (
            <SettingsRow
              title={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
              last={index() === allAgents().length - 1}
            >
              <ModelSelectorBase
                value={parseModelConfig(config().agent?.[agent.name]?.model ?? undefined)}
                onSelect={handleModeModelSelect(agent.name)}
                placement="bottom-start"
                allowClear
                clearLabel={language.t("settings.providers.notSet")}
              />
            </SettingsRow>
          )}
        </For>
      </Card>

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

      {/* Disabled providers */}
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
            <Select
              options={providerOptions().filter((o) => !disabledProviders().includes(o.value))}
              current={newDisabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewDisabled(o)}
              variant="secondary"
              triggerVariant="settings"
              placeholder="Select provider…"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              if (newDisabled()) {
                addDisabled(newDisabled()!.value)
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
              <IconButton variant="ghost" icon="close" onClick={() => removeDisabled(index())} />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ProvidersTab
