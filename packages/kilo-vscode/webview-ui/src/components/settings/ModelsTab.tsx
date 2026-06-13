import { Component, For, Show, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useSession } from "../../context/session"
import { parseModelString } from "../../../../src/shared/provider-model"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { ThinkingSelectorBase } from "../shared/ThinkingSelector"
import SettingsRow from "./SettingsRow"
import { AUTOCOMPLETE_SELECTOR_MODELS, getAutocompleteSelection } from "./autocomplete-model-selector"

const ModelsTab: Component = () => {
  const { config, settings, updateConfig, updateSetting } = useConfig()
  const language = useLanguage()
  const provider = useProvider()
  const session = useSession()

  const autocompleteProvider = () => {
    const v = settings()["autocomplete.provider"]
    return typeof v === "string" ? v : undefined
  }
  const autocompleteModel = () => {
    const v = settings()["autocomplete.model"]
    return typeof v === "string" ? v : undefined
  }

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: null })
        return
      }
      updateConfig({ [configKey]: `${providerID}/${modelID}` })
    }
  }

  const subagentModel = createMemo(() => parseModelString(config().subagent_model ?? undefined))
  const variantKey = createMemo(() => config().subagent_model ?? undefined)
  const subagentVariants = createMemo(() => Object.keys(provider.findModel(subagentModel())?.variants ?? {}))
  const subagentVariant = createMemo(() => {
    const key = variantKey()
    if (!key) return undefined
    const value = config().subagent_variant_overrides?.[key]
    if (value) return value
    return config().subagent_model === key ? (config().subagent_variant ?? undefined) : undefined
  })

  function handleSubagentModelSelect(providerID: string, modelID: string) {
    if (!providerID || !modelID) {
      updateConfig({ subagent_model: null, subagent_variant: null })
      return
    }
    const value = `${providerID}/${modelID}`
    updateConfig({
      subagent_model: value,
      ...(config().subagent_model === value ? {} : { subagent_variant: null }),
    })
  }

  function updateSubagentVariant(value: string | null) {
    const key = variantKey()
    if (!key) return
    updateConfig({
      subagent_variant_overrides: { [key]: value },
      ...(config().subagent_model === key ? { subagent_variant: null } : {}),
    })
  }

  const allAgents = createMemo(() => session.agents())

  function handleModeModelSelect(agentName: string) {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ agent: { [agentName]: { model: null } } })
        return
      }
      updateConfig({ agent: { [agentName]: { model: `${providerID}/${modelID}` } } })
    }
  }

  function handleAutocompleteModelSelect(providerID: string, modelID: string) {
    if (!providerID || !modelID) {
      // Clearing both keys reverts to the resolved server-side default. Users
      // who pick "Not set" follow future default changes automatically.
      updateSetting("autocomplete.provider", null)
      updateSetting("autocomplete.model", null)
      return
    }
    updateSetting("autocomplete.provider", providerID)
    updateSetting("autocomplete.model", modelID)
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.providers.defaultModel.title")}
          description={language.t("settings.providers.defaultModel.description")}
        >
          <ModelSelectorBase
            value={parseModelString(config().model ?? undefined)}
            onSelect={handleModelSelect("model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
            label={language.t("settings.providers.defaultModel.title")}
            description={language.t("settings.providers.defaultModel.description")}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.smallModel.title")}
          description={language.t("settings.providers.smallModel.description")}
        >
          <ModelSelectorBase
            value={parseModelString(config().small_model ?? undefined)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
            includeAutoSmall
            label={language.t("settings.providers.smallModel.title")}
            description={language.t("settings.providers.smallModel.description")}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.subagentModel.title")}
          description={language.t("settings.providers.subagentModel.description")}
        >
          <div style={{ display: "flex", "flex-direction": "column", "align-items": "flex-end", gap: "8px" }}>
            <ModelSelectorBase
              value={subagentModel()}
              onSelect={handleSubagentModelSelect}
              placement="bottom-start"
              allowClear
              clearLabel={language.t("settings.providers.notSet")}
              label={language.t("settings.providers.subagentModel.title")}
              description={language.t("settings.providers.subagentModel.description")}
            />
            <Show when={subagentVariants().length > 0}>
              <ThinkingSelectorBase
                variants={subagentVariants()}
                value={subagentVariant()}
                onSelect={(value) => updateSubagentVariant(value)}
                onClear={() => updateSubagentVariant(null)}
                allowClear
                clearLabel={language.t("settings.providers.notSet")}
                placement="bottom-start"
                globalTrigger={false}
              />
            </Show>
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.autocomplete.model.title")}
          description={language.t("settings.autocomplete.model.description")}
          last
        >
          <ModelSelectorBase
            value={getAutocompleteSelection(autocompleteProvider(), autocompleteModel())}
            onSelect={handleAutocompleteModelSelect}
            placement="bottom-start"
            models={AUTOCOMPLETE_SELECTOR_MODELS}
            favorites={false}
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
            label={language.t("settings.autocomplete.model.title")}
            description={language.t("settings.autocomplete.model.description")}
          />
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>{language.t("settings.providers.modeModels")}</h4>
      <Card>
        <For each={allAgents()}>
          {(agent, index) => (
            <SettingsRow
              title={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
              last={index() === allAgents().length - 1}
            >
              <ModelSelectorBase
                value={parseModelString(config().agent?.[agent.name]?.model ?? undefined)}
                onSelect={handleModeModelSelect(agent.name)}
                placement="bottom-start"
                allowClear
                clearLabel={language.t("settings.providers.notSet")}
                label={`${language.t("settings.providers.modeModels")}: ${agent.name}`}
                description={language.t("settings.providers.modeModels.description")}
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ModelsTab
