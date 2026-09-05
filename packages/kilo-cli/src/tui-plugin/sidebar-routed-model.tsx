import { Plugin } from "@opencode-ai/plugin/tui"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"
import { createMemo, Show } from "solid-js"
import { isKiloAutoID, routedModelID } from "../routed-model"

/** Show the latest actual Kilo Auto target using the already-public assistant provider state. */
export function RoutedModelSidebar(props: { readonly context: Plugin.Context; readonly sessionID: string }) {
  const model = createMemo(() => lastSettledAssistant(props.context.data.session.message.list(props.sessionID)))
  const routed = createMemo(() => routedModelForAssistant(model()))
  return (
    <Show when={routed()}>
      <box>
        <text fg={props.context.theme.text.default}>
          <b>Routed model</b>
        </text>
        <text fg={props.context.theme.text.subdued}>{routed()}</text>
      </box>
    </Show>
  )
}

export function lastSettledAssistant(messages: readonly SessionMessageInfo[]) {
  return messages.findLast(
    (message): message is SessionMessageAssistant =>
      message.type === "assistant" && message.time.completed !== undefined,
  )
}

export function routedModelForAssistant(message: SessionMessageAssistant | undefined) {
  if (!message || message.model.providerID !== "kilo" || !isKiloAutoID(message.model.id)) return
  const routed = routedModelID(message.providerState)
  return routed === message.model.id ? undefined : routed
}

export function installRoutedModelSidebar(ctx: Plugin.Context) {
  ctx.ui.slot({
    append: "sidebar.footer",
    render: (props) => <RoutedModelSidebar context={ctx} sessionID={props.sessionID} />,
  })
}
