import { Component, createSignal, onCleanup, For } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()
  const { config, updateConfig } = useConfig()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
  })

  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const updateSetting = (
    key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete",
    value: boolean,
  ) => {
    vscode.postMessage({ type: "updateAutocompleteSetting", key, value })
  }

  const handleProviderChange = (field: "provider" | "model" | "api" | "apiKey", value: string) => {
    const prevAutocomplete = config().autocomplete ?? {}
    if (field === "apiKey") {
      updateConfig({
        autocomplete: {
          ...prevAutocomplete,
          options: {
            ...(prevAutocomplete.options ?? {}),
            apiKey: value,
          },
        },
      })
    } else {
      updateConfig({
        autocomplete: {
          ...prevAutocomplete,
          [field]: value,
        },
      })
    }
  }

  // Header management
  const headersList = () => {
    const headersObj = config().autocomplete?.options?.headers ?? {}
    const entries = Object.entries(headersObj)
    return entries.length > 0 ? entries : [["", ""]]
  }

  const addHeader = () => {
    const currentHeaders = { ...(config().autocomplete?.options?.headers ?? {}) }
    // Generate a unique empty key if "" already exists (rare, but just in case)
    let newKey = ""
    let counter = 1
    while (newKey in currentHeaders) {
      newKey = `new-header-${counter}`
      counter++
    }
    currentHeaders[newKey] = ""

    updateConfig({
      autocomplete: {
        ...(config().autocomplete ?? {}),
        options: {
          ...(config().autocomplete?.options ?? {}),
          headers: currentHeaders,
        },
      },
    })
  }

  const removeHeader = (keyToRemove: string, indexToRemove: number) => {
    const currentHeaders = { ...(config().autocomplete?.options?.headers ?? {}) }
    
    // If we are removing an empty row that hasn't been saved to the object yet
    const entries = headersList()
    if (entries.length <= 1) return

    if (keyToRemove in currentHeaders) {
      delete currentHeaders[keyToRemove]
      updateConfig({
        autocomplete: {
          ...(config().autocomplete ?? {}),
          options: {
            ...(config().autocomplete?.options ?? {}),
            headers: currentHeaders,
          },
        },
      })
    }
  }

  const updateHeaderKey = (oldKey: string, newKey: string, index: number) => {
    const entries = headersList()
    const newHeaders: Record<string, string> = {}
    
    entries.forEach(([k, v], i) => {
      if (i === index) {
        newHeaders[newKey] = v
      } else {
        newHeaders[k] = v
      }
    })

    updateConfig({
      autocomplete: {
        ...(config().autocomplete ?? {}),
        options: {
          ...(config().autocomplete?.options ?? {}),
          headers: newHeaders,
        },
      },
    })
  }

  const updateHeaderValue = (key: string, newValue: string, index: number) => {
    const entries = headersList()
    const newHeaders: Record<string, string> = {}
    
    entries.forEach(([k, v], i) => {
      if (i === index) {
        newHeaders[k] = newValue
      } else {
        newHeaders[k] = v
      }
    })

    updateConfig({
      autocomplete: {
        ...(config().autocomplete ?? {}),
        options: {
          ...(config().autocomplete?.options ?? {}),
          headers: newHeaders,
        },
      },
    })
  }


  return (
    <div data-component="autocomplete-settings" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
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

      <Card>
        <div style={{ padding: "16px", display: "flex", "flex-direction": "column", gap: "16px" }}>
          <div>
            <div style={{ "font-size": "14px", "font-weight": "600", color: "var(--vscode-foreground)", "margin-bottom": "4px" }}>
              {language.t("settings.autocomplete.customProvider.title")}
            </div>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("settings.autocomplete.customProvider.description")}
            </div>
          </div>

          <TextField
            label={language.t("settings.autocomplete.customProvider.providerName.title")}
            placeholder={language.t("settings.autocomplete.customProvider.providerName.placeholder")}
            value={config().autocomplete?.provider ?? ""}
            onChange={(val) => handleProviderChange("provider", val)}
          />
          <TextField
            label={language.t("settings.autocomplete.customProvider.model.title")}
            placeholder={language.t("settings.autocomplete.customProvider.model.placeholder")}
            value={config().autocomplete?.model ?? ""}
            onChange={(val) => handleProviderChange("model", val)}
          />
          <TextField
            label={language.t("settings.autocomplete.customProvider.apiBase.title")}
            placeholder={language.t("settings.autocomplete.customProvider.apiBase.placeholder")}
            value={config().autocomplete?.api ?? ""}
            onChange={(val) => handleProviderChange("api", val)}
          />
          <TextField
            type="password"
            label={language.t("settings.autocomplete.customProvider.apiKey.title")}
            placeholder={language.t("settings.autocomplete.customProvider.apiKey.placeholder")}
            value={config().autocomplete?.options?.apiKey ?? ""}
            onChange={(val) => handleProviderChange("apiKey", val)}
          />

          <div style={{ display: "flex", "flex-direction": "column", gap: "12px", "margin-top": "8px" }}>
            <div>
              <div style={{ "font-size": "13px", "font-weight": "500", color: "var(--vscode-foreground)", "margin-bottom": "4px" }}>
                {language.t("settings.autocomplete.customProvider.headers.title")}
              </div>
              <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                {language.t("settings.autocomplete.customProvider.headers.description")}
              </div>
            </div>

            <For each={headersList()}>
              {([key, value], index) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("settings.autocomplete.customProvider.headers.key.placeholder")}
                      hideLabel
                      placeholder={language.t("settings.autocomplete.customProvider.headers.key.placeholder")}
                      value={key}
                      onChange={(newKey) => updateHeaderKey(key, newKey, index())}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("settings.autocomplete.customProvider.headers.value.placeholder")}
                      hideLabel
                      placeholder={language.t("settings.autocomplete.customProvider.headers.value.placeholder")}
                      value={value}
                      onChange={(newValue) => updateHeaderValue(key, newValue, index())}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeHeader(key, index())}
                    disabled={headersList().length <= 1 && key === "" && value === ""}
                    aria-label="Remove header"
                    style={{ "margin-top": "6px" }}
                  />
                </div>
              )}
            </For>

            <div>
              <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader}>
                {language.t("settings.autocomplete.customProvider.headers.add")}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default AutocompleteTab
