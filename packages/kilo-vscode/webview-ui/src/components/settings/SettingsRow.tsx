import { Component, JSX } from "solid-js"

const SettingsRow: Component<{ title: string; description: string; last?: boolean; children: JSX.Element }> = (
  props,
) => (
  <div
    data-slot="settings-row"
    style={{
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "space-between",
      padding: "12px 0",
      gap: "8px",
      "border-bottom": props.last ? "none" : "1px solid var(--border-weak-base)",
    }}
  >
    <div style={{ "min-width": "150px", flex: "1 1 200px" }}>
      <div style={{ "font-weight": "500" }}>{props.title}</div>
      <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
        {props.description}
      </div>
    </div>
    {props.children}
  </div>
)

export default SettingsRow
