import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { showToast } from "@kilocode/kilo-ui/toast"
import { createSignal, type Component } from "solid-js"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { SettingsData } from "../../v2/settings"
import { useSettingsConfig } from "../../v2/settings-config"
import { buildExport, MAX_IMPORT_SIZE, parseImport } from "./settings-io"

type ConnectionState = "connected" | "connecting" | "disconnected" | "error"

export interface AboutKiloCodeTabProps {
  settings: SettingsData
  onLogin: () => void
}

const AboutKiloCodeTab: Component<AboutKiloCodeTabProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  const config = useSettingsConfig()
  const [importing, setImporting] = createSignal(false)

  const open = (url: string) => props.settings.open(url)
  const post = (message: unknown) => vscode.postMessage(message as never)

  const connectionState = (): ConnectionState => {
    const status = props.settings.connection()
    if (status === "connected") return "connected"
    if (status === "connecting") return "connecting"
    // The event stream dropped and retries: the server is not reachable.
    return "disconnected"
  }

  const getStatusColor = () => {
    switch (connectionState()) {
      case "connected":
        return "var(--vscode-testing-iconPassed, #89d185)"
      case "connecting":
        return "var(--vscode-testing-iconQueued, #cca700)"
      case "disconnected":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
      case "error":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
    }
  }

  const getStatusText = () => {
    switch (connectionState()) {
      case "connected":
        return language.t("settings.aboutKiloCode.status.connected")
      case "connecting":
        return language.t("settings.aboutKiloCode.status.connecting")
      case "disconnected":
        return language.t("settings.aboutKiloCode.status.disconnected")
      case "error":
        return language.t("settings.aboutKiloCode.status.error")
    }
  }

  const handleExport = () => {
    const payload = buildExport(config.raw("global"))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "kilo-settings.json"
    document.body.appendChild(anchor)
    anchor.click()
    // Revoke after the download starts and drop the anchor; a synchronous revoke can abort it.
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      anchor.remove()
    }, 0)
  }

  const handleImport = () => {
    if (importing()) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.style.display = "none"
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > MAX_IMPORT_SIZE) {
        showToast({ variant: "error", title: language.t("settings.aboutKiloCode.importSettings.tooLarge") })
        return
      }
      setImporting(true)
      const reader = new FileReader()
      reader.onload = async () => {
        setImporting(false)
        const result = parseImport(reader.result as string)
        if (!result.ok) {
          const key =
            result.error === "invalidJson"
              ? "settings.aboutKiloCode.importSettings.invalidJson"
              : "settings.aboutKiloCode.importSettings.invalidConfig"
          showToast({ variant: "error", title: language.t(key) })
          return
        }
        if (result.warning === "newerVersion")
          showToast({ variant: "default", title: language.t("settings.aboutKiloCode.importSettings.newerVersion") })
        // Apply every known key to the global config directly, one write at a time.
        let failed = false
        for (const [key, value] of Object.entries(result.config)) {
          if (!(await config.set([key], value, "global"))) failed = true
        }
        if (failed) {
          showToast({ variant: "error", title: language.t("settings.saveBar.saveFailed") })
          return
        }
        showToast({ variant: "success", title: language.t("settings.aboutKiloCode.importSettings.applied") })
      }
      reader.onerror = () => {
        setImporting(false)
        showToast({ variant: "error", title: language.t("settings.aboutKiloCode.importSettings.invalidJson") })
      }
      reader.readAsText(file)
    })
    document.body.appendChild(input)
    input.click()
    document.body.removeChild(input)
  }

  const handleReset = () => {
    post({ type: "resetAllSettings" })
  }

  const linkStyle = {
    color: "var(--vscode-textLink-foreground)",
    "text-decoration": "none",
    cursor: "pointer",
  } as const

  const sectionStyle = {
    background: "var(--vscode-editor-background)",
    border: "1px solid var(--vscode-panel-border)",
    "border-radius": "4px",
    padding: "16px",
    "margin-bottom": "16px",
  } as const

  const headingStyle = {
    "font-size": "var(--kilo-font-size-13)",
    "font-weight": "600",
    "margin-bottom": "12px",
    "margin-top": "0",
    color: "var(--vscode-foreground)",
  } as const

  const bodyStyle = {
    "font-size": "var(--kilo-font-size-12)",
    color: "var(--vscode-descriptionForeground)",
    margin: "0 0 12px 0",
    "line-height": "1.5",
  } as const

  const labelStyle = {
    "font-size": "var(--kilo-font-size-12)",
    color: "var(--vscode-descriptionForeground)",
    width: "100px",
  } as const

  const valueStyle = {
    "font-size": "var(--kilo-font-size-12)",
    color: "var(--vscode-foreground)",
    "font-family": "var(--vscode-editor-font-family, monospace)",
  } as const

  return (
    <div>
      {/* Version Information */}
      <div data-search-label={language.t("settings.aboutKiloCode.versionInfo")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.versionInfo")}</h4>
        <div style={{ display: "flex", "align-items": "center" }}>
          <span style={labelStyle}>{language.t("settings.aboutKiloCode.version.label")}</span>
          <span style={valueStyle}>{props.settings.version() || "—"}</span>
        </div>
      </div>

      {/* Community & Support */}
      <div data-search-label={language.t("settings.aboutKiloCode.community")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.community")}</h4>
        <p style={bodyStyle}>
          {language.t("settings.aboutKiloCode.feedback.prefix")}{" "}
          <span style={linkStyle} onClick={() => open("https://github.com/Kilo-Org/kilocode")}>
            GitHub
          </span>
          ,{" "}
          <span style={linkStyle} onClick={() => open("https://reddit.com/r/kilocode")}>
            Reddit
          </span>
          , {language.t("settings.aboutKiloCode.feedback.or")}{" "}
          <span style={linkStyle} onClick={() => open("https://kilo.ai/discord")}>
            Discord
          </span>
          .
        </p>
        <p style={{ ...bodyStyle, margin: 0 }}>
          {language.t("settings.aboutKiloCode.support.prefix")}{" "}
          <span style={linkStyle} onClick={() => open("https://kilo.ai/support")}>
            kilo.ai/support
          </span>
          .
        </p>
      </div>

      {/* Telemetry */}
      <div data-search-label={language.t("settings.aboutKiloCode.telemetry.title")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.telemetry.title")}</h4>
        <p style={bodyStyle}>{language.t("settings.aboutKiloCode.telemetry.description")}</p>
        <Button
          variant="secondary"
          size="small"
          onClick={() => post({ type: "openVSCodeSettings", query: "telemetry.telemetryLevel" })}
        >
          <Icon name="settings-gear" />
          {language.t("settings.aboutKiloCode.telemetry.openSettings")}
        </Button>
      </div>

      {/* CLI Server */}
      <div data-search-label={language.t("settings.aboutKiloCode.cliServer")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.cliServer")}</h4>
        <div style={{ display: "flex", "align-items": "center" }}>
          <span style={labelStyle}>{language.t("settings.aboutKiloCode.status.label")}</span>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: getStatusColor(),
                display: "inline-block",
              }}
            />
            <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-foreground)" }}>
              {getStatusText()}
            </span>
          </div>
        </div>
      </div>

      {/* Settings Transfer */}
      <div data-search-label={language.t("settings.aboutKiloCode.settingsTransfer.title")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.settingsTransfer.title")}</h4>
        <p style={bodyStyle}>{language.t("settings.aboutKiloCode.settingsTransfer.description")}</p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="secondary" size="small" onClick={handleExport}>
            <Icon name="cloud-upload" />
            {language.t("settings.aboutKiloCode.exportSettings")}
          </Button>
          <Button variant="secondary" size="small" onClick={handleImport} disabled={importing()}>
            <Icon name="download" />
            {language.t("settings.aboutKiloCode.importSettings")}
          </Button>
        </div>
      </div>

      {/* Reset Settings */}
      <div data-search-label={language.t("settings.aboutKiloCode.resetSettings.title")} style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.resetSettings.title")}</h4>
        <p style={bodyStyle}>{language.t("settings.aboutKiloCode.resetSettings.description")}</p>
        <Button variant="primary" size="small" onClick={handleReset}>
          {language.t("settings.aboutKiloCode.resetSettings.button")}
        </Button>
      </div>
    </div>
  )
}

export default AboutKiloCodeTab
