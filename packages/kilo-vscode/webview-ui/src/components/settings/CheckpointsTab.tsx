import { Component } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"

const CheckpointsTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()

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
            onChange={(checked) => config.set(["snapshots"], checked)}
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
