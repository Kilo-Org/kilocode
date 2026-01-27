import { For, Show } from "solid-js"
import type { Message as MessageType, Part, TextPart, ToolPart } from "../sdk"

interface Props {
  message: MessageType
  parts: Part[]
}

export function Message(props: Props) {
  const isUser = () => props.message.role === "user"

  const textParts = () => props.parts.filter((p): p is TextPart => p.type === "text")
  const toolParts = () => props.parts.filter((p): p is ToolPart => p.type === "tool")

  return (
    <div class={`message ${isUser() ? "message-user" : "message-assistant"}`}>
      <div class="message-role">{isUser() ? "You" : "Assistant"}</div>
      <div class="message-content">
        <For each={textParts()}>{(part) => <div class="message-text">{part.text}</div>}</For>
        <Show when={toolParts().length > 0}>
          <div class="message-tools">
            <For each={toolParts()}>
              {(part) => (
                <div class={`tool-call tool-${part.state.status}`}>
                  <span class="tool-name">{part.tool}</span>
                  <span class="tool-status">{part.state.status}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
