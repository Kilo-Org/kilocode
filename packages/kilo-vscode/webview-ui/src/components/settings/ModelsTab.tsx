import { Component, For, createMemo, createSignal, onCleanup } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Select } from "@kilocode/kilo-ui/select"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { parseModelString } from "../../../../src/shared/provider-model"
import { AUTOCOMPLETE_MODELS, DEFAULT_AUTOCOMPLETE_MODEL } from "../../../../src/shared/autocomplete-models"
import { ModelSelectorBase } from "../shared/ModelSelector"
import SettingsRow from "./SettingsRow"
import type { ExtensionMessage } from "../../types/messages"

const ModelsTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const session = useSession()
  const vscode = useVSCode()

  const [autocompleteModel, setAutocompleteModel] = createSignal<string>(DEFAULT_AUTOCOMPLETE_MODEL.id)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "autocompleteSettingsLoaded") {
      setAutocompleteModel(message.settings.model)
    }
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestAutocompleteSettings" })

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: null })
        return
      }
      updateConfig({ [configKey]: `${providerID}/${modelID}` })
    }
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
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.autocomplete.model.title")}
          description={language.t("settings.autocomplete.model.description")}
          last
        >
          <Select
            options={AUTOCOMPLETE_MODELS.map((m) => m.id)}
            current={autocompleteModel()}
            label={(opt: string) => AUTOCOMPLETE_MODELS.find((m) => m.id === opt)?.label ?? opt}
            value={(opt: string) => opt}
            onSelect={(opt) => {
              if (opt !== undefined) {
                setAutocompleteModel(opt)
                vscode.postMessage({ type: "updateAutocompleteSetting", key: "model", value: opt })
              }
            }}
            triggerVariant="settings"
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
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ModelsTab
