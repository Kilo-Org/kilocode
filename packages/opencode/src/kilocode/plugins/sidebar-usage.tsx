// kilocode_change - new file
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo } from "solid-js"
import { formatCount, getUsage } from "@tui/routes/session/usage"

const id = "internal:kilo-sidebar-usage"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const usage = createMemo(() => {
    const total = getUsage(msg())
    return {
      input: formatCount(total.input),
      output: formatCount(total.output),
      cached: formatCount(total.cached),
    }
  })

  return (
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
