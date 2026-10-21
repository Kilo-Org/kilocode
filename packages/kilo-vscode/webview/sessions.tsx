import type { Data } from "@opencode/client/solid"
import { createSignal, For, onCleanup, Show } from "solid-js"

export function Sessions(props: {
  data: Data
  directory: string
  loading: boolean
  open: (id: string) => void
  rename: (id: string, title: string) => Promise<boolean>
}) {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(timer))
  const sessions = () =>
    props.data.session
      .list()
      .filter((info) => !info.parentID && info.location.directory === props.directory && !info.time.archived)
      .toSorted((a, b) => b.time.updated - a.time.updated)

  return (
    <section class="sessions scroll" aria-label="Sessions">
      <div class="section-label">Sessions</div>
      <Show
        when={sessions().length}
        fallback={<p class="empty muted">{props.loading ? "Loading sessions..." : "Start a conversation below."}</p>}
      >
        <For each={sessions()}>
          {(info) => (
            <div
              class="session-row"
              data-session-id={info.id}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest("button, input")) return
                props.open(info.id)
              }}
            >
              <div class="session-row-title">
                <Title
                  title={info.title}
                  save={(title) => props.rename(info.id, title)}
                  open={() => props.open(info.id)}
                />
              </div>
              <div class="session-meta muted">
                <Show when={props.data.session.status(info.id) === "running"}>
                  <span class="running" role="status">
                    Running
                  </span>
                </Show>
                <time
                  dateTime={new Date(info.time.updated).toISOString()}
                  title={new Date(info.time.updated).toLocaleString()}
                >
                  {relative(info.time.updated, now())}
                </time>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  )
}

export function Title(props: { title?: string; save: (title: string) => Promise<boolean>; open?: () => void }) {
  const [editing, setEditing] = createSignal(false)
  const [text, setText] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const save = () => {
    if (!text().trim() || saving()) return
    setSaving(true)
    void props
      .save(text().trim())
      .then((saved) => {
        if (saved) setEditing(false)
      })
      .finally(() => setSaving(false))
  }

  return (
    <Show
      when={editing()}
      fallback={
        <>
          <button
            class="title-button"
            onClick={() => {
              if (props.open) return props.open()
              setText(props.title ?? "")
              setEditing(true)
            }}
          >
            {props.title || "Untitled"}
          </button>
          <button
            class="secondary rename-button"
            aria-label="Rename session"
            onClick={() => {
              setText(props.title ?? "")
              setEditing(true)
            }}
          >
            Rename
          </button>
        </>
      }
    >
      <input
        data-component="rename-input"
        class="rename-input"
        aria-label="Session title"
        value={text()}
        disabled={saving()}
        ref={(element) =>
          queueMicrotask(() => {
            element.focus()
            element.select()
          })
        }
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false)
          if (event.key === "Enter" && !event.isComposing) {
            event.preventDefault()
            save()
          }
        }}
      />
      <button class="secondary" disabled={saving() || !text().trim()} onClick={save}>
        Save
      </button>
      <button class="secondary" disabled={saving()} onClick={() => setEditing(false)}>
        Cancel
      </button>
    </Show>
  )
}

function relative(time: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - time) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
