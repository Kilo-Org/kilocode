import { Component, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import type { UiI18nKey } from "@kilocode/kilo-ui/context"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import type { BrowserConfig } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const Header: Component<{ title: string }> = (props) => (
  <h4
    style={{
      margin: "0 0 8px",
      "font-size": "var(--kilo-font-size-13)",
      "font-weight": "600",
      color: "var(--vscode-foreground)",
    }}
  >
    {props.title}
  </h4>
)

type Backend = NonNullable<BrowserConfig["backend"]>

const BACKENDS: { value: Backend; labelKey: UiI18nKey; descriptionKey: UiI18nKey }[] = [
  { value: "off", labelKey: "settings.browser.backend.off", descriptionKey: "settings.browser.backend.off.description" },
  {
    value: "playwright",
    labelKey: "settings.browser.backend.playwright",
    descriptionKey: "settings.browser.backend.playwright.description",
  },
  {
    value: "extension",
    labelKey: "settings.browser.backend.extension",
    descriptionKey: "settings.browser.backend.extension.description",
  },
]

const BrowserTab: Component = () => {
  const { t } = useLanguage()
  const { globalConfig, projectConfig, updateGlobalConfig } = useConfig()

  const selected = () => BACKENDS.find((item) => item.value === (globalConfig().browser?.backend ?? "playwright"))

  const backendDescription = () => {
    const item = selected()
    return item ? t(item.descriptionKey) : ""
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
            title={t("settings.browser.backend.title")}
            description={backendDescription()}
            last
          >
            <Select
              options={BACKENDS}
              current={selected()}
              value={(item) => item.value}
              label={(item) => t(item.labelKey)}
              onSelect={(item) => {
                if (!item || item.value === selected()?.value) return
                updateGlobalConfig({ browser: { backend: item.value } })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </Card>
      </div>
    </div>
  )
}

export default BrowserTab
