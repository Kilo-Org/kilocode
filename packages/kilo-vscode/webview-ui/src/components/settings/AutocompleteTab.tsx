// The Autocomplete tab. The switches write the `kilo-code.v2.autocomplete.*` VS Code settings on change; the
// extension host reloads autocomplete on each change, so no reload is needed. The model is chosen on the Models tab.
import { Card } from "@kilocode/kilo-ui/card"
import type { Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { useSettingsConfig, type KiloSettingKey } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import Switch from "./Switch"
import type { SettingsTabProps } from "./tabs"

type Toggle = "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete"

const AutocompleteTab: Component<SettingsTabProps> = (props) => {
  const config = useSettingsConfig()
  const language = useLanguage()

  const enabled = (key: Toggle, fallback: boolean) => {
    const value = config.setting(`autocomplete.${key}` satisfies KiloSettingKey)
    return typeof value === "boolean" ? value : fallback
  }
  const save = (key: Toggle, value: boolean) => config.setSetting(`autocomplete.${key}`, value)

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title={language.t("settings.autocomplete.autoTrigger.title")}
          description={language.t("settings.autocomplete.autoTrigger.description")}
        >
          <Switch
            checked={enabled("enableAutoTrigger", true)}
            onChange={(checked) => save("enableAutoTrigger", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.autoTrigger.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.smartKeybinding.title")}
          description={language.t("settings.autocomplete.smartKeybinding.description")}
        >
          <Switch
            checked={enabled("enableSmartInlineTaskKeybinding", false)}
            onChange={(checked) => save("enableSmartInlineTaskKeybinding", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.smartKeybinding.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.chatAutocomplete.title")}
          description={language.t("settings.autocomplete.chatAutocomplete.description")}
          last
        >
          <Switch
            checked={enabled("enableChatAutocomplete", false)}
            onChange={(checked) => save("enableChatAutocomplete", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.chatAutocomplete.title")}
          </Switch>
        </SettingsRow>
      </Card>
      <p
        data-slot="autocomplete-models-hint"
        style={{
          "margin-top": "20px",
          "font-size": "var(--kilo-font-size-12)",
          "text-align": "right",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
        }}
      >
        <a
          href="#"
          style={{ color: "var(--vscode-textLink-foreground)", "text-decoration": "none", cursor: "pointer" }}
          onClick={(event) => {
            event.preventDefault()
            props.onNavigate({ tab: "models", titleKey: "settings.autocomplete.model.title" })
          }}
        >
          {language.t("settings.autocomplete.modelsHint")}
        </a>
      </p>
    </div>
  )
}

export default AutocompleteTab
