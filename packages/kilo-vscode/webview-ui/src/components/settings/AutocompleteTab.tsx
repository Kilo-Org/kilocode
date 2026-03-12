import { Component, createSignal, onCleanup } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const AUTOCOMPLETE_MODELS = [
  { id: "mistralai/codestral-2508", label: "Codestral (Mistral AI)" },
  { id: "mercury-edit", label: "Mercury Edit (Inception Labs)" },
] as const

type ModelId = (typeof AUTOCOMPLETE_MODELS)[number]["id"]

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)
  const [model, setModel] = createSignal<string>("mistralai/codestral-2508")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
    setModel(message.settings.model)
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
          title={language.t("settings.autocomplete.model.title")}
          description={language.t("settings.autocomplete.model.description")}
        >
          <Select
            options={AUTOCOMPLETE_MODELS.map((m) => m.id)}
            current={model() as ModelId}
            label={(opt: ModelId) => AUTOCOMPLETE_MODELS.find((m) => m.id === opt)?.label ?? opt}
            value={(opt: ModelId) => opt}
            onSelect={(opt) => {
              if (opt !== undefined) {
                setModel(opt)
                vscode.postMessage({ type: "updateAutocompleteSetting", key: "model", value: opt })
              }
            }}
            variant="secondary"
            size="large"
          />
        </SettingsRow>

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
          description={language.t("settings.autocomplete.smartKeybinding.description")}
        >
          <Switch
            checked={enableSmartInlineTaskKeybinding()}
            onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
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
