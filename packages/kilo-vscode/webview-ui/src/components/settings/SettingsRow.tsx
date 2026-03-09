import { Component, JSX } from "solid-js"

const SettingsRow: Component<{ title: string; description?: string; last?: boolean; children: JSX.Element }> = (
  props,
) => (
  <div
    data-slot="settings-row"
    style={{
      "margin-bottom": props.last ? "0" : "8px",
      "padding-bottom": props.last ? "0" : "8px",
      "border-bottom": props.last ? "none" : "1px solid var(--border-weak-base)",
      ...(props.description == null ? { "align-items": "center" } : {}),
    }}
  >
    <div data-slot="settings-row-label">
      <div data-slot="settings-row-label-title" style={props.description == null ? { "margin-bottom": "0" } : {}}>
        {props.title}
      </div>
      {props.description != null && <div data-slot="settings-row-label-subtitle">{props.description}</div>}
    </div>
    <div data-slot="settings-row-input">{props.children}</div>
  </div>
)

export default SettingsRow
