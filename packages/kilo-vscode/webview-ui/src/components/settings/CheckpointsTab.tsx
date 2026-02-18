import { Component } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const CheckpointsTab: Component = () => {
  const { config, updateConfig } = useConfig()
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
            checked={config().snapshot !== false}
            onChange={(checked) => updateConfig({ snapshot: checked })}
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
