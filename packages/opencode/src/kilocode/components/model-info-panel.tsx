import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import type { Model } from "@kilocode/sdk/v2"
import { avgPrice, fmtCachedPrice, fmtContext, fmtPrice } from "./model-info-panel-utils"
import { Show } from "solid-js"

interface Props {
  model: Model
  provider: string
}

export function ModelInfoPanel(props: Props) {
  const { theme } = useTheme()
  const m = () => props.model

  return (
    <box
      width={30}
      border={["left"]}
      borderColor={theme.border}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      gap={1}
      flexShrink={0}
    >
      <box>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {m().name ?? m().id ?? "Model"}
        </text>
        <text fg={theme.textMuted}>{props.provider ?? m().providerID ?? ""}</text>
      </box>
      <box>
        <Show when={m().isFree}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text}>Free</text>
          </box>
        </Show>
        <Show when={!m().isFree}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Input</text>
            <text fg={theme.text}>{m() ? fmtPrice(m().cost.input) : "—"}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Output</text>
            <text fg={theme.text}>{m() ? fmtPrice(m().cost.output) : "—"}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Cache Read</text>
            <text fg={theme.text}>{m() ? fmtCachedPrice(m().cost) : "—"}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between"></box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Context Size</text>
            <text fg={theme.text}>{m() ? fmtContext(m().limit.context) : "—"}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Average Cost</text>
            <text fg={theme.text}>{m() ? fmtPrice(avgPrice(m().cost)) : "—"}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
