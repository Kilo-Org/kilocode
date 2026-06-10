// kilocode_change - new file
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { formatCount, formatRate, getUsage } from "@tui/routes/session/usage"
import { fmtAttemptCost, fmtScore } from "@/kilocode/components/model-info-panel-utils"

const id = "internal:kilo-sidebar-usage"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const local = useLocal()
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const usage = createMemo(() => {
    const total = getUsage(msg())
    return {
      input: formatCount(total.input),
      output: formatCount(total.output),
      cached: formatCount(total.cached),
    }
  })
  const rate = createMemo(() => {
    const part = msg()
      .filter((item) => item.role === "assistant")
      .flatMap((item) => props.api.state.part(item.id))
      .findLast((item) => item.type === "step-finish" && item.metrics)
    const metrics = part?.type === "step-finish" ? part.metrics : undefined
    const generation = metrics?.rate.generation ?? metrics?.rate.output
    return {
      prompt: formatRate(metrics?.rate.prompt),
      generation: formatRate(generation),
    }
  })
  const bench = createMemo(() => {
    const current = local.model.current()
    if (!current) return
    const provider = props.api.state.provider.find((item) => item.id === current.providerID)
    return provider?.models[current.modelID]?.terminalBench
  })

  return (
    <box gap={1}>
      <box>
        <text fg={theme().text}>
          <b>Token Usage</b>
        </text>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().textMuted}>Input</text>
          <text fg={theme().textMuted}>{usage().input}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().textMuted}>Output</text>
          <text fg={theme().textMuted}>{usage().output}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().textMuted}>Cached</text>
          <text fg={theme().textMuted}>{usage().cached}</text>
        </box>
      </box>
      {rate().prompt && (
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().textMuted}>PP</text>
          <text fg={theme().textMuted}>{rate().prompt}</text>
        </box>
      )}
      {rate().generation && (
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().textMuted}>TG</text>
          <text fg={theme().textMuted}>{rate().generation}</text>
        </box>
      )}
      <Show when={bench()}>
        {(value) => (
          <box>
            <text fg={theme().text}>
              <b>Terminal Bench 2.0</b>
            </text>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().textMuted}>Completion</text>
              <text fg={theme().textMuted}>{fmtScore(value().overallScore)}</text>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().textMuted}>Cost / attempt</text>
              <text fg={theme().textMuted}>{fmtAttemptCost(value().avgAttemptCostUsd)}</text>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
