// Details of the highlighted model next to the model picker, as in v1 `kilocode/components/model-info-panel.tsx`.
// Kilo models add Gateway metadata: BYOK and training disclosures, description and Terminal Bench results.
import type { ModelInfo } from "@opencode/client" // kilo_port(unattributed:tui/component:442c6f2a6ad9)
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { FreeModelDisclosure } from "./free-model-disclosure"
import {
  avgPrice,
  fmtAttemptCost,
  fmtCachedPrice,
  fmtContext,
  fmtDate,
  fmtPrice,
  fmtScore,
} from "./model-info-panel-utils"

export function ModelInfoPanel(props: { model: ModelInfo; provider: string; gateway?: KiloGatewayRpc.ModelEntry }) {
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  // The base price tier. Context tiers only add higher prices for long prompts.
  const cost = () => props.model.cost.find((item) => !item.tier) ?? props.model.cost[0]
  const priced = () => (cost()?.input ?? 0) > 0 || (cost()?.output ?? 0) > 0
  const modalities = (values: readonly string[]) =>
    values.filter((value) => value !== "text").map((value) => value.charAt(0).toUpperCase() + value.slice(1))
  const description = () => props.gateway?.description?.trim()
  // A component, so that the value stays reactive when the highlighted model changes.
  const Row = (row: { label: string; value: string }) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.text.muted}>{row.label}</text>
      <text fg={theme.text.base}>{row.value}</text>
    </box>
  )

  return (
    <box
      width={30}
      border={["left"]}
      borderColor={theme.border.base}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      flexShrink={0}
    >
      <scrollbox maxHeight={Math.floor(dimensions().height / 2) - 3} paddingRight={1}>
        <box>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            {props.model.name}
          </text>
          <text fg={theme.text.muted}>{props.provider}</text>
        </box>
        <Show when={FreeModelDisclosure.hasByok(props.gateway)}>
          <text fg={theme.text.base}>{FreeModelDisclosure.byok}</text>
        </Show>
        <Show when={FreeModelDisclosure.collectsData(props.gateway)}>
          <text fg={theme.text.base}>{FreeModelDisclosure.panel}</text>
        </Show>
        <Show when={props.model.family}>
          {(family) => <Row label="Family" value={family().charAt(0).toUpperCase() + family().slice(1)} />}
        </Show>
        <Show when={props.model.time.released > 0}>
          <Row label="Released" value={fmtDate(props.model.time.released)} />
        </Show>
        {/* As in v1, a free Gateway model shows no pricing and no context rows. */}
        <Show when={!props.gateway?.isFree}>
          <Show when={priced() && cost()}>
            {(value) => (
              <box>
                <Row label="Input" value={fmtPrice(value().input)} />
                <Row label="Output" value={fmtPrice(value().output)} />
                <Show when={fmtCachedPrice(value())}>{(cached) => <Row label="Cached" value={cached()} />}</Show>
                <Row label="Avg Cost" value={fmtPrice(avgPrice(value()))} />
              </box>
            )}
          </Show>
          <Row label="Context" value={fmtContext(props.model.limit.context)} />
        </Show>
        <Show when={props.gateway?.terminalBench}>
          {(bench) => (
            <box>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                Terminal Bench 2.0
              </text>
              <Row label="Completion" value={fmtScore(bench().overallScore)} />
              <Row label="Cost / attempt" value={fmtAttemptCost(bench().avgAttemptCostUsd)} />
            </box>
          )}
        </Show>
        <Show when={props.gateway?.reasoning}>
          <Row label="Reasoning" value={"Yes"} />
        </Show>
        <For
          each={
            [
              ["Caps", modalities(props.model.capabilities.input)],
              ["Out", modalities(props.model.capabilities.output)],
            ] as const
          }
        >
          {([label, values]) => (
            <Show when={values.length > 0}>
              <Row label={label} value={values.join(", ")} />
            </Show>
          )}
        </For>
        <Show when={description()}>
          {(text) => (
            <box paddingTop={1}>
              <text fg={theme.text.muted} width={23}>
                {text()}
              </text>
            </box>
          )}
        </Show>
      </scrollbox>
    </box>
  )
}
