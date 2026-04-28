import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { useSDK } from "../../context/sdk" // kilocode_change
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { RemoteIndicator } from "@/kilocode/remote-tui" // kilocode_change
import { formatIndexingLabel } from "@/kilocode/indexing-label" // kilocode_change
import type { IndexingStatusState } from "@kilocode/kilo-indexing/status" // kilocode_change
import { indexingEnabled } from "@/kilocode/indexing-feature" // kilocode_change

// kilocode_change start
function indexingTone(state: IndexingStatusState, theme: ReturnType<typeof useTheme>["theme"]) {
  if (state === "Complete") return theme.success
  if (state === "Error") return theme.error
  if (state === "In Progress") return theme.warning
  if (state === "Standby") return theme.textMuted
  return theme.textMuted
}

function indexingText(indexing: ReturnType<typeof useSync>["data"]["indexing"]) {
  return formatIndexingLabel(indexing)
}
// kilocode_change end

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const sdk = useSDK() // kilocode_change
  const indexing = createMemo(() => sync.data.indexing) // kilocode_change

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <RemoteIndicator sdk={sdk} theme={theme} kilo={sync.data.provider_next.connected.includes("kilo")} />
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            {/* kilocode_change start */}
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <Show when={indexingEnabled(sync.data.config)}>
              <text fg={indexingTone(indexing().state, theme)}>{indexingText(indexing()).slice(0, 48)}</text>
            </Show>
            {/* kilocode_change end */}
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
