import { Plugin } from "@opencode/plugin/tui"
import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"

type Load = (signal: AbortSignal) => Promise<KiloFlowRpc.ListOutput>
type Control = (
  method: "pause" | "resume" | "remove",
  flowID: KiloFlowRpc.ID,
  signal: AbortSignal,
) => Promise<KiloFlowRpc.Info | undefined>
type Run = (flowID: KiloFlowRpc.ID, signal: AbortSignal) => Promise<KiloFlowRpc.Run>
type DialogContext = Pick<Plugin.Context, "client" | "data" | "keymap" | "renderer" | "theme" | "ui">
type Notice = { readonly message: string; readonly variant: "success" | "error" | "info" }

export function FlowsDialog(props: {
  context: DialogContext
  load?: Load
  control?: Control
  run?: Run
  pollMilliseconds?: number
}) {
  const [result, setResult] = createSignal<KiloFlowRpc.ListOutput>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal<Notice>()
  const [stale, setStale] = createSignal(false)
  const [changing, setChanging] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [detailKey, setDetailKey] = createSignal<string>()
  const [confirmingDelete, setConfirmingDelete] = createSignal(false)
  const mounted = new AbortController()
  let active: AbortController | undefined
  let mutation: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let scroll: ScrollBoxRenderable | undefined
  let detailScroll: ScrollBoxRenderable | undefined
  const theme = () => props.context.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const load =
    props.load ??
    (async (signal) => {
      const response = await props.context.client.rpc.call(
        {
          rpcID: "kilocode.flow",
          method: "list",
          input: {},
          location: props.context.data.location.default(),
        },
        { signal },
      )
      // SAFETY: The Kilo server validates this method's output with KiloFlowRpc.Definition before returning it.
      return response.output as KiloFlowRpc.ListOutput
    })
  const control =
    props.control ??
    (async (method, flowID, signal) => {
      const response = await props.context.client.rpc.call(
        {
          rpcID: "kilocode.flow",
          method,
          input: { flowID },
          location: props.context.data.location.default(),
        },
        { signal },
      )
      if (method === "remove") return
      // SAFETY: The Kilo server validates these method outputs with KiloFlowRpc.Definition.
      return response.output as KiloFlowRpc.Info
    })
  const run =
    props.run ??
    (async (flowID, signal) => {
      const response = await props.context.client.rpc.call(
        {
          rpcID: "kilocode.flow",
          method: "run",
          input: { flowID },
          location: props.context.data.location.default(),
        },
        { signal },
      )
      // SAFETY: The Kilo server validates this method's output with KiloFlowRpc.Definition before returning it.
      return response.output as KiloFlowRpc.Run
    })
  const flows = createMemo(() => [...(result()?.flows ?? [])].sort(compare))
  const detail = createMemo(() => flows().find((flow) => key(flow) === detailKey()))
  const warning = createMemo(() => (!stale() ? result()?.warnings[0] : undefined))
  const banners = createMemo(() => Number(stale()) + Number(notice() !== undefined) + Number(warning() !== undefined))
  const availableHeight = createMemo(() => dimensions().height - Math.floor(dimensions().height / 4))
  const listHeight = createMemo(() => Math.max(1, Math.min(15, availableHeight() - 6 - banners() * 2)))
  const detailHeight = createMemo(() =>
    Math.max(1, Math.min(16, availableHeight() - (confirmingDelete() ? 8 : 7) - banners() * 2)),
  )

  // Re-sorting after a refresh or a status change keeps the cursor on the same Flow rather than the same row.
  function replace(next: KiloFlowRpc.ListOutput) {
    const current = flows()[selected()]
    setResult(next)
    if (!current) return
    const index = flows().findIndex((flow) => key(flow) === key(current))
    if (index < 0 || index === selected()) return
    setSelected(index)
    reveal(index)
  }

  function reveal(index: number) {
    props.context.renderer.requestAnimationFrame(() => {
      const row = scroll?.getChildren()[index]
      if (!scroll || scroll.isDestroyed || !row || row.isDestroyed) return
      if (row.y < scroll.viewport.y) scroll.scrollBy(row.y - scroll.viewport.y)
      const height = Math.min(row.height, scroll.viewport.height)
      if (row.y + height > scroll.viewport.y + scroll.viewport.height)
        scroll.scrollBy(row.y + height - scroll.viewport.y - scroll.viewport.height)
    })
  }

  function move(offset: number) {
    if (flows().length === 0 || detail()) return
    const next = Math.max(0, Math.min(flows().length - 1, selected() + offset))
    setSelected(next)
    reveal(next)
  }

  function scrollDetail(offset: number, viewport = false) {
    if (!detailScroll || detailScroll.isDestroyed) return
    detailScroll.scrollBy(offset, viewport ? "viewport" : undefined)
  }

  function showDetail(flow: KiloFlowRpc.Info | undefined) {
    if (!flow) return
    setNotice()
    setConfirmingDelete(false)
    setDetailKey(key(flow))
  }

  function back() {
    if (confirmingDelete()) {
      setConfirmingDelete(false)
      return
    }
    setNotice()
    setDetailKey()
  }

  function viewSession(flow: KiloFlowRpc.Info | undefined) {
    const sessionID = flow?.latestRun?.sessionID
    if (!sessionID) {
      setNotice({ message: `${flow?.name ?? "This Flow"} has not run yet.`, variant: "info" })
      return
    }
    props.context.ui.dialog.clear()
    if (props.context.ui.tabs.focus(sessionID)) return
    props.context.ui.router.navigate({ type: "session", sessionID })
  }

  async function change(method: "pause" | "resume" | "remove", flow: KiloFlowRpc.Info | undefined) {
    if (!flow || flow.reference.type !== "managed" || mutation) return
    const flowID = flow.reference.flowID
    const request = new AbortController()
    mutation = request
    setChanging(true)
    setNotice()
    const signal = AbortSignal.any([mounted.signal, request.signal])
    try {
      const updated = await control(method, flowID, signal)
      if (signal.aborted) return
      const current = result()
      if (!current) return
      if (method === "remove") {
        setDetailKey()
        setConfirmingDelete(false)
        replace({
          ...current,
          flows: current.flows.filter(
            (item) => item.reference.type !== "managed" || item.reference.flowID !== flowID,
          ),
        })
        setNotice({ message: `Deleted ${flow.name}.`, variant: "success" })
        return
      }
      replace({
        ...current,
        flows: current.flows.map((item) =>
          item.reference.type === "managed" && item.reference.flowID === flowID && updated ? updated : item,
        ),
      })
      setNotice({
        message: `${method === "pause" ? "Disabled" : "Enabled"} ${flow.name}.`,
        variant: "success",
      })
    } catch (cause) {
      if (!signal.aborted)
        setNotice({
          message: `${method === "remove" ? "Delete" : "Update"} failed: ${message(cause)}`,
          variant: "error",
        })
    } finally {
      if (mutation === request) mutation = undefined
      if (!signal.aborted) setChanging(false)
    }
  }

  async function runNow(flow: KiloFlowRpc.Info | undefined) {
    if (!flow || flow.reference.type !== "managed" || mutation) return
    const flowID = flow.reference.flowID
    const request = new AbortController()
    mutation = request
    setChanging(true)
    setNotice()
    const signal = AbortSignal.any([mounted.signal, request.signal])
    try {
      const started = await run(flowID, signal)
      if (signal.aborted) return
      if (started.status === "skipped") {
        setNotice({ message: `Skipped ${flow.name}: another run is active.`, variant: "info" })
        return
      }
      const current = result()
      if (!current) return
      replace({
        ...current,
        flows: current.flows.map((item) =>
          item.reference.type === "managed" && item.reference.flowID === flowID
            ? { ...item, latestRun: started, lastRunAt: started.time.started ?? started.time.created }
            : item,
        ),
      })
      setNotice({
        message: `${label(started.status)} ${flow.name}.`,
        variant: started.status === "failed" || started.status === "interrupted" ? "error" : "success",
      })
    } catch (cause) {
      if (!signal.aborted) setNotice({ message: `Run failed: ${message(cause)}`, variant: "error" })
    } finally {
      if (mutation === request) mutation = undefined
      if (!signal.aborted) setChanging(false)
    }
  }

  async function refresh() {
    if (active) return
    const request = new AbortController()
    active = request
    if (!result()) setLoading(true)
    const signal = AbortSignal.any([mounted.signal, request.signal])
    try {
      const next = await load(signal)
      if (signal.aborted) return
      replace(next)
      setError("")
      setStale(false)
    } catch (cause) {
      if (signal.aborted) return
      setError(message(cause))
      setStale(result() !== undefined)
    } finally {
      if (active === request) active = undefined
      if (!signal.aborted) setLoading(false)
    }
  }

  props.context.keymap.layer(() => ({
    mode: "modal",
    priority: 1,
    commands: [
      {
        bind: "escape",
        title: confirmingDelete() ? "Cancel delete" : "Back to periodic flows",
        group: "Periodic",
        enabled: () => detail() !== undefined,
        run: back,
      },
      { bind: "ctrl+r", title: "Refresh periodic flows", group: "Periodic", run: () => void refresh() },
      {
        bind: "up,k",
        title: detail() ? "Scroll details up" : "Previous Flow",
        group: "Periodic",
        run: () => (detail() ? scrollDetail(-1) : move(-1)),
      },
      {
        bind: "down,j",
        title: detail() ? "Scroll details down" : "Next Flow",
        group: "Periodic",
        run: () => (detail() ? scrollDetail(1) : move(1)),
      },
      {
        bind: "pageup",
        title: "Previous details page",
        group: "Periodic",
        enabled: () => detail() !== undefined,
        run: () => scrollDetail(-1, true),
      },
      {
        bind: "pagedown",
        title: "Next details page",
        group: "Periodic",
        enabled: () => detail() !== undefined,
        run: () => scrollDetail(1, true),
      },
      {
        bind: "return",
        title: "Show Flow details",
        group: "Periodic",
        enabled: () => !detail() && flows().length > 0,
        run: () => showDetail(flows()[selected()]),
      },
      {
        bind: "r",
        title: detail() ? "Run Flow now" : "Refresh periodic flows",
        group: "Periodic",
        enabled: () => !changing() && (!detail() || detail()?.reference.type === "managed") && !confirmingDelete(),
        run: () => (detail() ? void runNow(detail()) : void refresh()),
      },
      {
        bind: "e",
        title: "Enable or disable Flow",
        group: "Periodic",
        enabled: () => {
          const flow = detail()
          return (
            !changing() &&
            !confirmingDelete() &&
            flow?.reference.type === "managed" &&
            (flow.status === "active" || flow.status === "paused")
          )
        },
        run: () => {
          const flow = detail()
          if (!flow) return
          void change(flow.status === "paused" ? "resume" : "pause", flow)
        },
      },
      {
        bind: "d",
        title: "Delete Flow",
        group: "Periodic",
        enabled: () => !changing() && !confirmingDelete() && detail()?.reference.type === "managed",
        run: () => setConfirmingDelete(true),
      },
      {
        bind: "y",
        title: "Confirm Flow deletion",
        group: "Periodic",
        enabled: confirmingDelete,
        run: () => void change("remove", detail()),
      },
      {
        bind: "n",
        title: "Cancel Flow deletion",
        group: "Periodic",
        enabled: confirmingDelete,
        run: () => {
          setConfirmingDelete(false)
        },
      },
      {
        bind: "v",
        title: "View latest run Session",
        group: "Periodic",
        enabled: () => !confirmingDelete() && detail()?.latestRun?.sessionID !== undefined,
        run: () => viewSession(detail()),
      },
    ],
  }))

  createEffect(() => {
    const last = Math.max(0, flows().length - 1)
    if (selected() > last) setSelected(last)
    const current = detailKey()
    if (!current || flows().some((flow) => key(flow) === current)) return
    setConfirmingDelete(false)
    setDetailKey()
  })

  onMount(() => {
    void refresh()
    timer = setInterval(() => void refresh(), props.pollMilliseconds ?? 10_000)
  })
  onCleanup(() => {
    mounted.abort()
    active?.abort()
    mutation?.abort()
    if (timer) clearInterval(timer)
  })

  return (
    <box paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text
          attributes={TextAttributes.BOLD}
          fg={theme().text.base}
          wrapMode="none"
          truncate
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
        >
          {detail() ? `Periodic / ${detail()?.name}` : "Periodic"}
        </text>
        <text fg={theme().text.muted} flexShrink={0}>
          {detail() ? "esc back" : "esc close"}
        </text>
      </box>
      <Show when={stale()}>
        <text fg={theme().text.feedback.warning.base} wrapMode="none" truncate minWidth={0}>
          Stale · refresh failed: {error()}
        </text>
      </Show>
      <Show when={notice()}>
        {(current) => (
          <text fg={theme().text.feedback[current().variant].base} wrapMode="none" truncate minWidth={0}>
            {current().message}
          </text>
        )}
      </Show>
      <Show when={warning()}>
        {(current) => (
          <text fg={theme().text.feedback.warning.base} wrapMode="none" truncate minWidth={0}>
            {result()?.warnings.length} source warning{result()?.warnings.length === 1 ? "" : "s"}: {current().message}
          </text>
        )}
      </Show>
      <Show when={loading() && !result()}>
        <box height={8} alignItems="center" justifyContent="center">
          <text fg={theme().text.muted}>Loading local flows…</text>
        </box>
      </Show>
      <Show when={!loading() && !result()}>
        <box height={8} alignItems="center" justifyContent="center" gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme().text.feedback.error.base}>
            Couldn’t load flows
          </text>
          <text fg={theme().text.muted}>{error()}</text>
          <text fg={theme().text.muted}>Press r to retry.</text>
        </box>
      </Show>
      <Show when={result() && flows().length === 0}>
        <box height={8} alignItems="center" justifyContent="center" gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
            No periodic flows
          </text>
          <text fg={theme().text.muted}>Scheduled local tasks will appear here.</text>
          <text fg={theme().text.muted}>Press r to refresh.</text>
        </box>
      </Show>
      <Show when={flows().length > 0}>
        <box visible={!detail()} gap={1}>
          <scrollbox maxHeight={listHeight()} width="100%" ref={(element: ScrollBoxRenderable) => (scroll = element)}>
            <For each={flows()}>
              {(flow, index) => {
                const active = () => index() === selected()
                const foreground = () => (active() ? theme().text.action.primary.focused : theme().text.base)
                const secondary = () => (active() ? theme().text.action.primary.focused : theme().text.muted)
                return (
                  <box
                    width="100%"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? theme().background.action.primary.focused : undefined}
                    onMouseDown={() => setSelected(index())}
                    onMouseOver={() => setSelected(index())}
                    onMouseUp={() => showDetail(flow)}
                  >
                    <text wrapMode="none" truncate minWidth={0} fg={foreground()}>
                      <span style={{ fg: foreground() }}>
                        {active() ? "›" : " "} {flow.name}
                      </span>
                      <span style={{ fg: secondary() }}>{` · ${trigger(flow.trigger)} · `}</span>
                      <span style={{ fg: active() ? foreground() : statusColor(flow.status, theme()) }}>
                        {label(flow.status)}
                      </span>
                      <Show when={flow.nextRunAt === undefined ? undefined : flow.nextRunAt}>
                        {(next) => (
                          <span style={{ fg: secondary() }}>{` · next ${date(next())}`}</span>
                        )}
                      </Show>
                      <Show when={flow.reference.type === "native-schedule"}>
                        <span style={{ fg: secondary() }}>{" · Unmanaged"}</span>
                      </Show>
                    </text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
          <box flexDirection="row" justifyContent="space-between" gap={2}>
            <text fg={theme().text.muted} flexShrink={0}>
              {flows().length} task{flows().length === 1 ? "" : "s"}
            </text>
            <text fg={theme().text.muted} wrapMode="none" truncate minWidth={0}>
              ↑/↓ select · enter details · r refresh
            </text>
          </box>
        </box>
      </Show>
      <Show when={detail()}>
        {(flow) => (
          <>
            <scrollbox maxHeight={detailHeight()} width="100%" ref={(element: ScrollBoxRenderable) => (detailScroll = element)}>
              <box gap={0}>
                <DetailRow label="Status" theme={theme()}>
                  <span style={{ fg: statusColor(flow().status, theme()) }}>{label(flow().status)}</span>
                  {nextRun(flow())}
                </DetailRow>
                <DetailRow label="Trigger" theme={theme()}>{trigger(flow().trigger)}</DetailRow>
                <DetailRow label="Location" theme={theme()}>
                  {flow().context.directory ?? "Unavailable"}
                  {flow().context.projectID ? ` · ${flow().context.projectID}` : ""}
                </DetailRow>
                <DetailRow label="Execution" theme={theme()}>
                  {execution(flow().execution)}
                </DetailRow>
                <Show when={flow().context.model}>
                  {(model) => <DetailRow label="Model" theme={theme()}>{`${model().providerID}/${model().id}`}</DetailRow>}
                </Show>
                <Show when={flow().context.agent}>
                  {(agent) => <DetailRow label="Agent" theme={theme()}>{agent()}</DetailRow>}
                </Show>
                <DetailRow label="Prompt" theme={theme()}>{flow().prompt}</DetailRow>
                <Show when={flow().permissions}>
                  {(permissions) => (
                    <DetailRow label="Permissions" theme={theme()}>
                      {permissions().length === 0 ? "None" : permissions().map(permission).join(", ")}
                    </DetailRow>
                  )}
                </Show>
                <Show when={flow().latestRun}>
                  {(latest) => (
                    <>
                      <DetailRow label="Latest run" theme={theme()}>
                        {label(latest().status)} · {date(latest().time.completed ?? latest().time.started ?? latest().time.created)}
                      </DetailRow>
                      <Show when={latest().directory}>
                        {(directory) => <DetailRow label="Run location" theme={theme()}>{directory()}</DetailRow>}
                      </Show>
                      <Show when={latest().error}>
                        {(runError) => <DetailRow label="Run error" theme={theme()}>{summary(runError())}</DetailRow>}
                      </Show>
                    </>
                  )}
                </Show>
                <Show when={healthMessage(flow().health)}>
                  {(health) => (
                    <DetailRow label="Health" theme={theme()}>
                      <span style={{ fg: theme().text.feedback.error.base }}>{health()}</span>
                    </DetailRow>
                  )}
                </Show>
              </box>
            </scrollbox>
            <Show when={flow().reference.type === "native-schedule"}>
              <text fg={theme().text.muted}>Unmanaged schedules are read-only.</text>
            </Show>
            <Show
              when={confirmingDelete()}
              fallback={
                <box flexDirection="row" flexWrap="wrap" gap={1}>
                  <Show when={flow().reference.type === "managed" && (flow().status === "active" || flow().status === "paused")}>
                    <Action
                      label={flow().status === "paused" ? "Enable" : "Disable"}
                      shortcut="e"
                      theme={theme()}
                      disabled={changing()}
                      onTrigger={() => void change(flow().status === "paused" ? "resume" : "pause", flow())}
                    />
                  </Show>
                  <Show when={flow().reference.type === "managed"}>
                    <Action label="Run now" shortcut="r" theme={theme()} disabled={changing()} onTrigger={() => void runNow(flow())} />
                    <Action label="Delete" shortcut="d" theme={theme()} disabled={changing()} onTrigger={() => setConfirmingDelete(true)} />
                  </Show>
                  <Show when={flow().latestRun?.sessionID}>
                    <Action label="View session" shortcut="v" theme={theme()} onTrigger={() => viewSession(flow())} />
                  </Show>
                </box>
              }
            >
              <box gap={1}>
                <text fg={theme().text.feedback.warning.base} wrapMode="none" truncate minWidth={0}>
                  Delete {flow().name}? Future runs stop and retained run records are removed.
                </text>
                <box flexDirection="row" gap={1}>
                  <Action label="Cancel" shortcut="n" theme={theme()} onTrigger={() => setConfirmingDelete(false)} />
                  <Action label="Delete" shortcut="y" theme={theme()} onTrigger={() => void change("remove", flow())} />
                </box>
              </box>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function DetailRow(props: { label: string; theme: Plugin.Context["theme"]; children: JSX.Element }) {
  return (
    <box flexDirection="row" gap={1}>
      <text width={12} flexShrink={0} fg={props.theme.text.muted}>{props.label}</text>
      <text flexGrow={1} wrapMode="word" fg={props.theme.text.base}>{props.children}</text>
    </box>
  )
}

function Action(props: {
  label: string
  shortcut: string
  theme: Plugin.Context["theme"]
  disabled?: boolean
  onTrigger: () => void
}) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hovered() && !props.disabled ? props.theme.background.action.secondary.hovered : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        if (!props.disabled) props.onTrigger()
      }}
    >
      <text fg={props.disabled ? props.theme.text.action.secondary.disabled : props.theme.text.action.secondary.base}>
        {props.label} <span style={{ fg: props.theme.text.muted }}>{props.shortcut}</span>
      </text>
    </box>
  )
}

const rank: Record<KiloFlowRpc.Status, number> = { error: 0, active: 1, paused: 2, completed: 3 }

function key(flow: KiloFlowRpc.Info) {
  return flow.reference.type === "managed" ? flow.reference.flowID : flow.reference.scheduleID
}

function compare(left: KiloFlowRpc.Info, right: KiloFlowRpc.Info) {
  const ordered = (rank[left.status] ?? rank.error) - (rank[right.status] ?? rank.error)
  if (ordered !== 0) return ordered
  if (left.status === "active" && right.status === "active")
    return (left.nextRunAt ?? Number.POSITIVE_INFINITY) - (right.nextRunAt ?? Number.POSITIVE_INFINITY)
  return left.name.localeCompare(right.name)
}

function trigger(value: KiloFlowRpc.Trigger) {
  const schedule = when(value.when)
  if (value.type === "time") return schedule
  return `Poll ${schedule.toLowerCase()} (${value.mode}, ${value.condition.type})`
}

function when(value: KiloFlowRpc.Trigger["when"]) {
  if (value.type === "in") return `In ${value.in}`
  if (value.type === "at") return `At ${value.at}`
  if (value.type === "every") return `Every ${value.every}`
  return `Cron ${value.cron}`
}

function date(value: number) {
  return new Date(value).toLocaleString()
}

function label(value: KiloFlowRpc.Status | KiloFlowRpc.RunStatus) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function statusColor(value: KiloFlowRpc.Status, theme: Plugin.Context["theme"]) {
  if (value === "error") return theme.text.feedback.error.base
  if (value === "paused") return theme.text.feedback.warning.base
  if (value === "completed") return theme.text.feedback.success.base
  return theme.text.feedback.info.base
}

function nextRun(flow: KiloFlowRpc.Info) {
  return flow.nextRunAt === undefined ? "" : ` · next ${date(flow.nextRunAt)}`
}

function execution(value: KiloFlowRpc.Execution) {
  if (value.mode === "fresh") return `Local · fresh Session · ${value.worktree} worktree`
  return "Local · Session reuse"
}

function healthMessage(value: KiloFlowRpc.Health) {
  if (value.status === "error") return value.message
}

function summary(value: string) {
  return value.split("\n", 1)[0]
}

function permission(value: KiloFlowRpc.PermissionGrant) {
  return `${value.action} ${value.resource}`
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}

export default Plugin.define({
  id: "kilocode.flows",
  setup(context) {
    let dialogOwner: object | undefined
    const unregisterSlot = context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "periodic.open",
              title: "Periodic flows",
              description: "View local automations",
              group: "Kilo",
              palette: true,
              slash: { name: "periodic" },
              run() {
                const owner = {}
                dialogOwner = owner
                context.ui.dialog.show(
                  () => <FlowsDialog context={context} />,
                  () => {
                    if (dialogOwner === owner) dialogOwner = undefined
                  },
                )
                context.ui.dialog.set({ size: "large" })
              },
            },
          ],
        }))
        return null
      },
    })
    return () => {
      unregisterSlot()
      if (dialogOwner) context.ui.dialog.clear()
    }
  },
})
