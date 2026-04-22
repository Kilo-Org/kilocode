// kilocode_change - new file
/**
 * Kilo-specific home footer plugin.
 *
 * Replaces the upstream `home_footer` slot (order 101 > upstream 100)
 * to inject the RemoteIndicator alongside the standard directory, MCP,
 * and version information.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Global } from "@/global"

const id = "internal:kilo-home-footer"

// ---------------------------------------------------------------------------
// RemoteIndicator – adapted from @/kilocode/remote-tui for plugin API usage
// ---------------------------------------------------------------------------

function RemoteIndicator(props: { api: TuiPluginApi; kilo: boolean }) {
  const theme = () => props.api.theme.current
  const [status, setStatus] = createSignal<{
    enabled: boolean
    connected: boolean
  } | null>(null)

  onMount(() => {
    const poll = async () => {
      const res = await props.api.client.remote.status().catch(() => null)
      if (res?.data) setStatus(res.data)
    }
    poll()
    const timer = setInterval(poll, 5000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={props.kilo && status()?.enabled}>
      <text fg={status()?.connected ? theme().success : theme().warning}>
        ◆ Remote{status()?.connected ? "" : " …"}
      </text>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Sub-components (mirror upstream home/footer with kilo additions)
// ---------------------------------------------------------------------------

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dir = createMemo(() => {
    const d = props.api.state.path.directory || process.cwd()
    const out = d.replace(Global.Path.home, "~")
    const branch = props.api.state.vcs?.branch
    if (branch) return out + ":" + branch
    return out
  })

  return <text fg={theme().textMuted}>{dir()}</text>
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <Switch>
            <Match when={err()}>
              <span style={{ fg: theme().error }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box flexShrink={0}>
      <text fg={theme().textMuted}>{props.api.app.version}</text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Main footer view
// ---------------------------------------------------------------------------

function View(props: { api: TuiPluginApi }) {
  const kilo = createMemo(() => props.api.state.provider.some((p) => p.id === "kilo"))

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <Directory api={props.api} />
      <box gap={1} flexDirection="row" flexShrink={0}>
        <RemoteIndicator api={props.api} kilo={kilo()} />
        <Mcp api={props.api} />
      </box>
      <box flexGrow={1} />
      <Version api={props.api} />
    </box>
  )
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 101,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
