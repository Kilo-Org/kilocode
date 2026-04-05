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
      ...(props.description === null || props.description === undefined ? { "align-items": "center" } : {}),
    }}
  >
    <div data-slot="settings-row-label">
      <div
        data-slot="settings-row-label-title"
        style={props.description === null || props.description === undefined ? { "margin-bottom": "0" } : {}}
      >
        {props.title}
      </div>
      {props.description !== null && props.description !== undefined && (
        <div data-slot="settings-row-label-subtitle">{props.description}</div>
      )}
    </div>
    <div data-slot="settings-row-input">{props.children}</div>
  </div>
)

export default SettingsRow
