import type { TuiPluginApi } from "@kilocode/plugin/tui"
import { MemoryAutosaveStatus } from "@kilocode/kilo-memory/autosave-status"
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import { relativeTime } from "@/kilocode/cli/cmd/tui/relative-time"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { errorMessage } from "@/util/error"
import { Locale } from "@/util/locale"

const log = Log.create({ service: "tui.memory-sidebar" })

/** Coarse relative time for a "· 5m ago" suffix; empty when there's no timestamp yet. */
function ago(ts: number | null | undefined) {
  return ts ? relativeTime(ts) : ""
}

/** Auto-capture status from the existing consolidation stats, rendered as its own dotted status line
 * (dot on when autoConsolidate is enabled). `detail` is the muted suffix; `saved` tints it green. */
function autosave(state: { autoConsolidate: boolean; stats: MemoryAutosaveStatus.Stats }) {
  const item = MemoryAutosaveStatus.summarize(state)
  if (item.state === "off") return { detail: "off", on: false, saved: false }
  if (item.state === "watching") return { detail: "watching…", on: true, saved: false }
  if (item.state === "saved") {
    return {
      detail: `${item.count} ${item.count === 1 ? "change" : "changes"} · ${ago(item.at)}`,
      on: true,
      saved: true,
    }
  }
  if (item.state === "handoff") return { detail: `session handoff saved · ${ago(item.at)}`, on: true, saved: true }
  return { detail: `no changes · ${ago(item.at)}`, on: true, saved: false }
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
        .catch((error: unknown) => {
          log.warn("memory status unavailable", { error: errorMessage(error) })
          return undefined
        })
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
    return loaded ? `${Locale.number(stats.lastInjectedTokens)} tokens loaded` : "nothing loaded"
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
