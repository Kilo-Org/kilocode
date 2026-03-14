import { Component, For, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { parseModelString } from "../../../../src/shared/provider-model"
import { ModelSelectorBase } from "../shared/ModelSelector"
import SettingsRow from "./SettingsRow"

const ModelsTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const session = useSession()

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
          last
        >
          <ModelSelectorBase
            value={parseModelString(config().small_model ?? undefined)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.notSet")}
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
