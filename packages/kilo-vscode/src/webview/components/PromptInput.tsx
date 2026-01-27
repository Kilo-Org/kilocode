import { createSignal, Show } from "solid-js"
import { useSession } from "../context/session"
import { useServer } from "../context/server"

export function PromptInput() {
  const { sendMessage, abort, status } = useSession()
  const { status: serverStatus } = useServer()
  const [text, setText] = createSignal("")

  const isDisabled = () => serverStatus() !== "connected"
  const isRunning = () => status() === "running"

  async function handleSubmit(e: Event) {
    e.preventDefault()
    const message = text().trim()
    if (!message || isDisabled()) return

    setText("")
    await sendMessage(message)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form class="prompt-input" onSubmit={handleSubmit}>
      <textarea
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled() ? "Waiting for server..." : "Type your message..."}
        disabled={isDisabled()}
        rows={3}
      />
      <div class="prompt-actions">
        <Show when={isRunning()}>
          <button type="button" class="abort-button" onClick={() => abort()}>
            Stop
          </button>
        </Show>
        <button type="submit" disabled={isDisabled() || !text().trim() || isRunning()}>
          Send
        </button>
      </div>
    </form>
  )
}
