import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useProject } from "@/cli/cmd/tui/context/project"
import { useSDK } from "@/cli/cmd/tui/context/sdk"
import { useTheme } from "@/cli/cmd/tui/context/theme"

function fmt(value: number) {
  return value.toLocaleString()
}

function ops(value: number) {
  if (value > 0) return `${fmt(value)} ${value === 1 ? "op" : "ops"}`
  return "checked · no new memory"
}

export function MemorySidebar(props: { sessionID: string }) {
  const sdk = useSDK()
  const project = useProject()
  const { theme } = useTheme()
  const [tick, setTick] = createSignal(0)
  const [data] = createResource(
    () => `${project.workspace.current() ?? "__default__"}:${tick()}`,
    async () => {
      const workspace = project.workspace.current()
      const route = workspace ? { workspace } : {}
      const status = await sdk.client.memory.status(route)
      if (status.error || !status.data) return
      return status.data
    },
  )
  const sessionTokens = () => {
    const state = data()?.state
    if (!state || !state.enabled || state.stats.lastInjectedSessionID !== props.sessionID) return 0
    return state.stats.lastInjectedTokens
  }
  const saveTokens = () => data()?.state.stats.lastConsolidationTokens ?? 0
  const saveOps = () => data()?.state.stats.lastOperationCount ?? 0
  const label = () => {
    const state = data()?.state
    if (!state?.enabled) return "project off"
    return "project on"
  }

  onMount(() => {
    const unsub = sdk.event.on("event", (item) => {
      const type = item.payload.type
      if (type === "memory.status" || type === "memory.updated" || type === "memory.error") {
        setTick((value) => value + 1)
      }
    })
    const id = setInterval(() => setTick((value) => value + 1), 15_000).unref()
    onCleanup(() => {
      unsub()
      clearInterval(id)
    })
  })

  return (
    <Show when={data()}>
      {(item) => (
        <Show when={item().state.enabled || item().exists.state}>
          <box>
            <text fg={theme.text}>
              <b>Memory</b>
            </text>
            <text fg={item().state.enabled ? theme.success : theme.textMuted}>
              {label()} · startup ctx {fmt(sessionTokens())}
            </text>
            <text fg={theme.textMuted}>
              stored index {fmt(item().index.estimatedTokens)} tok · {fmt(item().index.bytes)} bytes
            </text>
            <Show when={saveTokens() > 0}>
              <text fg={theme.textMuted}>
                last auto-save {ops(saveOps())} · model usage {fmt(saveTokens())} tok
              </text>
            </Show>
          </box>
        </Show>
      )}
    </Show>
  )
}
