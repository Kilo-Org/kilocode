import type { TuiPluginApi } from "@kilocode/plugin/tui"
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"

function fmt(value: number) {
  return value.toLocaleString()
}

function ops(value: number) {
  if (value > 0) return `${fmt(value)} ${value === 1 ? "op" : "ops"}`
  return "checked · no new memory"
}

function tone(enabled: boolean, api: TuiPluginApi) {
  return enabled ? api.theme.current.success : api.theme.current.textMuted
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
  const sessionTokens = () => {
    const state = data()?.state
    if (!state || !state.enabled || state.stats.lastInjectedSessionID !== props.sessionID) return 0
    return state.stats.lastInjectedTokens
  }
  const label = () => (data()?.state.enabled ? "Enabled" : "Disabled")
  const saveTokens = () => data()?.state.stats.lastConsolidationTokens ?? 0
  const saveOps = () => data()?.state.stats.lastOperationCount ?? 0
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

  return (
    <box>
      <text fg={theme().text}>
        <b>Memory</b>
      </text>
      <Show
        when={data()}
        fallback={
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} style={{ fg: data.loading ? theme().textMuted : theme().error }}>
              •
            </text>
            <text fg={theme().text} wrapMode="word">
              {data.loading ? "Loading" : "Unavailable"}
            </text>
          </box>
        }
      >
        {(item) => (
          <>
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} style={{ fg: tone(item().state.enabled, props.api) }}>
                •
              </text>
              <text fg={theme().text} wrapMode="word">
                {label()}
              </text>
            </box>
            <Show when={item().state.enabled && sessionTokens() > 0}>
              <text fg={theme().textMuted}>startup ctx {fmt(sessionTokens())} tok</text>
            </Show>
            <Show when={item().state.enabled || item().exists.index}>
              <text fg={theme().textMuted}>
                stored index {fmt(item().index.estimatedTokens)} tok · {fmt(item().index.bytes)} bytes
              </text>
            </Show>
            <Show when={item().state.enabled && saveTokens() > 0}>
              <text fg={theme().textMuted}>last auto-save {ops(saveOps())} · model usage {fmt(saveTokens())} tok</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
