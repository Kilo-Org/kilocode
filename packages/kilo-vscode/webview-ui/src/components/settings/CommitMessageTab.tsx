import { Component, Show, createSignal } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const CommitMessageTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const [expanded, setExpanded] = createSignal(Boolean(config().commit_message?.prompt))

  const toggle = (checked: boolean) => {
    setExpanded(checked)
    if (!checked) {
      updateConfig({ commit_message: { prompt: "" } })
    }
  }

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.commitMessage.override.title")}
          description={language.t("settings.commitMessage.override.description")}
          last={!expanded()}
        >
          <Switch checked={expanded()} onChange={toggle} hideLabel>
            {language.t("settings.commitMessage.override.title")}
          </Switch>
        </SettingsRow>

        <Show when={expanded()}>
          <div style={{ "padding-top": "8px" }}>
            <div data-slot="settings-row-label-title" style={{ "margin-bottom": "4px" }}>
              {language.t("settings.commitMessage.prompt.title")}
            </div>
            <div data-slot="settings-row-label-subtitle" style={{ "margin-bottom": "8px" }}>
              {language.t("settings.commitMessage.prompt.description")}
            </div>
            <div style={{ "max-height": "300px", overflow: "auto" }}>
              <TextField
                value={config().commit_message?.prompt ?? ""}
                placeholder={language.t("settings.commitMessage.prompt.placeholder")}
                multiline
                onChange={(val) => {
                  updateConfig({ commit_message: { prompt: val } })
                }}
              />
            </div>
          </div>
        </Show>
      </Card>
    </div>
  )
}

export default CommitMessageTab
