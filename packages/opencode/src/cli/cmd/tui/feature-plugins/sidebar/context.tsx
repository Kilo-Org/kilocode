import type { AssistantMessage } from "@kilocode/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo } from "solid-js"
import { formatCost, useModelUsage } from "@/kilocode/plugins/model-usage" // kilocode_change

const id = "internal:sidebar-context"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  // kilocode_change start - read spend from the shared model-usage aggregation
  // (this session + its descendants) so it matches the Token Usage / Models
  // sections without falling back to a stale single-session cost.
  const { usage, unavailable } = useModelUsage(props.api, () => props.session_id)
  const spend = createMemo(() => {
    const cost = usage()?.totals.cost
    if (cost !== undefined) return `${formatCost(cost)} spent`
    return unavailable() ? "Cost unavailable" : "Loading cost..."
  })
  // kilocode_change end

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{spend()}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
