import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { Model } from "@kilocode/sdk/v2"
import { avgPrice, fmtCachedPrice, fmtContext, fmtDate, fmtPrice } from "./model-info-panel-utils"

interface Props {
  model: Model
  provider: string
}

export function ModelInfoPanel(props: Props) {
  const { theme } = useTheme()
  const m = () => props.model
  const dimensions = useTerminalDimensions()

  const maxHeight = createMemo(() => Math.floor(dimensions().height / 2) - 3)

  const cost = () => m().cost
  const cached = () => (cost() ? fmtCachedPrice(cost()) : null)
  const avg = () => (cost() ? avgPrice(cost()) : undefined)
  const caps = () => m().capabilities
  const inputs = () => caps()?.input
  const outputs = () => caps()?.output
  const activeInputModalities = () => {
    if (!inputs()) return [] as string[]
    return Object.entries(inputs())
      .filter(([k, v]) => v && k !== "text")
      .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
  }
  const activeOutputModalities = () => {
    if (!outputs()) return [] as string[]
    return Object.entries(outputs())
      .filter(([k, v]) => v && k !== "text")
      .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
  }
  const inputLine = () => {
    const mods = activeInputModalities()
    return mods.length > 0 ? `In: ${mods.join(", ")}` : null
  }
  const outputLine = () => {
    const mods = activeOutputModalities()
    return mods.length > 0 ? `Out: ${mods.join(", ")}` : null
  }
  const desc = () => {
    const d = m().options?.description
    return typeof d === "string" && d.trim() ? d : null
  }

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
      <scrollbox
        maxHeight={maxHeight()}
        paddingRight={1}
      >
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {m().name ?? m().id ?? "Model"}
          </text>
          <text fg={theme.textMuted}>{props.provider ?? m().providerID ?? ""}</text>
        </box>
        <Show when={m().isFree}>
          <box>
            <text fg={theme.text}>Free</text>
          </box>
        </Show>
        <Show when={m().family}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Family</text>
            <text fg={theme.text}>{m().family!.charAt(0).toUpperCase() + m().family!.slice(1)}</text>
          </box>
        </Show>
        <Show when={m().release_date}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.textMuted}>Released</text>
            <text fg={theme.text}>{fmtDate(m().release_date)}</text>
          </box>
        </Show>
        <Show when={!m().isFree}>
          <box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>Input</text>
              <text fg={theme.text}>{m() ? fmtPrice(m().cost.input) : "—"}</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>Output</text>
              <text fg={theme.text}>{m() ? fmtPrice(m().cost.output) : "—"}</text>
            </box>
            <Show when={cached()}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Cached</text>
                <text fg={theme.text}>{cached()}</text>
              </box>
            </Show>
            <Show when={avg() !== undefined}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Avg Cost</text>
                <text fg={theme.text}>{m() ? fmtPrice(avg()!) : "—"}</text>
              </box>
            </Show>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>Context</text>
              <text fg={theme.text}>{m() ? fmtContext(m().limit.context) : "—"}</text>
            </box>
          </box>
        </Show>
        <Show when={caps()?.reasoning || inputLine() || outputLine()}>
          <box flexDirection="column">
            <Show when={caps()?.reasoning}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Reasoning</text>
                <text fg={theme.text}>Yes</text>
              </box>
            </Show>
            <Show when={inputLine()}>
              {(line) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>Caps</text>
                  <text fg={theme.text}>{line().replace(/^In:\s*/, "")}</text>
                </box>
              )}
            </Show>
            <Show when={outputLine()}>
              {(line) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>Out</text>
                  <text fg={theme.text}>{line().replace(/^Out:\s*/, "")}</text>
                </box>
              )}
            </Show>
          </box>
        </Show>
        <Show when={desc()}>
          <text fg={theme.textMuted}>{" "}</text>
          <text fg={theme.textMuted} width={23}>
            {desc()}
          </text>
        </Show>
      </scrollbox>
    </box>
  )
}
