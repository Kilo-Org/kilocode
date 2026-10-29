// Web Tools tab on v2 config. Web Search maps the v2 `websearch` selection: `false` is off, a provider selection is
// on. The Browser Automation rows have no v2 key and are not rendered.
import { Component, Show, createEffect, createSignal, on } from "solid-js"
import { Switch } from "./Switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useSettingsConfig } from "../../v2/settings-config"
import SettingsRow from "./SettingsRow"

const WEBSEARCH = ["websearch"]

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

  // The global row edits the global scope, so it shows the global file value. A staged edit wins until save or
  // discard clears the draft; `value()` is the merged value and a project file would otherwise mask the global one.
  const [staged, setStaged] = createSignal<unknown>()
  createEffect(
    on(
      () => config.dirty(),
      (dirty) => {
        if (!dirty) setStaged(undefined)
      },
    ),
  )

  const enabled = () => {
    const draft = staged()
    if (draft !== undefined) return Boolean(draft)
    if (config.source(WEBSEARCH) === "project") return Boolean(config.raw("global")["websearch"])
    return Boolean(config.value(WEBSEARCH))
  }
  const local = () => config.raw("project")["websearch"]
  const overridden = () => local() !== undefined

  const update = (checked: boolean) => {
    const value = checked ? { provider: "random" } : false
    setStaged(value)
    config.set(WEBSEARCH, value)
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
    </div>
  )
}

export default BrowserTab
