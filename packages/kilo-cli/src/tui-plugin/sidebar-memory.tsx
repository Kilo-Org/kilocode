import { Plugin } from "@opencode-ai/plugin/tui"
import { createClient } from "@kilocode/client"
import type { RpcClient } from "@opencode-ai/client"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { MemoryRpc, type MemoryRpcStatus } from "../memory-rpc"
import { SidebarSection } from "./sidebar-section"
import { memoryUiRequestOptions, subscribeMemoryUiRefresh } from "./memory"

export type MemorySidebarClient = Pick<ReturnType<typeof createClient>, "rpc">

export type MemorySidebarOptions = {
  readonly client?: MemorySidebarClient
  readonly signal?: AbortSignal
}

type MemoryRpcClient = RpcClient<typeof MemoryRpc.Definition>

/**
 * Compact status row, matching the current-main sidebar row contract. v1 tones
 * Enabled by per-session activity (durable message markers or a 5s save pulse);
 * the host persists actual nonempty context injection separately from the
 * transcript, and the save event adds its temporary activity pulse.
 */
export function memoryRow(input: { enabled?: boolean; loading?: boolean; active?: boolean }) {
  if (input.enabled === undefined) {
    return input.loading
      ? ({ label: "Loading", tone: "muted" } as const)
      : ({ label: "Unavailable", tone: "error" } as const)
  }
  if (!input.enabled) return { label: "Disabled", tone: "muted" } as const
  return { label: "Enabled", tone: input.active ? "success" : "muted" } as const
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
  const [saved, setSaved] = createSignal(false)
  let pulse: ReturnType<typeof setTimeout> | undefined
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
      const value = await rpc.status(
        { sessionID: props.sessionID },
        memoryUiRequestOptions(props.context, props.signal, ref),
      )
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
        setSaved(false)
        if (pulse) clearTimeout(pulse)
        pulse = undefined
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

  // Current-main save pulse: 5s of per-session activity after the host reports
  // a real saved memory operation attributed to this session.
  const stopSavedEvents =
    props.rpc?.events.on(
      "saved",
      (event) => {
        if (event.data.sessionID !== props.sessionID) return
        setSaved(true)
        if (pulse) clearTimeout(pulse)
        pulse = setTimeout(() => {
          setSaved(false)
          pulse = undefined
        }, 5_000)
      },
      { signal: props.signal },
    ) ?? (() => {})

  onCleanup(() => {
    revision++
    unsubscribe()
    stopExecutionEvents()
    stopSavedEvents()
    if (pulse) clearTimeout(pulse)
  })

  const row = createMemo(() =>
    memoryRow({
      enabled: unavailable() ? undefined : status()?.state.enabled,
      loading: loading(),
      active: saved() || status()?.session?.injected === true,
    }),
  )

  return (
    <SidebarSection theme={theme} title="Memory">
      <box flexDirection="row" gap={1}>
        <text
          fg={
            row().tone === "error"
              ? theme.text.feedback.error.default
              : row().tone === "success"
                ? theme.text.feedback.success.default
                : theme.text.subdued
          }
        >
          •
        </text>
        <text fg={theme.text.default}>{row().label}</text>
      </box>
    </SidebarSection>
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
