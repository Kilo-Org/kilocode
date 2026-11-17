import { Component, For, Show, createSignal } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import type { UiI18nKey } from "@kilocode/kilo-ui/context"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import type { BrowserConfig } from "../../types/messages"
import type { PermissionRule } from "../../types/messages/permissions"
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
type Class = "read" | "act" | "navigate"

const CLASSES: Class[] = ["read", "act", "navigate"]

/** Split `<class>:<origin>` into the two parts the editor shows; anything else is not a browser rule. */
function rule(value: string): { class: Class; origin: string } | undefined {
  const index = value.indexOf(":")
  if (index < 1) return undefined
  const cls = value.slice(0, index)
  if (cls !== "read" && cls !== "act" && cls !== "navigate") return undefined
  const origin = value.slice(index + 1)
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return undefined
  return { class: cls, origin }
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim()
  if (!/^https?:\/\/[^\s/]+/.test(trimmed)) return undefined
  try {
    return new URL(trimmed).origin
  } catch {
    return undefined
  }
}

const BACKENDS: { value: Backend; labelKey: UiI18nKey; descriptionKey: UiI18nKey }[] = [
  {
    value: "off",
    labelKey: "settings.browser.backend.off",
    descriptionKey: "settings.browser.backend.off.description",
  },
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
  const [origin, setOrigin] = createSignal("")
  const [classes, setClasses] = createSignal<Class[]>(["read"])

  const selected = () => BACKENDS.find((item) => item.value === (globalConfig().browser?.backend ?? "playwright"))

  // permission.browser is either a scalar ("allow" allows every site) or the rule map.
  const saved = (): PermissionRule | undefined => globalConfig().permission?.browser
  const allowAll = () => saved() === "allow"
  const allowlist = () => {
    const value = saved()
    if (!value || typeof value !== "object") return []
    return Object.entries(value)
      .filter(([pattern, action]) => action === "allow" && rule(pattern))
      .map(([pattern]) => ({ pattern, ...rule(pattern)! }))
  }

  const toggleClass = (value: Class) =>
    setClasses((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )

  const add = () => {
    const value = normalizeOrigin(origin())
    if (!value || classes().length === 0) return
    const rules = Object.fromEntries(classes().map((cls) => [`${cls}:${value}`, "allow" as const]))
    updateGlobalConfig({ permission: { browser: rules } })
    setOrigin("")
  }

  const remove = (pattern: string) =>
    // null is the config delete sentinel: it removes the one rule and keeps the rest.
    updateGlobalConfig({ permission: { browser: { [pattern]: null } } })

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
          <SettingsRow title={t("settings.browser.backend.title")} description={backendDescription()} last>
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

      <div>
        <Header title={t("settings.browser.permissions.title")} />
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--vscode-descriptionForeground)",
            "font-size": "var(--kilo-font-size-12)",
            "line-height": "1.5",
          }}
        >
          {t("settings.browser.permissions.description")}
        </p>
        <Card>
          <SettingsRow
            title={t("settings.browser.allowAll.title")}
            description={t("settings.browser.allowAll.description")}
            last={allowAll()}
          >
            <Switch
              checked={allowAll()}
              onChange={(checked) =>
                // "Allow all" is the scalar form; turning it off restores the built-in defaults.
                updateGlobalConfig({ permission: { browser: checked ? "allow" : null } })
              }
              hideLabel
            >
              {t("settings.browser.allowAll.title")}
            </Switch>
          </SettingsRow>
          <Show when={!allowAll()}>
            <div style={{ padding: "8px 0", "border-top": "1px solid var(--border-weak-base)" }}>
              <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                <div style={{ flex: 1 }}>
                  <TextField
                    value={origin()}
                    placeholder={t("settings.browser.allowlist.placeholder")}
                    onChange={(value) => setOrigin(value)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === "Enter") add()
                    }}
                  />
                </div>
                <Button variant="secondary" onClick={add} disabled={!normalizeOrigin(origin()) || classes().length === 0}>
                  {t("settings.browser.allowlist.add")}
                </Button>
              </div>
              <div style={{ display: "flex", gap: "16px", "align-items": "center", "margin-top": "8px" }}>
                <For each={CLASSES}>
                  {(value) => (
                    <label style={{ display: "flex", gap: "6px", "align-items": "center", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={classes().includes(value)}
                        onChange={() => toggleClass(value)}
                      />
                      <span style={{ "font-size": "var(--kilo-font-size-12)" }}>
                        {t(`settings.browser.class.${value}` as UiI18nKey)}
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <Show
              when={allowlist().length > 0}
              fallback={
                <div
                  style={{
                    padding: "8px 0 4px",
                    color: "var(--vscode-descriptionForeground)",
                    "font-size": "var(--kilo-font-size-12)",
                  }}
                >
                  {t("settings.browser.allowlist.empty")}
                </div>
              }
            >
              <div style={{ "border-top": "1px solid var(--border-weak-base)" }}>
                <For each={allowlist()}>
                  {(entry, index) => (
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        padding: "6px 0",
                        "border-bottom":
                          index() < allowlist().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                      }}
                    >
                      <span
                        style={{
                          "font-family": "var(--vscode-editor-font-family, monospace)",
                          "font-size": "var(--kilo-font-size-12)",
                        }}
                      >
                        {`${t(`settings.browser.class.${entry.class}` as UiI18nKey)} · ${entry.origin}`}
                      </span>
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="close"
                        onClick={() => remove(entry.pattern)}
                        aria-label={t("settings.browser.allowlist.remove")}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
          <SettingsRow
            title={t("settings.browser.allowSensitive.title")}
            description={t("settings.browser.allowSensitive.description")}
            last
          >
            <Switch
              checked={globalConfig().browser?.allowSensitive ?? false}
              onChange={(checked) => updateGlobalConfig({ browser: { allowSensitive: checked } })}
              hideLabel
            >
              {t("settings.browser.allowSensitive.title")}
            </Switch>
          </SettingsRow>
          <Show when={globalConfig().browser?.allowSensitive ?? false}>
            <div
              style={{
                padding: "8px 0 4px",
                color: "var(--vscode-editorWarning-foreground)",
                "font-size": "var(--kilo-font-size-12)",
                "line-height": "1.5",
              }}
            >
              {t("settings.browser.allowSensitive.warning")}
            </div>
          </Show>
        </Card>
      </div>
    </div>
  )
}

export default BrowserTab
