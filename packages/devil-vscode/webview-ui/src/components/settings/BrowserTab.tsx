import { Component, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { BrowserSettings } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const BrowserTab: Component = () => {
  const { postMessage, onMessage } = useVSCode()
  const { t } = useLanguage()

  const [settings, setSettings] = createSignal<BrowserSettings>({
    enabled: false,
    useSystemChrome: true,
    headless: false,
  })

  onMount(() => {
    postMessage({ type: "requestBrowserSettings" })
  })

  // Subscribe outside onMount to catch early pushes (per AGENTS.md pattern)
  const unsubscribe = onMessage((msg) => {
    if (msg.type === "browserSettingsLoaded") {
      setSettings(msg.settings)
    }
  })
  onCleanup(unsubscribe)

  const update = (key: keyof BrowserSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    postMessage({ type: "updateSetting", key: `browserAutomation.${key}`, value })
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* Info text */}
      <div
        style={{
          background: "var(--vscode-textBlockQuote-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "12px 16px",
        }}
      >
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {t("settings.browser.description")}
        </p>
      </div>

      <Card>
        {/* Enable toggle */}
        <SettingsRow title={t("settings.browser.enable.title")} description={t("settings.browser.enable.description")}>
          <Switch checked={settings().enabled} onChange={(checked: boolean) => update("enabled", checked)} hideLabel>
            {t("settings.browser.enable.title")}
          </Switch>
        </SettingsRow>

        {/* Use System Chrome */}
        <SettingsRow
          title={t("settings.browser.systemChrome.title")}
          description={t("settings.browser.systemChrome.description")}
        >
          <Switch
            checked={settings().useSystemChrome}
            onChange={(checked: boolean) => update("useSystemChrome", checked)}
            hideLabel
          >
            {t("settings.browser.systemChrome.title")}
          </Switch>
        </SettingsRow>

        {/* Headless mode */}
        <SettingsRow
          title={t("settings.browser.headless.title")}
          description={t("settings.browser.headless.description")}
          last
        >
          <Switch checked={settings().headless} onChange={(checked: boolean) => update("headless", checked)} hideLabel>
            {t("settings.browser.headless.title")}
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default BrowserTab
