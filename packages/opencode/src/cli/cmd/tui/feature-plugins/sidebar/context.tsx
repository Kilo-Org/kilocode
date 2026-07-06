import type { AssistantMessage } from "@kilocode/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@kilocode/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, createSignal, Show } from "solid-js" // kilocode_change

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  // kilocode_change start
  const [open, setOpen] = createSignal(true)
  // kilocode_change end
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  // kilocode_change start
  const cost = createMemo(() => {
    const total = msg().reduce((sum, item) => {
      if (item.role !== "assistant") return sum
      return sum + (item.cost ?? 0)
    }, 0)
    return Math.max(session()?.cost ?? 0, total)
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
      {/* kilocode_change start */}
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
        <text fg={theme().text}>
          {open() ? "▼ " : "▶ "}
          <b>Context</b>
          <Show when={!open()}>
            <span style={{ fg: theme().textMuted }}>
              {" "}
              ({state().tokens.toLocaleString()} tokens · {state().percent ?? 0}% used · {money.format(cost())} spent)
            </span>
          </Show>
        </text>
      </box>
      <Show when={open()}>
        <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
        <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </Show>
      {/* kilocode_change end */}
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
