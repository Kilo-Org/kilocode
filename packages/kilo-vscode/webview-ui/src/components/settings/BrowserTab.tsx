// Web Tools tab. Web Search maps the v2 `websearch` selection: `false` is off, a provider selection is on. The
// Integrated Browser is a `kilo-code.v2.*` editor setting, so its rows write that. The browser tools' backend,
// observation, sensitive steps and site permissions are the `browser` config keys the CLI reads; the host owns those
// writes, and the status line reports what this machine can start.
import { Component, For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
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
import { useV2 } from "../../v2/client"
import { GRANTS, extensionRow, origin, savedGrants, sites, type ExtensionRow, type SavedGrant } from "./browser-settings"
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

/** How often the status rows read the machine again while the tab is visible: a hub starting, an extension connecting. */
const STATUS_POLL = 2_000

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
 * A status row before the host has answered: the read's failure once it is known, so a failed first read never leaves
 * the row claiming it is still loading.
 */
const StatusPlaceholder: Component<{ error?: string }> = (props) => {
  const language = useLanguage()
  return (
    <Show
      when={!props.error}
      fallback={
        <span style={{ color: "var(--vscode-errorForeground)" }}>{language.t("settings.browser.status.failed")}</span>
      }
    >
      <span style={{ color: "var(--vscode-descriptionForeground)" }}>{language.t("common.loading")}</span>
    </Show>
  )
}

/** The extension status row: off, not connected, waiting for the extension, or the connected browser and profile. */
const ExtensionStatus: Component<{ row: ExtensionRow; backend: string }> = (props) => {
  const language = useLanguage()
  // Only a backend that needs the extension makes a missing one a problem.
  const color = () =>
    props.backend === "extension" && props.row.kind !== "connected"
      ? "var(--vscode-errorForeground)"
      : "var(--vscode-descriptionForeground)"
  const text = () => {
    const row = props.row
    if (row.kind === "connected") return `${language.t("settings.browser.status.extension.connected")} · ${row.label}`
    if (row.kind === "waiting") return language.t("settings.browser.status.extension.waiting")
    if (row.kind === "off") return language.t("settings.browser.backend.off")
    return language.t("settings.browser.status.extension.disconnected")
  }
  return (
    <span data-slot="browser-extension-status" data-state={props.row.kind} style={{ color: color() }}>
      {text()}
    </span>
  )
}

/** The project's saved browser grants: loading, unavailable with a retry, none yet, or one row each with a revoke. */
type Saved = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; grants: SavedGrant[] }

const SavedGrants: Component<{ saved: Saved; onRetry: () => void; onRevoke: (id: string) => void }> = (props) => {
  const language = useLanguage()
  const grants = () => (props.saved.kind === "ready" ? props.saved.grants : [])
  return (
    <div data-slot="browser-saved-grants" style={{ padding: "12px 0 4px", "border-top": "1px solid var(--border-weak-base)" }}>
      <div style={{ "font-weight": 500, "margin-bottom": "2px" }}>
        {language.t("settings.browser.origins.saved.title")}
      </div>
      <Subtitle text={language.t("settings.browser.origins.saved.description")} />
      <Show when={props.saved.kind === "loading"}>
        <Subtitle text={language.t("common.loading")} />
      </Show>
      <Show when={props.saved.kind === "failed"}>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0 0" }}>
          <span style={{ color: "var(--vscode-errorForeground)" }}>
            {language.t("settings.browser.origins.saved.failed")}
          </span>
          <Button variant="secondary" size="small" onClick={() => props.onRetry()}>
            {language.t("common.retry")}
          </Button>
        </div>
      </Show>
      <Show when={props.saved.kind === "ready" && grants().length === 0}>
        <Subtitle text={language.t("settings.browser.origins.saved.empty")} />
      </Show>
      <Show when={grants().length > 0}>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "minmax(0, 1fr) auto 32px",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0 0",
          }}
        >
          <For each={grants()}>
            {(grant) => (
              <>
                <span
                  data-slot="browser-saved-grant"
                  style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
                  title={grant.origin}
                >
                  {grant.origin}
                </span>
                <span data-slot="settings-row-label-subtitle">
                  {grant.tool === "browser"
                    ? language.t(`settings.browser.origins.${grant.grant}`)
                    : language.t("ui.permission.toolLabel.browserOpen")}
                </span>
                <IconButton
                  variant="ghost"
                  size="small"
                  icon="close"
                  aria-label={language.t("settings.browser.origins.saved.revoke")}
                  title={language.t("settings.browser.origins.saved.revoke")}
                  onClick={() => props.onRevoke(grant.id)}
                />
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

/**
 * The browser tools' settings and the site permission table. The state comes from the host, which owns the config
 * file, so a row always shows what the CLI reads.
 */
const BrowserTools: Component = () => {
  const language = useLanguage()
  const browser = createBrowserSettings()
  const [draft, setDraft] = createSignal("")
  const [originError, setOriginError] = createSignal<"empty" | "invalid" | "duplicate">()
  // The radio the user just clicked shows at once; a reply (success or failure) clears it, so a refused write falls
  // back to the value the file still holds instead of leaving the unsaved one checked.
  const [chosen, setChosen] = createSignal<(typeof BACKENDS)[number]>()
  const v2 = useV2()
  const [saved, setSaved] = createSignal<Saved>({ kind: "loading" })
  // Saved grants belong to the workspace's project: the project of this panel's directory. Each read is numbered and
  // only the newest one may publish, so a slow read that started before a revoke cannot bring the revoked row back.
  let reads = 0
  const loadSaved = () => {
    const read = ++reads
    const publish = (value: Saved) => {
      if (read === reads) setSaved(value)
    }
    return v2.api.location
      .get({ location: { directory: v2.directory } })
      .then((location) => v2.api.permission.saved.list({ projectID: location.project.id }))
      .then(
        (rows) => publish({ kind: "ready", grants: savedGrants(rows) }),
        () => publish({ kind: "failed" }),
      )
  }
  const revoke = (id: string) =>
    void v2.api.permission.saved
      .remove({ id })
      .catch(v2.report)
      .finally(() => void loadSaved())
  onMount(() => {
    browser.load()
    void loadSaved()
    // The status follows the machine while the tab is visible; coming back to the tab reads both again at once.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") browser.refresh()
    }, STATUS_POLL)
    const shown = () => {
      if (document.visibilityState !== "visible") return
      browser.refresh()
      void loadSaved()
    }
    document.addEventListener("visibilitychange", shown)
    onCleanup(() => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", shown)
    })
  })
  createEffect(() => {
    if (!browser.busy()) setChosen(undefined)
  })

  const state = () => browser.state()
  const backend = () => chosen() ?? state()?.backend
  const rows = () => sites(state()?.rules ?? [])
  const disconnected = () => {
    const extension = browser.status()?.extension
    return state()?.backend === "extension" && extension !== undefined && extension.state !== "connected"
  }

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
                    checked={backend() === value}
                    disabled={!state() || browser.busy()}
                    onChange={() => {
                      setChosen(value)
                      browser.write({ browser: { backend: value } })
                    }}
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
              current={state()?.observation ?? "diff"}
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
        <Show when={browser.error()}>
          {(message) => (
            <div
              style={{
                color: "var(--vscode-errorForeground)",
                "font-size": "var(--kilo-font-size-12)",
                "padding-top": "6px",
              }}
            >
              {message() || language.t("settings.saveBar.saveFailed")}
            </div>
          )}
        </Show>
      </div>

      <div>
        <Header title={language.t("settings.browser.status.title")} />
        <Card>
          <SettingsRow title={language.t("settings.browser.status.playwright")}>
            <Show when={browser.status()} fallback={<StatusPlaceholder error={browser.error()} />}>
              {(status) => (
                <Show
                  when={status().playwright.ready}
                  fallback={
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
                        <Show
                          when={browser.installing()}
                          fallback={language.t("settings.browser.status.playwright.install")}
                        >
                          <Spinner /> {language.t("settings.browser.status.playwright.installing")}
                        </Show>
                      </Button>
                    </div>
                  }
                >
                  <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                    {language.t("settings.browser.status.playwright.ready", {
                      browser: TARGETS[status().playwright.target ?? "chromium"],
                    })}
                  </span>
                </Show>
              )}
            </Show>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.browser.status.extension")}
            description={disconnected() ? language.t("settings.browser.status.extension.hint") : undefined}
            last
          >
            <Show when={browser.status()} fallback={<StatusPlaceholder error={browser.error()} />}>
              {(status) => (
                <ExtensionStatus row={extensionRow(state()?.backend, status().extension)} backend={state()?.backend ?? ""} />
              )}
            </Show>
          </SettingsRow>
          {/* The config read is what failed: a status refresh that succeeds afterwards must not take the retry away. */}
          <Show when={!browser.state() && browser.error()}>
            <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0 4px" }}>
              <Button variant="secondary" size="small" disabled={browser.busy()} onClick={() => browser.load()}>
                {language.t("common.retry")}
              </Button>
            </div>
          </Show>
          <Show when={browser.installing() && browser.progress()}>
            {(line) => <Subtitle text={line().split("\n").filter(Boolean).slice(-1)[0] ?? ""} />}
          </Show>
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
            <Subtitle
              text={language.t(
                state()?.allowAll ? "settings.browser.origins.empty.allowed" : "settings.browser.origins.empty",
              )}
            />
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
          </div>
          <SavedGrants saved={saved()} onRetry={() => void loadSaved()} onRevoke={revoke} />
        </Card>
      </div>
    </>
  )
}

export default BrowserTab
