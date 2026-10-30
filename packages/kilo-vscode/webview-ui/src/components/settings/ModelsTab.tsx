// The Models tab on the v2 config. The top-level `model`, the `title` and `compaction` agent models, one model per
// selectable agent under `agents.<id>.model`, and the top-level Kilo `hide_prompt_training_models` policy key.
import { Card } from "@kilocode/kilo-ui/card"
import { Component, For, createEffect, createMemo, on } from "solid-js"
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import { useSettingsConfig } from "../../v2/settings-config"
import ModelPicker from "./ModelPicker"
import { selection, write, preserveVariant, readPathValue, type ModelSelection } from "./models-selection"
import SettingsRow from "./SettingsRow"
import { Switch } from "./Switch"
import type { SettingsTabProps } from "./tabs"

const ModelsTab: Component<SettingsTabProps> = () => {
  const language = useLanguage()
  const v2 = useV2()
  const config = useSettingsConfig()

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
      ]).catch(v2.report)
    }),
  )

  const agents = createMemo(() =>
    (v2.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden),
  )

  const notSet = () => language.t("settings.providers.notSet")

  // A row reads as set only when a config file sets the key (or a write is in flight). The file value is preferred
  // over the merged value so a resolved config default does not replace what the user set; the merged value is the
  // fallback for a key that a legacy alias stores. While a write is in flight the raw snapshot is stale, so the
  // optimistic value from `config.value` is used instead.
  const current = (path: string[]) => {
    const scope = config.source(path)
    const pending = config.pending(path)
    if (!scope && !pending) return undefined
    const raw = scope && !pending ? readPathValue(config.raw(scope), path) : undefined
    return selection(raw ?? config.value(path))
  }
  const change = (path: string[]) => (value: ModelSelection | undefined) => {
    // Write the scope that already defines the key so a project override is updated in place, not shadowed.
    const scope = config.source(path) ?? "global"
    if (!value) return config.unset(path, scope)
    // This tab hides the variant control, so keep an existing variant when the model itself is unchanged.
    return config.set(path, write(preserveVariant(selection(config.value(path)), value)), scope)
  }

  const hidden = () => {
    const project = config.raw("project")?.hide_prompt_training_models
    if (typeof project === "boolean") return project
    return config.raw("global")?.hide_prompt_training_models === true
  }
  const setHidden = (checked: boolean) =>
    config.set(["hide_prompt_training_models"], checked, config.source(["hide_prompt_training_models"]) ?? "global")

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.providers.defaultModel.title")}
          description={language.t("settings.providers.defaultModel.description")}
        >
          <ModelPicker
            value={current(["model"])}
            onChange={change(["model"])}
            clearable
            clearLabel={notSet()}
            showVariants={false}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.providers.smallModel.title")}
          description={language.t("settings.providers.smallModel.description")}
        >
          <ModelPicker
            value={current(["agents", "title", "model"])}
            onChange={change(["agents", "title", "model"])}
            clearable
            clearLabel={notSet()}
            showVariants={false}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.context.compactionModel.title")}
          description={language.t("settings.context.compactionModel.description")}
        >
          <ModelPicker
            value={current(["agents", "compaction", "model"])}
            onChange={change(["agents", "compaction", "model"])}
            clearable
            clearLabel={language.t("settings.context.compactionModel.useChatModel")}
            showVariants={false}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.models.hidePromptTraining.title")}
          description={language.t("settings.models.hidePromptTraining.description")}
          last
        >
          <Switch checked={hidden()} onChange={setHidden} hideLabel>
            {language.t("settings.models.hidePromptTraining.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "24px", "margin-bottom": "8px" }}>{language.t("settings.providers.modeModels")}</h4>
      <Card>
        <For each={agents()}>
          {(agent, index) => (
            <SettingsRow title={agent.name.charAt(0).toUpperCase() + agent.name.slice(1)} last={index() === agents().length - 1}>
              <ModelPicker
                value={current(["agents", agent.id, "model"])}
                onChange={change(["agents", agent.id, "model"])}
                clearable
                clearLabel={notSet()}
                showVariants={false}
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )
}

export default ModelsTab
