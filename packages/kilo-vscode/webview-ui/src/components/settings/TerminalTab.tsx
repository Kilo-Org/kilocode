import { Component } from "solid-js"
import { useLanguage } from "../../context/language"

const TerminalTab: Component = () => {
  const language = useLanguage()

  return (
    <div>
      <div
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "16px",
        }}
      >
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          <strong style={{ color: "var(--vscode-foreground)" }}>{language.t("settings.notImplemented")}</strong>{" "}
          {language.t("settings.notImplemented.description")}
        </p>
      </div>
    </div>
  )
}

export default TerminalTab
