import { Component } from "solid-js"
import Switch from "./Switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"

const CheckpointsTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const write = (path: string[], value: unknown) => config.set(path, value, config.source(path) ?? "global")

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.checkpoints.enable.title")}
          description={language.t("settings.checkpoints.enable.description")}
          last
        >
          <Switch
            checked={config.value(["snapshots"]) !== false}
            onChange={(checked) => write(["snapshots"], checked)}
            hideLabel
          >
            {language.t("settings.checkpoints.enable.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default CheckpointsTab
