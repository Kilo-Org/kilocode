// Web Tools tab. Web Search maps the v2 `websearch` selection: `false` is off, a provider selection is on. The
// Integrated Browser and Playwright automation are `kilo-code.v2.*` editor settings, so their rows write those.
import { Component, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "./Switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig, type KiloSettingKey } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"
import { webSearchEnabled, webSearchSelection } from "./settings-values"

const WEBSEARCH = ["websearch"]

type LinkDestination = "external" | "integrated"

const LINK_OPTIONS: { value: LinkDestination; labelKey: string }[] = [
  { value: "external", labelKey: "settings.experimental.browserLinks.external" },
  { value: "integrated", labelKey: "settings.experimental.browserLinks.integrated" },
]

const Header: Component<{ title: string }> = (props) => (
  <h4
    style={{
      margin: "0 0 12px",
      "padding-bottom": "10px",
      "border-bottom": "1px solid var(--vscode-panel-border)",
      color: "var(--text-base, var(--vscode-foreground))",
      "font-size": "var(--kilo-font-size-18, 18px)",
      "font-weight": 600,
      "line-height": "1.4",
    }}
  >
    {props.title}
  </h4>
)

const BrowserTab: Component = () => {
  const language = useLanguage()
  const config = useSettingsConfig()

  // The global row edits the global scope. When a project file defines `websearch`, the merged value is the
  // project's, so the global row falls back to the global file. A write in flight for this path wins so the row
  // reflects the edit at once.
  const enabled = () => {
    if (config.source(WEBSEARCH) === "project" && !config.pending(WEBSEARCH))
      return webSearchEnabled(config.raw("global")["websearch"])
    return webSearchEnabled(config.value(WEBSEARCH))
  }
  const local = () => config.raw("project")["websearch"]
  const overridden = () => local() !== undefined

  const update = (checked: boolean) => {
    void config.set(WEBSEARCH, webSearchSelection(checked))
  }

  // Editor settings, not v2 config: the extension host reads them to run the browser and register the MCP server.
  const setting = (key: KiloSettingKey, fallback: boolean) => {
    const value = config.setting(key)
    return typeof value === "boolean" ? value : fallback
  }
  const links = () => {
    const value = config.setting("agentManager.browser.openLinksIn")
    return value === "external" ? "external" : "integrated"
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      {/* Info text */}
      <div
        style={{
          background: "var(--vscode-textBlockQuote-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          "padding": "12px 16px",
        }}
      >
        <p
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {language.t("settings.webTools.description")}
        </p>
      </div>

      <div>
        <Header title={language.t("settings.webTools.webSearch.title")} />
        <Card>
          <SettingsRow
            title={language.t("settings.webTools.webSearch.enable")}
            description={language.t("settings.webTools.webSearch.description")}
            tag={() => language.t("settings.config.scope.global")}
            last={!overridden()}
          >
            <Switch checked={enabled()} onChange={update} hideLabel>
              {language.t("settings.webTools.webSearch.title")}
            </Switch>
          </SettingsRow>
          <Show when={overridden()}>
            <SettingsRow
              title={language.t("settings.webTools.webSearch.enable")}
              tag={() => language.t("settings.config.scope.local")}
              last
            >
              <Switch checked={local() !== false} disabled hideLabel>
                {`${language.t("settings.webTools.webSearch.title")} (${language.t("settings.config.scope.local")})`}
              </Switch>
            </SettingsRow>
          </Show>
        </Card>
      </div>

      <div>
        <Header title={language.t("settings.experimental.browserAutomation.title")} />
        <Card>
          <SettingsRow
            title={language.t("settings.experimental.browserAutomation.title")}
            description={language.t("settings.experimental.browserAutomation.description")}
            tag={() => language.t("settings.config.scope.global")}
          >
            <Switch
              checked={setting("integratedBrowser", false)}
              onChange={(checked) => config.setSetting("integratedBrowser", checked)}
              hideLabel
            >
              {language.t("settings.experimental.browserAutomation.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.experimental.browserAutomation.systemChrome.title")}
            description={language.t("settings.experimental.browserAutomation.systemChrome.description")}
          >
            <Switch
              checked={setting("agentManager.browser.useSystemChrome", true)}
              onChange={(checked) => config.setSetting("agentManager.browser.useSystemChrome", checked)}
              hideLabel
            >
              {language.t("settings.experimental.browserAutomation.systemChrome.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.experimental.browserLinks.title")}
            description={language.t("settings.experimental.browserLinks.description")}
            last
          >
            <Select
              options={LINK_OPTIONS}
              current={LINK_OPTIONS.find((option) => option.value === links())}
              value={(option) => option.value}
              label={(option) => language.t(option.labelKey)}
              onSelect={(option) => {
                if (!option || option.value === links()) return
                config.setSetting("agentManager.browser.openLinksIn", option.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </Card>
      </div>

      <div>
        <Header title={language.t("settings.webTools.browserAutomation")} />
        <Card>
          <SettingsRow
            title={language.t("settings.browser.enable.title")}
            description={language.t("settings.browser.enable.description")}
          >
            <Switch
              checked={setting("browserAutomation.enabled", false)}
              onChange={(checked) => config.setSetting("browserAutomation.enabled", checked)}
              hideLabel
            >
              {language.t("settings.browser.enable.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.browser.systemChrome.title")}
            description={language.t("settings.browser.systemChrome.description")}
          >
            <Switch
              checked={setting("browserAutomation.useSystemChrome", true)}
              onChange={(checked) => config.setSetting("browserAutomation.useSystemChrome", checked)}
              hideLabel
            >
              {language.t("settings.browser.systemChrome.title")}
            </Switch>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.browser.headless.title")}
            description={language.t("settings.browser.headless.description")}
            last
          >
            <Switch
              checked={setting("browserAutomation.headless", false)}
              onChange={(checked) => config.setSetting("browserAutomation.headless", checked)}
              hideLabel
            >
              {language.t("settings.browser.headless.title")}
            </Switch>
          </SettingsRow>
        </Card>
      </div>
    </div>
  )
}

export default BrowserTab
