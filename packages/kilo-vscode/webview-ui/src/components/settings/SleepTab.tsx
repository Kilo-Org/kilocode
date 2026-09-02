import { Component, onMount } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import SettingsRow from "./SettingsRow"

const SleepTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const { settings, updateSetting } = useConfig()
  const enabled = () => settings().preventSleepDuringTasks === true
  const timeout = () => Number(settings().preventSleepDuringTasksTimeoutMinutes ?? 30)

  onMount(() => vscode.postMessage({ type: "requestSleepSettings" }))

  const updateTimeout = (value: string) => {
    const next = Math.max(0, Math.min(1440, Number(value) || 0))
    updateSetting("preventSleepDuringTasksTimeoutMinutes", next)
  }

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.sleep.enable.title")}
        description={language.t("settings.sleep.enable.description")}
      >
        <Switch
          checked={enabled()}
          onChange={(value) => {
            updateSetting("preventSleepDuringTasks", value)
          }}
          hideLabel
        >
          {language.t("settings.sleep.enable.title")}
        </Switch>
      </SettingsRow>
      <div data-slot="sleep-setting-child">
        <SettingsRow
          title={language.t("settings.sleep.timeout.title")}
          description={language.t("settings.sleep.timeout.description")}
          last
        >
          <div data-slot="sleep-timeout-input">
            <TextField
              type="number"
              inputMode="numeric"
              min="0"
              max="1440"
              step="1"
              value={String(timeout())}
              onChange={updateTimeout}
              disabled={!enabled()}
              hideLabel
              label={language.t("settings.sleep.timeout.title")}
            />
          </div>
        </SettingsRow>
      </div>
    </Card>
  )
}

export default SleepTab
