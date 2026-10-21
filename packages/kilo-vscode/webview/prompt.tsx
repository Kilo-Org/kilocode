import { createEffect, createSignal, on, onMount, Show } from "solid-js"

export function Prompt(props: {
  reset: number
  running: boolean
  disabled: boolean
  send: (text: string) => Promise<boolean>
  stop: () => void
}) {
  const [text, setText] = createSignal("")
  let input: HTMLTextAreaElement | undefined
  const focus = () => input?.focus()
  onMount(focus)
  createEffect(
    on(
      () => props.reset,
      () => {
        setText("")
        focus()
      },
    ),
  )

  function send() {
    if (!text().trim() || props.disabled) return
    const draft = text()
    const reset = props.reset
    setText("")
    void props.send(draft).then((sent) => {
      if (!sent && !text() && props.reset === reset) setText(draft)
    })
    focus()
  }

  return (
    <div class="prompt-input-container">
      <textarea
        ref={input}
        class="prompt-input"
        aria-label="Message Kilo"
        placeholder="Message Kilo..."
        rows={3}
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
          event.preventDefault()
          send()
        }}
      />
      <div class="prompt-input-hint-actions">
        <small class="muted prompt-hint">Enter to send, Shift+Enter for a new line</small>
        <Show when={props.running}>
          <button class="secondary" aria-label="Stop" onClick={props.stop}>
            Stop
          </button>
        </Show>
        <button aria-label="Send" disabled={!text().trim() || props.disabled} onClick={send}>
          Send
        </button>
      </div>
    </div>
  )
}
