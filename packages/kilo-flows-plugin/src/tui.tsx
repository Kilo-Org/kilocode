import { Plugin } from "@opencode/plugin/tui"
import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

type Load = (signal: AbortSignal) => Promise<KiloFlowRpc.ListOutput>
type PageContext = Pick<Plugin.Context, "client" | "data" | "keymap" | "renderer" | "ui">

export function FlowsPage(props: {
  context: PageContext
  onClose: () => void
  load?: Load
  pollMilliseconds?: number
}) {
  const [result, setResult] = createSignal<KiloFlowRpc.ListOutput>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [stale, setStale] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const mounted = new AbortController()
  let active: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let scroll: ScrollBoxRenderable | undefined
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
  const flows = createMemo(() => [...(result()?.flows ?? [])].sort(compare))
  const warning = createMemo(() => (!stale() ? result()?.warnings[0] : undefined))

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
    if (flows().length === 0) return
    const next = Math.max(0, Math.min(flows().length - 1, selected() + offset))
    setSelected(next)
    reveal(next)
  }

  function open(flow: KiloFlowRpc.Info | undefined) {
    const sessionID = flow?.latestRun?.sessionID
    if (!sessionID) {
      setNotice(`${flow?.name ?? "This Flow"} has not run yet.`)
      return
    }
    setNotice("")
    props.context.ui.router.navigate({ type: "session", sessionID })
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
      setResult(next)
      setError("")
      setStale(false)
    } catch (cause) {
      if (signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setStale(result() !== undefined)
    } finally {
      if (active === request) active = undefined
      if (!signal.aborted) setLoading(false)
    }
  }

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "Back", group: "Flows", run: props.onClose },
      { bind: "r", title: "Refresh", group: "Flows", run: () => void refresh() },
      { bind: "up,k", title: "Previous Flow", group: "Flows", run: () => move(-1) },
      { bind: "down,j", title: "Next Flow", group: "Flows", run: () => move(1) },
      {
        bind: "return",
        title: "Open latest run",
        group: "Flows",
        enabled: () => flows()[selected()]?.latestRun?.sessionID !== undefined,
        run: () => open(flows()[selected()]),
      },
    ],
  }))

  createEffect(() => {
    const last = Math.max(0, flows().length - 1)
    if (selected() > last) setSelected(last)
  })

  onMount(() => {
    void refresh()
    timer = setInterval(() => void refresh(), props.pollMilliseconds ?? 10_000)
  })
  onCleanup(() => {
    mounted.abort()
    active?.abort()
    if (timer) clearInterval(timer)
  })

  return (
    <box width="100%" height="100%" flexDirection="column" padding={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>Flows</text>
        <text>↑/↓ select · enter open run · r refresh · esc back</text>
      </box>
      <Show when={stale()}>
        <text>Stale · refresh failed: {error()}</text>
      </Show>
      <Show when={notice()}>{(message) => <text>{message()}</text>}</Show>
      <Show when={warning()}>
        {(current) => (
          <text>
            {result()?.warnings.length} source warning{result()?.warnings.length === 1 ? "" : "s"}: {current().message}
          </text>
        )}
      </Show>
      <Show when={loading() && !result()}>
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text>Loading local flows…</text>
        </box>
      </Show>
      <Show when={!loading() && !result()}>
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" gap={1}>
          <text attributes={TextAttributes.BOLD}>Couldn’t load flows</text>
          <text>{error()}</text>
          <text>Press r to retry.</text>
        </box>
      </Show>
      <Show when={result() && flows().length === 0}>
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" gap={1}>
          <text attributes={TextAttributes.BOLD}>No local flows</text>
          <text>Native schedules and managed Kilo flows will appear here.</text>
          <text>Press r to refresh.</text>
        </box>
      </Show>
      <Show when={flows().length > 0}>
        <scrollbox flexGrow={1} width="100%" ref={(element: ScrollBoxRenderable) => (scroll = element)}>
          <For each={flows()}>
            {(flow, index) => (
              <box
                width="100%"
                flexDirection="column"
                paddingBottom={1}
                onMouseOver={() => setSelected(index())}
                onMouseUp={() => open(flow)}
              >
                <box flexDirection="row" gap={1}>
                  <text>{index() === selected() ? "›" : " "}</text>
                  <text attributes={TextAttributes.BOLD}>{flow.name}</text>
                  <text>[Local]</text>
                  <Show when={flow.reference.type === "native-schedule"}>
                    <text>[Unmanaged]</text>
                  </Show>
                </box>
                <text>
                  {trigger(flow.trigger)} · Schedule {flow.status}
                  {flow.nextRunAt === undefined ? "" : ` · next ${date(flow.nextRunAt)}`}
                </text>
                <text>
                  {flow.context.directory ?? "Location unavailable"}
                  {flow.context.projectID ? ` · ${flow.context.projectID}` : ""}
                </text>
                <Show when={flow.permissions}>
                  {(permissions) => (
                    <text>
                      Permissions: {permissions().length === 0 ? "none" : permissions().map(permission).join(", ")}
                    </text>
                  )}
                </Show>
                <Show when={flow.latestRun}>
                  {(run) => (
                    <>
                      <text>
                        Latest run: {label(run().status)} ·{" "}
                        {date(run().time.completed ?? run().time.started ?? run().time.created)}
                        {run().sessionID ? ` · session ${run().sessionID}` : ""}
                      </text>
                      <Show when={run().directory}>{(directory) => <text>Run directory: {directory()}</text>}</Show>
                      <Show when={run().error}>{(message) => <text>Run error: {summary(message())}</text>}</Show>
                    </>
                  )}
                </Show>
                <Show when={flow.health.status === "error"}>
                  <text>Error: {flow.health.status === "error" ? flow.health.message : ""}</text>
                </Show>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

function compare(left: KiloFlowRpc.Info, right: KiloFlowRpc.Info) {
  const rank = { error: 0, active: 1, paused: 2, completed: 3 }
  const ordered = rank[left.status] - rank[right.status]
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

function label(value: KiloFlowRpc.RunStatus) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function summary(value: string) {
  return value.split("\n", 1)[0]
}

function permission(value: KiloFlowRpc.PermissionGrant) {
  return `${value.action} ${value.resource}`
}

export default Plugin.define({
  id: "kilocode.flows",
  setup(context) {
    let previous = { ...context.ui.router.current() }
    const unregisterRoute = context.ui.router.register({
      name: "periodic",
      render: () => <FlowsPage context={context} onClose={() => context.ui.router.navigate(previous)} />,
    })
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
                const current = context.ui.router.current()
                if (current.type === "plugin" && current.name === "periodic") return
                previous = { ...current }
                context.ui.dialog.clear()
                context.ui.router.navigate({ type: "plugin", name: "periodic" })
              },
            },
          ],
        }))
        return null
      },
    })
    return () => {
      unregisterSlot()
      unregisterRoute()
    }
  },
})
