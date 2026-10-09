/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@kilocode/sdk/v2"
import { Show, createMemo } from "solid-js"
import type { RunFooterTheme } from "@/cli/cmd/run/theme"

export function Reason(props: { request: PermissionRequest; theme: RunFooterTheme }) {
  const description = createMemo(() => {
    if (!["read", "external_directory", "bash"].includes(props.request.permission)) return undefined
    if (
      props.request.permission === "bash" &&
      (props.request.metadata.skillShell === true || props.request.metadata.backgroundProcess === true)
    )
      return undefined
    const value = props.request.metadata.description
    return typeof value === "string" ? value.trim() : undefined
  })
  return (
    <Show when={description()}>
      {(value) => (
        <box paddingLeft={1}>
          <text fg={props.theme.text} wrapMode="word">
            Reason: <i>{value()}</i>
          </text>
        </box>
      )}
    </Show>
  )
}
