import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import type { Data } from "@opencode/client/solid"
import { createEffect, createMemo, For, on, onCleanup, onMount, Show } from "solid-js"

export function Transcript(props: { data: Data; session: string; error: (error: unknown) => void }) {
  let scroll: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  const position = { near: true, earlier: false }
  const pending = () => props.data.session.pending.list(props.session)
  const ids = createMemo(() => new Set(pending().map((item) => item.id)))
  // createData materializes pending prompts in the transcript too. Show each only once.
  const messages = () => props.data.session.message.list(props.session).filter((item) => !ids().has(item.id))
  const retry = () => {
    const last = props.data.session.message.list(props.session).findLast((item) => item.type === "assistant")
    return last?.type === "assistant" ? last.retry : undefined
  }
  const bottom = () => {
    if (scroll && position.near && !position.earlier) scroll.scrollTop = scroll.scrollHeight
  }
  createEffect(
    on(
      () => props.session,
      () => {
        position.near = true
        queueMicrotask(bottom)
      },
    ),
  )
  onMount(() => {
    const observer = new ResizeObserver(bottom)
    if (content) observer.observe(content)
    if (scroll) observer.observe(scroll)
    onCleanup(() => observer.disconnect())
    bottom()
  })

  function earlier() {
    if (!scroll || position.earlier) return
    const element = scroll
    const height = element.scrollHeight
    const top = element.scrollTop
    position.earlier = true
    void props.data.session.message
      .loadMore(props.session)
      .catch(props.error)
      .finally(() => {
        requestAnimationFrame(() => {
          element.scrollTop = top + element.scrollHeight - height
          position.near = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          position.earlier = false
        })
      })
  }

  return (
    <div
      class="transcript scroll"
      ref={scroll}
      role="log"
      aria-label="Conversation"
      onScroll={(event) => {
        const element = event.currentTarget
        position.near = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }}
    >
      <div class="transcript-content" ref={content}>
        <Show when={props.data.session.message.more(props.session)}>
          <button
            class="secondary load-earlier"
            disabled={props.data.session.message.loading(props.session)}
            onClick={earlier}
          >
            Load earlier
          </button>
        </Show>
        <For each={messages()}>{(message) => <Message message={message} />}</For>
        <For each={pending()}>
          {(item) => (
            <>
              <Show when={item.type === "user" && item} keyed>
                {(item) => (
                  <article class="vscode-session-turn pending" data-row="user" data-message={item.id}>
                    <div class="turn-label">
                      You <span class="muted">(queued)</span>
                    </div>
                    <div class="prose" data-slot="user-message-text">
                      {item.payload.text}
                    </div>
                  </article>
                )}
              </Show>
              <Show when={item.type === "synthetic" && item} keyed>
                {(item) => <p class="notice muted">{item.payload.text}</p>}
              </Show>
            </>
          )}
        </For>
        <Show when={props.data.session.status(props.session) === "running"}>
          <div class="working muted" role="status">
            <span class="working-dot" />
            Working...
            <Show when={retry()}>
              {(retry) => (
                <span>
                  Retry {retry().attempt}: {retry().error.message}
                </span>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

function Message(props: { message: SessionMessageInfo }) {
  const message = props.message
  if (message.type === "user")
    return (
      <article class="vscode-session-turn" data-row="user" data-message={message.id}>
        <div class="turn-label">You</div>
        <div class="prose" data-slot="user-message-text">
          {message.text}
        </div>
      </article>
    )
  if (message.type === "assistant") return <Assistant message={message} />
  if (message.type === "idle")
    return (
      <Show when={message.outcome !== "succeeded"}>
        <p class="notice" classList={{ error: message.outcome === "failed" }}>
          {message.outcome === "failed" ? "Failed" : "Interrupted"}
          {message.error ? `: ${message.error.message}` : ""}
        </p>
      </Show>
    )
  if (message.type === "compaction")
    return (
      <details class="notice muted">
        <summary>Compaction: {message.status}</summary>
        <pre>{message.status === "failed" ? message.error.message : message.summary}</pre>
      </details>
    )
  if (message.type === "shell")
    return (
      <details class="tool">
        <summary>
          shell <code>{message.command}</code>
          <span class="muted">{message.status}</span>
        </summary>
        <pre>{message.output?.output}</pre>
      </details>
    )
  if (message.type === "synthetic" || message.type === "system" || message.type === "skill")
    return (
      <details class="notice muted">
        <summary>{message.type === "skill" ? message.name : message.description || message.type}</summary>
        <pre>{message.text}</pre>
      </details>
    )
  return (
    <p class="notice muted">
      {message.type === "agent-switched"
        ? `Agent: ${message.agent}`
        : message.type === "model-switched"
          ? `Model: ${message.model.id}`
          : `Directory: ${message.location.directory}`}
    </p>
  )
}

function Assistant(props: { message: SessionMessageAssistant }) {
  return (
    <article class="vscode-session-turn" data-row="assistant" data-message={props.message.id}>
      <div class="turn-label">Kilo</div>
      <For each={props.message.content}>
        {(part) => {
          if (part.type === "text")
            return (
              <div class="prose" data-part-type="text">
                <span data-slot="text-part-body">{part.text}</span>
              </div>
            )
          if (part.type === "reasoning")
            return (
              <details class="reasoning muted">
                <summary>Reasoning</summary>
                <div class="prose">{part.text}</div>
              </details>
            )
          return <Tool tool={part} />
        }}
      </For>
      <Show when={props.message.error}>
        <p class="notice error">{props.message.error?.message}</p>
      </Show>
    </article>
  )
}

function Tool(props: { tool: SessionMessageAssistantTool }) {
  const summary = () => {
    const input = props.tool.state.input
    if (typeof input === "string") return input.slice(0, 160)
    const value =
      input.command ?? input.path ?? input.filePath ?? input.pattern ?? input.query ?? input.url ?? input.description
    return (typeof value === "string" ? value : JSON.stringify(input)).slice(0, 160)
  }
  const output = () => {
    const state = props.tool.state
    return state.status === "completed" || state.status === "error" ? (state.content ?? []) : []
  }
  const error = () => {
    const state = props.tool.state
    return state.status === "error" ? state.error.message : undefined
  }
  return (
    <details class="tool" open>
      <summary>
        <strong>{props.tool.name}</strong>
        <code class="tool-input">{summary()}</code>
        <span class="muted tool-status">{props.tool.state.status}</span>
      </summary>
      <For each={output()}>
        {(item) =>
          item.type === "text" ? <pre>{item.text}</pre> : <p class="muted">File: {item.name || item.mime}</p>
        }
      </For>
      <Show when={error()}>
        <pre class="error">{error()}</pre>
      </Show>
    </details>
  )
}
