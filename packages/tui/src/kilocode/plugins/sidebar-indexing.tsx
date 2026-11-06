import type { LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { formatIndexingLabel } from "../indexing-label"

function tone(state: KiloIndexingRpc.State | undefined, theme: Plugin.Context["theme"]) {
  if (state === "Complete") return theme.text.feedback.success.base
  if (state === "Error") return theme.text.feedback.error.base
  if (state === "In Progress") return theme.text.feedback.warning.base
  return theme.text.muted
}

function message(status: KiloIndexingRpc.Status) {
  const label = formatIndexingLabel(status)
  const text = status.message.trim()
  if (!text || text === label) return undefined
  const plain = text
    .replace(/^codebase indexing (is )?/i, "")
    .replace(/^indexing (is )?/i, "")
    .replace(/[.!]+$/, "")
    .toLowerCase()
  if (plain === label.toLowerCase()) return undefined
  return text
}

export function SidebarIndexing(props: { context: Plugin.Context; sessionID: string }) {
  const theme = () => props.context.theme
  const rpc = props.context.client.rpc(KiloIndexingRpc.Definition)
  const location = (): LocationRef =>
    props.context.data.session.get(props.sessionID)?.location ??
    props.context.location ??
    props.context.data.location.default()
  const options = () => ({ location: { directory: location().directory } })
  const [configured, setConfigured] = createSignal(false)
  const [status, setStatus] = createSignal<KiloIndexingRpc.Status>()
  const label = createMemo(() => (status() ? formatIndexingLabel(status()!) : ""))
  const msg = createMemo(() => (status() ? message(status()!) : undefined))
  const refresh = () => {
    if (!configured()) return
    void rpc.status({}, options()).then(setStatus, () => undefined)
  }
  const refreshConfig = () => {
    void rpc
      .config({}, options())
      .then((settings) => {
        const enabled = settings.global.enabled === true || settings.project.enabled === true
        setConfigured(enabled)
        if (enabled) refresh()
      })
      .catch(() => undefined)
  }

  onMount(() => {
    refreshConfig()
    refresh()
    const timer = setInterval(() => {
      const state = status()?.state
      if (state === "Complete" || state === "Error") return
      refresh()
    }, 1000)
    onCleanup(() => clearInterval(timer))
    onCleanup(
      rpc.events.on("status", (event) => {
        if (event.location.directory !== location().directory) return
        setStatus(event.data.status)
      }),
    )
    onCleanup(props.context.data.on("config.updated", refreshConfig))
  })

  return (
    <Show when={configured()}>
      <box>
        <text fg={theme().text.base}>
          <b>Code Indexing</b>
        </text>
        <box flexDirection="row" gap={1}>
          <text flexShrink={0} fg={tone(status()?.state, theme())}>
            •
          </text>
          <text fg={theme().text.base} wrapMode="word">
            {label()}
          </text>
        </box>
        <Show when={msg()}>{(text) => <text fg={theme().text.muted}>{text()}</text>}</Show>
      </box>
    </Show>
  )
}

export function sidebarIndexing(context: Plugin.Context) {
  return context.ui.slot({
    append: "sidebar.content",
    order: 225,
    render: (props) => <SidebarIndexing context={context} sessionID={props.sessionID} />,
  })
}
