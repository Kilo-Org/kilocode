// kilocode_change - new file
/**
 * Kilo-specific home footer plugin.
 *
 * Replaces the upstream `home_footer` slot with a lower-order single-winner
 * entry (99 before upstream 100) so Kilo can show memory, remote, and indexing
 * status alongside the standard directory, MCP, and version information.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createResource, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { Global } from "@opencode-ai/core/global"

const id = "internal:kilo-home-footer"

type Status = {
  enabled: boolean
  connected: boolean
}

// ---------------------------------------------------------------------------
// RemoteIndicator – adapted from @/kilocode/remote-tui for plugin API usage
// ---------------------------------------------------------------------------

function RemoteIndicator(props: { api: TuiPluginApi; kilo: boolean }) {
  const theme = () => props.api.theme.current
  const [status, setStatus] = createSignal<Status | null>(null)

  onMount(() => {
    void props.api.client.remote
      .status()
      .then((res: { data?: Status }) => {
        if (res.data) setStatus(res.data)
      })
      .catch((_error: unknown) => {
        setStatus(null)
      })
    const off = props.api.event.on("kilo-sessions.remote-status-changed", (evt) => setStatus(evt.properties))
    onCleanup(off)
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

function Memory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [tick, setTick] = createSignal(0)
  const [status] = createResource(tick, async () => {
    const result = await props.api.client.memory.status()
    if (result.error || !result.data) return
    return result.data
  })
  const enabled = createMemo(() => status()?.state.enabled ?? false)
  const tokens = createMemo(() => status()?.index.estimatedTokens ?? 0)
  const active = createMemo(() => enabled())
  const label = createMemo(() => {
    if (!enabled()) return "Disabled"
    return "Enabled"
  })

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
    <Show when={status()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <span style={{ fg: active() ? theme().success : theme().textMuted }}>⊙ </span>
          Memory {label()}
          <Show when={enabled()}> · {tokens().toLocaleString()} index</Show>
        </text>
        <text fg={theme().textMuted}>/memory</text>
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
        <Memory api={props.api} />
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
    order: 99,
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
