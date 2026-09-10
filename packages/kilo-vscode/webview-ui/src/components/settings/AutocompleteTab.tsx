import { Component } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const AutocompleteTab: Component<{ onNavigateToModels?: () => void }> = (props) => {
  const { settings, updateSetting } = useConfig()
  const language = useLanguage()

  const enabled = (key: string, fallback: boolean) => Boolean(settings()[key] ?? fallback)

  const save = (
    key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete",
    value: boolean,
  ) => {
    updateSetting(`autocomplete.${key}`, value)
  }

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title={language.t("settings.autocomplete.autoTrigger.title")}
          description={language.t("settings.autocomplete.autoTrigger.description")}
        >
          <Switch
            checked={enabled("autocomplete.enableAutoTrigger", true)}
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
            checked={enabled("autocomplete.enableSmartInlineTaskKeybinding", false)}
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
            checked={enabled("autocomplete.enableChatAutocomplete", false)}
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
          style={{
            color: "var(--vscode-textLink-foreground)",
            "text-decoration": "none",
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.preventDefault()
            props.onNavigateToModels?.()
          }}
        >
          {language.t("settings.autocomplete.modelsHint")}
        </a>
      </p>
    </div>
  )
}

export default AutocompleteTab
