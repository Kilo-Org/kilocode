import { type Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useConfig } from "../../context/config"
import { useDisplay } from "../../context/display"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

interface LayoutOption {
  value: string
  labelKey: string
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: "auto", labelKey: "settings.display.layout.auto" },
  { value: "stretch", labelKey: "settings.display.layout.stretch" },
]

const DisplayTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const display = useDisplay()
  const language = useLanguage()

  return (
    <div>
      <Card>
        <SettingsRow
          title={language.t("settings.display.username.title")}
          description={language.t("settings.display.username.description")}
        >
          <div style={{ width: "160px" }}>
            <TextField
              value={config().username ?? ""}
              placeholder="User"
              onChange={(val) => updateConfig({ username: val.trim() || undefined })}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.layout.title")}
          description={language.t("settings.display.layout.description")}
        >
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((o) => o.value === (config().layout ?? "auto"))}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              const next = o.value as "auto" | "stretch"
              if (next === (config().layout ?? "auto")) return
              updateConfig({ layout: next })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.reasoningAutoCollapse.title")}
          description={language.t("settings.display.reasoningAutoCollapse.description")}
          last
        >
          <Switch
            checked={display.reasoningAutoCollapse()}
            onChange={(checked: boolean) => {
              display.setReasoningAutoCollapse(checked)
            }}
            hideLabel
          >
            {language.t("settings.display.reasoningAutoCollapse.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default DisplayTab
