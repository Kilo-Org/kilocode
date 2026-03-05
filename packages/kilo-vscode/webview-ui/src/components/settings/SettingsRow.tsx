import { Component, JSX } from "solid-js"

const SettingsRow: Component<{ title: string; description: string; last?: boolean; children: JSX.Element }> = (
  props,
) => (
  <div
    data-slot="settings-row"
    style={{
      "margin-bottom": props.last ? "0" : "8px",
      "padding-bottom": props.last ? "0" : "8px",
      "border-bottom": props.last ? "none" : "1px solid var(--border-weak-base)",
    }}
  >
    <div data-slot="settings-row-label">
      <div data-slot="settings-row-label-title">{props.title}</div>
      <div data-slot="settings-row-label-subtitle">{props.description}</div>
    </div>
    <div data-slot="settings-row-input">{props.children}</div>
  </div>
)

export default SettingsRow
