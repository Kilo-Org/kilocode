import { Plugin } from "@opencode-ai/plugin/tui"
import { createClient } from "@kilocode/client"
import { createEffect, createMemo, createSignal, on, onCleanup, Show, Switch, Match } from "solid-js"
import { MemoryRpc, type MemoryRpcStatus } from "../memory-rpc"
import { memoryUiRequestOptions, subscribeMemoryUiRefresh } from "./memory"

export type MemorySidebarClient = Pick<ReturnType<typeof createClient>, "rpc">

export type MemorySidebarOptions = {
  readonly client?: MemorySidebarClient
  readonly signal?: AbortSignal
}

type MemoryRpcClient = ReturnType<MemorySidebarClient["rpc"]>

/** Render the current project-memory state in the native session sidebar. */
export function MemorySidebar(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly rpc?: MemoryRpcClient
  readonly signal?: AbortSignal
}) {
  const theme = props.context.theme
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location)
  const [status, setStatus] = createSignal<MemoryRpcStatus>()
  const [loading, setLoading] = createSignal(Boolean(props.rpc))
  const [unavailable, setUnavailable] = createSignal(!props.rpc)
  let revision = 0

  const refresh = async () => {
    if (props.signal?.aborted) return
    const rpc = props.rpc
    const ref = location()
    if (!rpc) {
      setStatus(undefined)
      setLoading(false)
      setUnavailable(true)
      return
    }
    if (!ref) {
      setStatus(undefined)
      setLoading(true)
      setUnavailable(false)
      return
    }

    const current = ++revision
    setLoading(true)
    setUnavailable(false)
    try {
      const value = await rpc.status({}, memoryUiRequestOptions(props.context, props.signal, ref))
      if (current !== revision || props.signal?.aborted) return
      setStatus(value)
      setUnavailable(false)
    } catch {
      if (current !== revision || props.signal?.aborted) return
      setStatus(undefined)
      setUnavailable(true)
    } finally {
      if (current === revision && !props.signal?.aborted) setLoading(false)
    }
  }

  createEffect(
    on(
      () => {
        const ref = location()
        return `${props.sessionID}\u0000${ref?.directory ?? ""}\u0000${ref?.workspaceID ?? ""}`
      },
      () => void refresh(),
    ),
  )

  const unsubscribe = subscribeMemoryUiRefresh(props.context, () => void refresh())
  const stopExecutionEvents = props.context.data.on("session.execution.succeeded", (event) => {
    if (event.data.sessionID !== props.sessionID) return
    const ref = location()
    if (
      ref &&
      event.location &&
      (event.location.directory !== ref.directory || event.location.workspaceID !== ref.workspaceID)
    )
      return
    void refresh()
  })
  onCleanup(() => {
    revision++
    unsubscribe()
    stopExecutionEvents()
  })

  return (
    <box>
      <text fg={theme.text.default}>
        <b>Memory</b>
      </text>
      <Switch>
        <Match when={loading()}>
          <text fg={theme.text.subdued}>Loading</text>
        </Match>
        <Match when={unavailable()}>
          <text fg={theme.text.feedback.warning.default}>Unavailable</text>
        </Match>
        <Match when={status()?.state.enabled === false}>
          <text fg={theme.text.subdued}>Disabled</text>
        </Match>
        <Match when={status()?.state.enabled === true}>
          <Show when={status()}>
            {(value) => (
              <>
                <text fg={theme.text.feedback.success.default}>Enabled</text>
                <text fg={theme.text.subdued}>Auto: {value().state.autoConsolidate ? "On" : "Off"}</text>
                <text fg={theme.text.subdued}>Data: {value().index.tokens.toLocaleString()} estimated tokens</text>
                <Show when={value().index.truncated}>
                  <text fg={theme.text.subdued}>Data truncated</text>
                </Show>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

/** Append memory status to the host's existing sidebar content. */
export function installMemorySidebar(ctx: Plugin.Context, options: MemorySidebarOptions = {}) {
  const rpc = options.client?.rpc(MemoryRpc.Definition)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => <MemorySidebar context={ctx} sessionID={props.sessionID} rpc={rpc} signal={options.signal} />,
  })
}
