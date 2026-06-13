import { Tag } from "@kilocode/kilo-ui/tag"
import { Component, JSX, Show } from "solid-js"

const SettingsRow: Component<{
  title: string
  description?: string
  tag?: () => string | undefined
  last?: boolean
  children: JSX.Element
}> = (props) => (
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
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          "flex-wrap": "wrap",
          ...(props.description === null || props.description === undefined ? { "margin-bottom": "0" } : {}),
        }}
      >
        <span>{props.title}</span>
        <Show when={props.tag?.()}>{(tag) => <Tag>{tag()}</Tag>}</Show>
      </div>
      {props.description !== null && props.description !== undefined && (
        <div data-slot="settings-row-label-subtitle">{props.description}</div>
      )}
    </div>
    <div data-slot="settings-row-input">{props.children}</div>
  </div>
)

export default SettingsRow
