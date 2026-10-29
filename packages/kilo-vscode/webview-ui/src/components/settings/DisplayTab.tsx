// Main's Display tab on the v2 config draft. In scope: Username (config), Font Size and Cycle Reasoning Effort with
// Shift+Tab (`kilo-code.v2.*` settings). Not rendered, no v2 contract: token throughput, auto-approval reason, the
// display presets and the block display modes, and the session preview.
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { applyFontSize, bootFontSize, clampFontSize } from "../../v2/kilo-settings"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

const DisplayTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const fontSize = () => clampFontSize(config.setting("fontSize")) ?? bootFontSize()

  // Preview the size live as the slider moves, as main resized without a save.
  createEffect(() => applyFontSize(fontSize()))

  const username = () => {
    const value = config.value(["username"])
    return typeof value === "string" ? value : ""
  }

  return (
    <div class="settings-display">
      <Card class="settings-display-controls">
        <SettingsRow
          title={language.t("settings.display.username.title")}
          description={language.t("settings.display.username.description")}
        >
          <div style={{ width: "160px" }}>
            <TextField
              value={username()}
              placeholder="User"
              onChange={(value) => {
                const next = value.trim()
                if (next) config.set(["username"], next)
                else config.unset(["username"])
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.fontSize.title")}
          description={language.t("settings.display.fontSize.description")}
        >
          <div class="settings-font-size-control">
            <input
              type="range"
              min="10"
              max="24"
              step="1"
              value={fontSize()}
              onInput={(event) => config.setSetting("fontSize", Number(event.currentTarget.value))}
              aria-label={language.t("settings.display.fontSize.title")}
            />
            <span>{fontSize()}px</span>
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.display.shiftTabCycle.title")}
          description={language.t("settings.display.shiftTabCycle.description")}
          last
        >
          <Switch
            checked={config.setting("chat.shiftTabCyclesVariant") !== false}
            onChange={(checked) => config.setSetting("chat.shiftTabCyclesVariant", checked)}
            hideLabel
          >
            {language.t("settings.display.shiftTabCycle.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default DisplayTab
