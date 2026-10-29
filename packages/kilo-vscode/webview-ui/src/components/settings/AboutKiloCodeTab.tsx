// Main's About Kilo Code tab on v2 data. The version is the Kilo version from the `kilocode.handshake` RPC, and the
// status is the connection of the webview's event stream. v1 sections without a v2 contract are not rendered:
// the port (the host relays requests, so the webview has no server port), telemetry (no host message to open VS Code
// settings), settings export/import (`api.config.update` patches only `shell`), Roo import and reset settings.
import { Component } from "solid-js"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"

type ConnectionState = "connected" | "connecting" | "disconnected" | "error"

export interface AboutKiloCodeTabProps {
  settings: SettingsData
}

const AboutKiloCodeTab: Component<AboutKiloCodeTabProps> = (props) => {
  const language = useLanguage()

  const open = (url: string) => props.settings.open(url)

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
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.versionInfo")}</h4>
        <div style={{ display: "flex", "align-items": "center" }}>
          <span style={labelStyle}>{language.t("settings.aboutKiloCode.version.label")}</span>
          <span style={valueStyle}>{props.settings.version() || "—"}</span>
        </div>
      </div>

      {/* Community & Support */}
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.community")}</h4>
        <p
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 0 12px 0",
            "line-height": "1.5",
          }}
        >
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
        <p
          style={{
            "font-size": "var(--kilo-font-size-12)",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          {language.t("settings.aboutKiloCode.support.prefix")}{" "}
          <span style={linkStyle} onClick={() => open("https://kilo.ai/support")}>
            kilo.ai/support
          </span>
          .
        </p>
      </div>

      {/* CLI Server */}
      <div style={sectionStyle}>
        <h4 style={headingStyle}>{language.t("settings.aboutKiloCode.cliServer")}</h4>

        {/* Connection Status */}
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
    </div>
  )
}

export default AboutKiloCodeTab
