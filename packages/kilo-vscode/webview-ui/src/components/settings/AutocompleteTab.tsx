import { createSignal, onCleanup, type Component } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)
  const [shortcut, setShortcut] = createSignal("Cmd+L")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
    setShortcut(
      message.keybindings["kilo-code.new.autocomplete.generateSuggestions"] ??
        language.t("settings.autocomplete.keybindingNotFound"),
    )
  })

  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const updateSetting = (
    key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete",
    value: boolean,
  ) => {
    vscode.postMessage({ type: "updateAutocompleteSetting", key, value })
  }

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title={language.t("settings.autocomplete.autoTrigger.title")}
          description={language.t("settings.autocomplete.autoTrigger.description")}
        >
          <Switch
            checked={enableAutoTrigger()}
            onChange={(checked) => updateSetting("enableAutoTrigger", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.autoTrigger.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.smartKeybinding.title")}
          description={language.t("settings.autocomplete.smartKeybinding.description", { keybinding: shortcut() })}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button
              variant="secondary"
              onClick={() =>
                vscode.postMessage({
                  type: "openGlobalKeybindings",
                  text: "kilo-code.new.autocomplete.generateSuggestions",
                })
              }
            >
              {language.t("settings.autocomplete.changeKeybinding")}
            </Button>
            <Switch
              checked={enableSmartInlineTaskKeybinding()}
              onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
              hideLabel
            >
              {language.t("settings.autocomplete.smartKeybinding.title")}
            </Switch>
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.chatAutocomplete.title")}
          description={language.t("settings.autocomplete.chatAutocomplete.description")}
          last
        >
          <Switch
            checked={enableChatAutocomplete()}
            onChange={(checked) => updateSetting("enableChatAutocomplete", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.chatAutocomplete.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default AutocompleteTab
