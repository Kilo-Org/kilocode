// Main's Display tab on the live v2 config. In scope: Username (config), Font Size and Cycle Reasoning Effort with
// Shift+Tab (`kilo-code.v2.*` settings). Not rendered, no v2 contract: token throughput, auto-approval reason, the
// display presets and the block display modes, and the session preview.
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { createEffect, createSignal, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { applyFontSize, clampFontSize, fallbackFontSize } from "../../v2/kilo-settings"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"

const DisplayTab: Component = () => {
  const config = useSettingsConfig()
  const language = useLanguage()
  // The dragged value, so the size follows the thumb and commits one write on release.
  const [preview, setPreview] = createSignal<number>()

  const fontSize = () => preview() ?? clampFontSize(config.setting("fontSize")) ?? fallbackFontSize()

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
              onInput={(event) => setPreview(Number(event.currentTarget.value))}
              onChange={(event) => {
                const next = Number(event.currentTarget.value)
                setPreview(undefined)
                config.setSetting("fontSize", next)
              }}
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
