import type { TuiPluginApi } from "@kilocode/plugin/tui"
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"

/** Compact token count: 2031 -> "2.0k", 850 -> "850". */
function compact(value: number) {
  if (value < 1000) return `${value}`
  return `${(value / 1000).toFixed(1)}k`
}

/** Coarse relative time for a "· 5m ago" suffix. */
function ago(ts: number | null | undefined) {
  if (!ts) return ""
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (secs < 45) return "just now"
  const mins = Math.floor(secs / 60)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type Stats = { lastConsolidatedAt: number | null; lastOperationCount: number }

/** Auto-capture status from the existing consolidation stats, rendered as its own dotted status line
 * (dot on when autoConsolidate is enabled). `detail` is the muted suffix; `saved` tints it green. */
function autosave(state: { autoConsolidate: boolean; stats: Stats }): { detail: string; on: boolean; saved: boolean } {
  if (!state.autoConsolidate) return { detail: "off", on: false, saved: false }
  const at = state.stats.lastConsolidatedAt
  if (!at) return { detail: "watching…", on: true, saved: false }
  const count = state.stats.lastOperationCount
  if (count > 0) return { detail: `saved ${count} ${count === 1 ? "fact" : "facts"} · ${ago(at)}`, on: true, saved: true }
  return { detail: `nothing new · ${ago(at)}`, on: true, saved: false }
}

function route(input: { workspace?: string; directory?: string }) {
  return {
    ...(input.workspace ? { workspace: input.workspace } : input.directory ? { directory: input.directory } : {}),
  }
}

export function MemorySidebar(props: { api: TuiPluginApi; sessionID: string }) {
  const [tick, setTick] = createSignal(0)
  const session = createMemo(() => props.api.state.session.get(props.sessionID))
  const workspace = createMemo(() => session()?.workspaceID)
  const dir = createMemo(() => session()?.directory ?? props.api.state.path.directory)
  const [data] = createResource(
    () => `${workspace() ?? "__default__"}:${dir()}:${tick()}`,
    async () => {
      const status = await props.api.client.memory
        .status(route({ workspace: workspace(), directory: dir() }))
        .catch(() => undefined)
      if (!status) return
      if (status.error || !status.data) return
      return status.data
    },
  )
  const theme = () => props.api.theme.current
  onMount(() => {
    const bump = () => setTick((value) => value + 1)
    const unsubs = [
      props.api.event.on("memory.status", bump),
      props.api.event.on("memory.updated", bump),
      props.api.event.on("memory.error", bump),
    ]
    const id = setInterval(bump, 15_000).unref()
    onCleanup(() => {
      for (const unsub of unsubs) unsub()
      clearInterval(id)
    })
  })

  const save = createMemo(() => {
    const item = data()
    if (!item || !item.state.enabled) return undefined
    return autosave(item.state)
  })
  // Passive recall: is this session's context actually loaded with memory? Proves it's working.
  const context = createMemo(() => {
    const item = data()
    if (!item || !item.state.enabled) return undefined
    const stats = item.state.stats
    const loaded = stats.lastInjectedSessionID === props.sessionID && stats.lastInjectedTokens > 0
    return loaded ? `${compact(stats.lastInjectedTokens)} tokens loaded` : "nothing loaded"
  })
  // Active recall: the model called kilo_memory_recall this session — the strongest "working now" signal.
  const recall = createMemo(() => {
    const item = data()
    if (!item || !item.state.enabled) return undefined
    const stats = item.state.stats
    if (stats.lastRecallSessionID !== props.sessionID || !stats.lastRecallAt) return undefined
    return stats.lastRecallCount > 0
      ? `looked up ${stats.lastRecallCount} · ${ago(stats.lastRecallAt)}`
      : `searched, nothing · ${ago(stats.lastRecallAt)}`
  })
  // Header status dot + label, covering loading/unavailable/enabled/disabled.
  const status = () => {
    if (data.loading && !data()) return { dot: theme().textMuted, label: "Loading" }
    const item = data()
    if (!item) return { dot: theme().error, label: "Unavailable" }
    if (item.state.enabled) return { dot: theme().success, label: "Enabled" }
    return { dot: theme().textMuted, label: "Disabled" }
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Memory</b>
      </text>
      <box flexDirection="row" gap={1}>
        <text flexShrink={0} style={{ fg: status().dot }}>
          •
        </text>
        <text fg={theme().text} wrapMode="word">
          {status().label}
        </text>
      </box>
      <Show when={data()}>
        {(item) => (
          <>
            <Show when={save()}>
              {(line) => (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} style={{ fg: line().on ? theme().success : theme().textMuted }}>
                    •
                  </text>
                  <text flexShrink={0} fg={theme().text}>
                    Auto-save
                  </text>
                  <text fg={line().saved ? theme().success : theme().textMuted} wrapMode="word">
                    · {line().detail}
                  </text>
                </box>
              )}
            </Show>
            <Show when={context()}>
              {(ctx) => (
                <text fg={theme().textMuted} wrapMode="word">
                  Context · {ctx()}
                </text>
              )}
            </Show>
            <Show when={recall()}>
              {(r) => (
                <text fg={theme().textMuted} wrapMode="word">
                  Recall · {r()}
                </text>
              )}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
