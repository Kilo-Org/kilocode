import { Component, For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import type {
  AutomationBrowser as Browser,
  AutomationBrowserStatus as Status,
  AutomationBuild as Build,
  BrowserSettings,
  BrowserStatusLoadedMessage,
} from "../../types/messages"
import SettingsRow from "./SettingsRow"

function build(browser: Browser): browser is Build {
  return browser === "chromium" || browser === "firefox" || browser === "webkit"
}

function size(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}

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
  const { postMessage, onMessage } = useVSCode()
  const { t } = useLanguage()
  const { globalConfig, projectConfig, updateGlobalConfig } = useConfig()

  const [settings, setSettings] = createSignal<BrowserSettings>({
    enabled: false,
    browsers: ["chrome"],
  })
  // Empty until the extension has checked which browsers are installed.
  const [status, setStatus] = createSignal<Partial<Record<Browser, Status>>>({})
  const [installing, setInstalling] = createSignal<Browser[]>([])
  const [progress, setProgress] = createSignal<NonNullable<BrowserStatusLoadedMessage["progress"]>>({})
  const [sizes, setSizes] = createSignal<NonNullable<BrowserStatusLoadedMessage["sizes"]>>({})
  // The latest download error of each build, kept until the build is allowed again or installed.
  const [failed, setFailed] = createSignal<Partial<Record<Build, string>>>({})

  const browsers = (): { value: Browser; label: string }[] => [
    { value: "chrome", label: t("settings.browser.browsers.chrome") },
    { value: "chromium", label: t("settings.browser.browsers.chromium") },
    { value: "msedge", label: t("settings.browser.browsers.msedge") },
    { value: "firefox", label: t("settings.browser.browsers.firefox") },
    { value: "webkit", label: t("settings.browser.browsers.webkit") },
  ]

  onMount(() => {
    postMessage({ type: "requestBrowserSettings" })
    postMessage({ type: "requestBrowserStatus" })
  })

  // Subscribe outside onMount to catch early pushes (per AGENTS.md pattern)
  const unsubscribe = onMessage((msg) => {
    if (msg.type === "browserSettingsLoaded") {
      setSettings(msg.settings)
    }
    if (msg.type === "browserStatusLoaded") {
      setStatus((prev) => ({ ...prev, ...msg.status }))
      setInstalling(msg.installing)
      setProgress(msg.progress ?? {})
      if (msg.sizes) setSizes(msg.sizes)
      const error = msg.failed
      if (error) setFailed((prev) => ({ ...prev, [error.browser]: error.message }))
    }
  })
  onCleanup(unsubscribe)

  const update = <K extends keyof BrowserSettings>(key: K, value: BrowserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    postMessage({ type: "updateSetting", key: `browserAutomation.${key}`, value })
  }

  const allowed = (browser: Browser) => settings().browsers.includes(browser)
  // The agent needs at least one browser, so the last allowed one stays on.
  const last = (browser: Browser) => allowed(browser) && settings().browsers.length === 1

  const busy = (browser: Browser) => installing().includes(browser)
  // Chrome and Edge cannot be downloaded, so a missing one cannot be allowed.
  const absent = (browser: Browser) => !build(browser) && status()[browser] === "missing"

  const install = (browser: Build) => {
    setFailed((prev) => ({ ...prev, [browser]: undefined }))
    setInstalling((prev) => [...prev, browser])
    postMessage({ type: "installBrowser", browser })
  }

  const state = (browser: Browser) => {
    const value = status()[browser]
    const amount = build(browser) ? sizes()[browser] : undefined
    if (busy(browser)) {
      const step = build(browser) ? progress()[browser] : undefined
      // Nothing downloads until Playwright has started and named the first file.
      if (!step?.name) return t("settings.browser.status.preparing")
      // A build is several files, each downloaded and then unpacked, so the row names the file and its position.
      const many = step.step !== undefined && step.total !== undefined && step.total > 1
      const name = many ? `${step.name} (${step.step}/${step.total})` : step.name
      if (step.percent >= 100) return t("settings.browser.status.unpacking", { name })
      const text = t("settings.browser.status.downloading", { name, percent: String(step.percent) })
      return step.bytes ? `${text} · ${size(step.bytes)}` : text
    }
    const error = build(browser) ? failed()[browser] : undefined
    if (value === "installed") {
      const text = t("settings.browser.status.installed")
      return amount?.disk ? `${text} · ${t("settings.browser.size.disk", { size: size(amount.disk) })}` : text
    }
    if (error) return t("settings.browser.status.failed", { message: error })
    if (value === "missing") {
      const text = t("settings.browser.status.missing")
      return amount?.download
        ? `${text} · ${t("settings.browser.size.download", { size: size(amount.download) })}`
        : text
    }
    if (value === "unknown") return t("settings.browser.status.unknown")
    return t("settings.browser.status.checking")
  }

  const allow = (browser: Browser, checked: boolean) => {
    if (checked === allowed(browser) || (!checked && last(browser))) return
    if (checked && absent(browser)) return
    // Allowing a Playwright build is the consent to download it. The extension skips a build that is already there.
    if (checked && build(browser) && status()[browser] !== "installed" && !busy(browser)) install(browser)
    update(
      "browsers",
      browsers()
        .map((item) => item.value)
        .filter((value) => (value === browser ? checked : allowed(value))),
    )
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
          {/* Enable toggle */}
          <SettingsRow
            title={t("settings.browser.enable.title")}
            description={t("settings.browser.enable.description")}
            last
          >
            <Switch checked={settings().enabled} onChange={(checked: boolean) => update("enabled", checked)} hideLabel>
              {t("settings.browser.enable.title")}
            </Switch>
          </SettingsRow>
        </Card>

        {/* A subsection of Browser Automation, so its heading is smaller and has no divider. It only applies while the feature is on. */}
        <Show when={settings().enabled}>
          <h5
            style={{
              margin: "16px 0 6px",
              color: "var(--text-base, var(--vscode-foreground))",
              "font-size": "var(--kilo-font-size-14, 14px)",
              "font-weight": 600,
              "line-height": "1.4",
            }}
          >
            {t("settings.browser.browsers.title")}
          </h5>
          <p
            style={{
              margin: "0 0 12px",
              color: "var(--vscode-descriptionForeground)",
              "font-size": "var(--kilo-font-size-12)",
              "line-height": "1.5",
            }}
          >
            {t("settings.browser.browsers.description")}
          </p>
          <Card>
            <For each={browsers()}>
              {(browser, index) => (
                <SettingsRow
                  title={browser.label}
                  description={state(browser.value)}
                  dimmed={absent(browser.value)}
                  last={index() === browsers().length - 1}
                >
                  <Switch
                    checked={allowed(browser.value)}
                    disabled={last(browser.value) || (absent(browser.value) && !allowed(browser.value))}
                    onChange={(checked: boolean) => allow(browser.value, checked)}
                    hideLabel
                  >
                    {browser.label}
                  </Switch>
                </SettingsRow>
              )}
            </For>
          </Card>
        </Show>
      </div>
    </div>
  )
}

export default BrowserTab
