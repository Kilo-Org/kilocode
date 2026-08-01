import { Component, Show } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

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
  const { config, globalConfig, projectConfig, updateConfig, updateGlobalConfig } = useConfig()
  const { t } = useLanguage()
  const enabled = () => config().experimental?.world_browser !== false
  const headless = () => config().world?.browser?.headless ?? true
  const chrome = () => config().world?.browser?.use_system_chrome ?? false

  const setEnabled = (value: boolean) => {
    updateConfig({ experimental: { ...config().experimental, world_browser: value } })
  }

  const setHeadless = (value: boolean) => {
    updateConfig({ world: { ...config().world, browser: { ...config().world?.browser, headless: value } } })
  }

  const setChrome = (value: boolean) => {
    updateConfig({
      world: { ...config().world, browser: { ...config().world?.browser, use_system_chrome: value } },
    })
  }

  const updateWebsearch = (checked: boolean) => {
    updateGlobalConfig({ web_search: checked })
  }

  const overridden = () => projectConfig().web_search !== undefined

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
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {t("settings.webTools.description")}
        </p>
      </div>

      <div>
        <Header title={t("settings.webTools.webSearch.title")} />
        <Card>
          <SettingsRow
            title={t("settings.webTools.webSearch.enable")}
            description={t("settings.webTools.webSearch.description")}
            tag={() => t("settings.config.scope.global")}
            last={!overridden()}
          >
            <Switch checked={globalConfig().web_search ?? false} onChange={updateWebsearch} hideLabel>
              {t("settings.webTools.webSearch.title")}
            </Switch>
          </SettingsRow>
          <Show when={overridden()}>
            <SettingsRow
              title={t("settings.webTools.webSearch.enable")}
              tag={() => t("settings.config.scope.local")}
              last
            >
              <Switch checked={projectConfig().web_search ?? false} disabled hideLabel>
                {`${t("settings.webTools.webSearch.title")} (${t("settings.config.scope.local")})`}
              </Switch>
            </SettingsRow>
          </Show>
        </Card>
      </div>

      <div>
        <Header title={t("settings.webTools.browserAutomation")} />
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--vscode-descriptionForeground)",
            "font-size": "var(--kilo-font-size-12)",
            "line-height": "1.5",
          }}
        >
          {t("settings.browser.description")}
        </p>
        <Card>
          <SettingsRow
            title={t("settings.browser.enable.title")}
            description={t("settings.browser.enable.description")}
          >
            <Switch checked={enabled()} onChange={setEnabled} hideLabel>
              {t("settings.browser.enable.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={t("settings.browser.headless.title")}
            description={t("settings.browser.headless.description")}
          >
            <Switch checked={headless()} onChange={setHeadless} hideLabel>
              {t("settings.browser.headless.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={t("settings.browser.systemChrome.title")}
            description={t("settings.browser.systemChrome.description")}
            last
          >
            <Switch checked={chrome()} onChange={setChrome} hideLabel>
              {t("settings.browser.systemChrome.title")}
            </Switch>
          </SettingsRow>
        </Card>
      </div>
    </div>
  )
}

export default BrowserTab
