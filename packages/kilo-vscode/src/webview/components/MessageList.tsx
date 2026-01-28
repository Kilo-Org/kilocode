import { For, Show, createEffect, onMount } from "solid-js"
import { useSession } from "../context/session"
import { Message } from "./Message"

export function MessageList() {
  const { messages, parts, status } = useSession()
  let container: HTMLDivElement | undefined

  createEffect(() => {
    const msgs = messages()
    console.log("[MessageList] messages updated:", msgs.length, msgs)
    if (msgs.length > 0 && container) {
      container.scrollTop = container.scrollHeight
    }
  })

  onMount(() => {
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  })

  return (
    <div class="message-list" ref={container}>
      <Show when={messages().length === 0}>
        <div class="empty-state">
          <p>No messages yet.</p>
          <p>Start a conversation below.</p>
        </div>
      </Show>
      <For each={messages()}>{(message) => <Message message={message} parts={parts()(message.id)} />}</For>
      <Show when={status() === "running"}>
        <div class="typing-indicator">
          <span />
          <span />
          <span />
        </div>
      </Show>
    </div>
  )
}
