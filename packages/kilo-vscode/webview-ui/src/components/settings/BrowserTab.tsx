// Web Tools tab. Web Search maps the v2 `websearch` selection: `false` is off, a provider selection is on. The
// Integrated Browser is a `kilo-code.v2.*` editor setting, so its rows write that. The browser tools' backend,
// observation, sensitive steps and site permissions are the `browser` config keys the CLI reads; the host owns those
// writes, and the status line reports what this machine can start.
import { Component, For, Show, createSignal, onMount } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "./Switch"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import { useSettingsConfig, type KiloSettingKey } from "../../v2/settings-config"
import { createBrowserSettings } from "../../v2/browser-settings"
import { GRANTS, origin, sites } from "./browser-settings"
import SettingsRow from "./SettingsRow"
import { ActionSelect } from "./PermissionToolRow"
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
              checked={setting("integratedBrowser", true)}
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

      <BrowserTools />
    </div>
  )
}

const BACKENDS = ["playwright", "extension", "off"] as const
const OBSERVATIONS = ["full", "diff", "none"] as const
const TARGETS: Record<"chrome" | "msedge" | "chromium", string> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  chromium: "Chromium",
}

const Subtitle: Component<{ text: string }> = (props) => (
  <div
    style={{
      "font-size": "var(--kilo-font-size-12)",
      color: "var(--vscode-descriptionForeground)",
      "line-height": "1.5",
    }}
  >
    {props.text}
  </div>
)

/**
 * The browser tools' settings and the site permission table. The state comes from the host, which owns the config
 * file, so a row always shows what the CLI reads.
 */
const BrowserTools: Component = () => {
  const language = useLanguage()
  const browser = createBrowserSettings()
  const [draft, setDraft] = createSignal("")
  const [originError, setOriginError] = createSignal<"empty" | "invalid" | "duplicate">()
  onMount(() => browser.load())

  const state = () => browser.state()
  const rows = () => sites(state()?.rules ?? [])
  const disconnected = () => state()?.backend === "extension" && browser.status()?.extension.connected === false

  const addOrigin = () => {
    const parsed = origin(
      draft(),
      rows().map((row) => row.origin),
    )
    if ("error" in parsed) {
      setOriginError(parsed.error)
      return
    }
    setOriginError(undefined)
    setDraft("")
    browser.write({ site: parsed.value })
  }

  return (
    <>
      <div>
        <Header title={language.t("settings.browser.backend.title")} />
        <Card>
          <div style={{ padding: "12px 0 4px" }}>
            <div style={{ "font-weight": 500, "margin-bottom": "2px" }}>
              {language.t("settings.browser.backend.title")}
            </div>
            <Subtitle text={language.t("settings.browser.backend.description")} />
            <For each={BACKENDS}>
              {(value) => (
                <label
                  style={{
                    display: "flex",
                    gap: "8px",
                    "align-items": "flex-start",
                    padding: "8px 0 0",
                    cursor: state() ? "pointer" : "default",
                  }}
                >
                  <input
                    type="radio"
                    name="kilo-browser-backend"
                    checked={state()?.backend === value}
                    disabled={!state() || browser.busy()}
                    onChange={() => browser.write({ browser: { backend: value } })}
                    style={{ "margin-top": "3px" }}
                  />
                  <span>
                    <span style={{ display: "block" }}>{language.t(`settings.browser.backend.${value}`)}</span>
                    <Subtitle text={language.t(`settings.browser.backend.${value}.description`)} />
                  </span>
                </label>
              )}
            </For>
          </div>
          <SettingsRow
            title={language.t("settings.browser.observation.title")}
            description={language.t("settings.browser.observation.description")}
          >
            <Select
              options={[...OBSERVATIONS]}
              current={state()?.observation ?? "full"}
              value={(value) => value}
              label={(value) => language.t(`settings.browser.observation.${value}`)}
              onSelect={(value) => {
                if (!value || value === state()?.observation) return
                browser.write({ browser: { observation: value } })
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.browser.sensitive.title")}
            description={language.t("settings.browser.sensitive.description")}
            last
          >
            <Switch
              checked={state()?.allowSensitive === true}
              onChange={(checked) => browser.write({ browser: { allow_sensitive: checked } })}
              hideLabel
            >
              {language.t("settings.browser.sensitive.title")}
            </Switch>
          </SettingsRow>
        </Card>
      </div>

      <div>
        <Header title={language.t("settings.browser.status.title")} />
        <Card>
          <SettingsRow
            title={language.t("settings.browser.status.playwright")}
            description={disconnected() ? language.t("settings.browser.status.extension.hint") : undefined}
          >
            <Show
              when={!browser.status()?.playwright.ready}
              fallback={
                <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                  {language.t("settings.browser.status.playwright.ready", {
                    browser: TARGETS[browser.status()?.playwright.target ?? "chromium"],
                  })}
                </span>
              }
            >
              <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                <span style={{ color: "var(--vscode-errorForeground)" }}>
                  {language.t("settings.browser.status.playwright.missing")}
                </span>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={browser.installing()}
                  onClick={() => browser.install()}
                >
                  <Show when={browser.installing()} fallback={language.t("settings.browser.status.playwright.install")}>
                    <Spinner /> {language.t("settings.browser.status.playwright.installing")}
                  </Show>
                </Button>
              </div>
            </Show>
          </SettingsRow>
          <SettingsRow title={language.t("settings.browser.status.extension")} last>
            <span
              style={{
                color: browser.status()?.extension.connected
                  ? "var(--vscode-descriptionForeground)"
                  : "var(--vscode-errorForeground)",
              }}
            >
              {browser.status()?.extension.connected
                ? language.t("settings.browser.status.extension.connected")
                : language.t("settings.browser.status.extension.disconnected")}
            </span>
          </SettingsRow>
        </Card>
      </div>

      <div>
        <Header title={language.t("settings.browser.origins.title")} />
        <Card>
          <SettingsRow
            title={language.t("settings.browser.origins.allowAll.title")}
            description={language.t("settings.browser.origins.allowAll.description")}
            last={rows().length === 0 && !browser.error()}
          >
            <Switch
              checked={state()?.allowAll === true}
              onChange={(checked) => browser.write({ allowAll: checked })}
              hideLabel
            >
              {language.t("settings.browser.origins.allowAll.title")}
            </Switch>
          </SettingsRow>
          <Show when={rows().length > 0}>
            <div
              style={{
                display: "grid",
                "grid-template-columns": "minmax(0, 1fr) repeat(3, auto) 32px",
                gap: "8px",
                "align-items": "center",
                padding: "8px 0",
                "border-bottom": "1px solid var(--border-weak-base)",
              }}
            >
              <span data-slot="settings-row-label-subtitle">{language.t("settings.browser.origins.site")}</span>
              <For each={GRANTS}>
                {(grant) => (
                  <span data-slot="settings-row-label-subtitle">{language.t(`settings.browser.origins.${grant}`)}</span>
                )}
              </For>
              <span />
              <For each={rows()}>
                {(row) => (
                  <>
                    <span
                      data-search-label={row.origin}
                      style={{
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                      title={row.origin}
                    >
                      {row.origin}
                    </span>
                    <For each={GRANTS}>
                      {(grant) => (
                        <ActionSelect
                          level={row[grant]}
                          onChange={(effect) => browser.write({ cell: { origin: row.origin, type: grant, effect } })}
                        />
                      )}
                    </For>
                    <IconButton
                      variant="ghost"
                      size="small"
                      icon="close"
                      aria-label={language.t("common.delete")}
                      title={language.t("common.delete")}
                      onClick={() => browser.write({ remove: row.origin })}
                    />
                  </>
                )}
              </For>
            </div>
          </Show>
          <Show when={rows().length === 0}>
            <Subtitle text={language.t("settings.browser.origins.empty")} />
          </Show>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px", padding: "12px 0 4px" }}>
            <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
              <div style={{ width: "260px" }}>
                <TextField
                  type="text"
                  value={draft()}
                  placeholder={language.t("settings.browser.origins.placeholder")}
                  label={language.t("settings.browser.origins.add")}
                  hideLabel
                  onChange={(value: string) => {
                    setDraft(value)
                    setOriginError(undefined)
                  }}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    addOrigin()
                  }}
                />
              </div>
              <Button variant="secondary" size="small" onClick={addOrigin} disabled={browser.busy()}>
                {language.t("common.add")}
              </Button>
            </div>
            <Show when={originError()}>
              {(reason) => (
                <span style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-12)" }}>
                  {language.t(`settings.browser.origins.error.${reason()}`)}
                </span>
              )}
            </Show>
            <Show when={browser.error()}>
              {(message) => (
                <span style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-12)" }}>
                  {message() || language.t("settings.saveBar.saveFailed")}
                </span>
              )}
            </Show>
          </div>
        </Card>
      </div>
    </>
  )
}

export default BrowserTab
