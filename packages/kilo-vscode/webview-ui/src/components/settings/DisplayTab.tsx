import { Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
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
            onSelect={(o) => o && updateConfig({ layout: o.value as "auto" | "stretch" })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.fontSize.title")}
          description={language.t("settings.display.fontSize.description")}
          last
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px", width: "160px" }}>
            <input
              type="range"
              min="10"
              max="24"
              step="1"
              value={config().fontSize ?? 13}
              onInput={(e) => {
                const value = parseInt(e.currentTarget.value, 10)
                if (!isNaN(value) && value >= 10 && value <= 24) {
                  updateConfig({ fontSize: value })
                }
              }}
              style={{ flex: 1 }}
            />
            <span style={{ "min-width": "40px", "text-align": "right" }}>{config().fontSize ?? 13}px</span>
          </div>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default DisplayTab
