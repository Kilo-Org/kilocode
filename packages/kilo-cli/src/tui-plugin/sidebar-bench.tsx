import { createClient, type KiloGatewayAccount } from "@kilocode/client"
import { KiloModels, type Entry } from "@opencode-ai/schema/kilocode/models"
import { Plugin } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { createMemo, createRenderEffect, createSignal, on, onCleanup, Show, type Accessor } from "solid-js"

export type BenchSidebarOptions = {
  readonly client?: Pick<ReturnType<typeof createClient>, "rpc">
  readonly account?: Accessor<KiloGatewayAccount | undefined>
  /** Increments for every profile refresh, including same-organization account changes. */
  readonly revision?: Accessor<number>
  readonly signal?: AbortSignal
}

/**
 * Terminal Bench 2.0 catalog metadata for the viewed session's current Kilo model.
 * Display only: the section renders only when the catalog supplies valid metadata
 * for the model; absence or a decode failure means no section and no invented value.
 */
export function installBenchSidebar(ctx: Plugin.Context, options: BenchSidebarOptions = {}) {
  const rpc = options.client?.rpc(KiloModels.Definition)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => (
      <BenchSidebar
        context={ctx}
        sessionID={props.sessionID}
        rpc={rpc}
        account={options.account}
        revision={options.revision}
        signal={options.signal}
      />
    ),
  })
}

/**
 * The viewed session's current model: the latest durable model-switched message wins,
 * falling back to the session info's model. Durable transcript truth, not an event
 * the client stream forwards.
 */
export function currentSessionModel(
  data: Plugin.Context["data"],
  sessionID: string,
): { readonly providerID: string; readonly id: string } | undefined {
  const messages = data.session.message.list(sessionID)
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "model-switched") return message.model
  }
  return data.session.get(sessionID)?.model
}

export function BenchSidebar(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly rpc?: ReturnType<NonNullable<BenchSidebarOptions["client"]>["rpc"]>
  readonly account?: Accessor<KiloGatewayAccount | undefined>
  readonly revision?: Accessor<number>
  readonly signal?: AbortSignal
}) {
  const theme = props.context.theme.text
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location)
  const model = createMemo(() => currentSessionModel(props.context.data, props.sessionID))
  const [entries, setEntries] = createSignal<readonly Entry[]>()
  const [open, setOpen] = createSignal(true)
  let sequence = 0
  let controller: AbortController | undefined

  const refresh = async () => {
    controller?.abort()
    const rpc = props.rpc
    const ref = location()
    const current = ++sequence
    if (!rpc || !ref) return
    controller = new AbortController()
    const signal = props.signal ? AbortSignal.any([controller.signal, props.signal]) : controller.signal
    try {
      const value = await rpc.list({}, { location: ref, signal })
      if (current !== sequence || signal.aborted) return
      setEntries(value)
    } catch {
      if (current !== sequence || signal.aborted) return
      setEntries(undefined)
    }
  }

  const identity = createMemo(() =>
    [
      props.revision?.() ?? 0,
      props.account?.()?.currentOrganizationID ?? "personal",
      props.account?.()?.selectionAvailable ?? false,
      props.sessionID,
      location()?.directory ?? "",
      location()?.workspaceID ?? "",
    ].join("\u0000"),
  )
  // Catalog metadata is scope-bound: an identity change must invalidate the held
  // entries before the refetch so the renderer never shows another scope's values.
  // Reconnect keeps the held entries until the refresh lands (no flicker).
  createRenderEffect(
    on(identity, () => {
      setEntries(undefined)
      void refresh()
    }),
  )
  const stopConnected = props.context.data.on("server.connected", () => void refresh())
  onCleanup(() => {
    sequence++
    controller?.abort()
    stopConnected()
  })

  const bench = createMemo(() => {
    const current = model()
    if (!current || current.providerID !== "kilo") return undefined
    return entries()?.find((entry) => entry.id === current.id)?.terminalBench
  })

  return (
    <Show when={bench()}>
      {(value) => (
        <box gap={0}>
          <box flexDirection="row" gap={1} onMouseDown={() => setOpen((current) => !current)}>
            <text fg={theme.default}>{open() ? "▼" : "▶"}</text>
            <text fg={theme.default}>
              <b>Terminal Bench 2.0</b>
            </text>
          </box>
          <Show when={open()}>
            <BenchRow label="Completion" value={`${(value().overallScore * 100).toFixed(1)}%`} color={theme.subdued} />
            <BenchRow label="Cost / attempt" value={`$${value().avgAttemptCostUsd.toFixed(2)}`} color={theme.subdued} />
          </Show>
        </box>
      )}
    </Show>
  )
}

function BenchRow(props: { readonly label: string; readonly value: string; readonly color: RGBA }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={props.color}>{props.label}</text>
      <text fg={props.color}>{props.value}</text>
    </box>
  )
}
