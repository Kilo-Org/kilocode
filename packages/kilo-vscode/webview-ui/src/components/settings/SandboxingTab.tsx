import { Component, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const description = "sandbox-network-description"

const SandboxingTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const experimental = createMemo(() => config().experimental ?? {})

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.sandboxing.network.title")}
        description={language.t("settings.sandboxing.network.description")}
        descriptionId={description}
        last
      >
        <Switch
          checked={experimental().sandbox_restrict_network !== false}
          inputProps={{ "aria-describedby": description }}
          onChange={(checked) =>
            updateConfig({
              experimental: {
                ...experimental(),
                sandbox_restrict_network: checked,
              },
            })
          }
          hideLabel
        >
          {language.t("settings.sandboxing.network.title")}
        </Switch>
      </SettingsRow>
    </Card>
  )
}

export default SandboxingTab
