import { Plugin } from "@opencode-ai/plugin/tui"
import { createClient } from "@kilocode/client"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { MemoryRpc, type MemoryRpcStatus } from "../memory-rpc"
import { memoryUiRequestOptions, subscribeMemoryUiRefresh } from "./memory"

export type MemorySidebarClient = Pick<ReturnType<typeof createClient>, "rpc">

export type MemorySidebarOptions = {
  readonly client?: MemorySidebarClient
  readonly signal?: AbortSignal
}

type MemoryRpcClient = ReturnType<MemorySidebarClient["rpc"]>

/**
 * Compact status row, matching the current-main sidebar row contract. v1 tones
 * Enabled by per-session activity (durable message markers or a 5s save pulse);
 * v2 has no per-session evidence seam, so Enabled honestly stays muted.
 */
export function memoryRow(input: { enabled?: boolean; loading?: boolean }) {
  if (input.enabled === undefined) {
    return input.loading
      ? ({ label: "Loading", tone: "muted" } as const)
      : ({ label: "Unavailable", tone: "error" } as const)
  }
  if (!input.enabled) return { label: "Disabled", tone: "muted" } as const
  return { label: "Enabled", tone: "muted" } as const
}

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
    setLoading(status() === undefined)
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
      () => {
        setStatus(undefined)
        void refresh()
      },
    ),
  )

  // Consolidation can finish after the execution event. Reconcile its persisted
  // activity while enabled, without starting a model or polling disabled memory.
  createEffect(() => {
    if (!status()?.state.enabled) return
    const interval = setInterval(() => void refresh(), 5000)
    onCleanup(() => clearInterval(interval))
  })

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

  const row = createMemo(() =>
    memoryRow({ enabled: unavailable() ? undefined : status()?.state.enabled, loading: loading() }),
  )

  // Sidebar slot roots must be stable; a conditional root never mounts.
  return (
    <box>
      <text fg={theme.text.default}>
        <b>Memory</b>
      </text>
      <box flexDirection="row" gap={1}>
        <text fg={row().tone === "error" ? theme.text.feedback.error.default : theme.text.subdued}>•</text>
        <text fg={theme.text.default}>{row().label}</text>
      </box>
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
