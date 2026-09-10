import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, Show } from "solid-js" // kilocode_change - collapsible context state
import { contextUsage } from "../../util/session"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  // kilocode_change - collapsible sidebar section with clickable triangle heading and action token
  const [open, setOpen] = createSignal(true)
  const theme = props.context.theme
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  return (
    <Show when={state() || cost() > 0}>
      {/* kilocode_change - group usage beneath the clickable collapse heading. */}
      <box gap={0}>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((current) => !current)}>
          <text fg={theme.text.action.secondary.default}>{open() ? "▼" : "▶"}</text>
          <text fg={theme.text.default}>
            <b>Context</b>
          </text>
        </box>
        <Show when={open()}>
          <Show when={state()}>
            {(value) => (
              <>
                <text fg={theme.text.subdued}>{value().tokens.toLocaleString()} tokens</text>
                <Show when={value().percent !== undefined}>
                  <text fg={theme.text.subdued}>{value().percent}% used</text>
                </Show>
              </>
            )}
          </Show>
          <Show when={cost() > 0}>
            <text fg={theme.text.subdued}>{money.format(cost())} spent</text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
