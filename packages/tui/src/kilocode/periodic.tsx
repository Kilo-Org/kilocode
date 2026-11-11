// `/periodic`: the managed Flows and the other schedules of the launch project, from the `kilocode.flow` RPC. The open
// dialog refreshes on the RPC's `changed` events; creating, editing and repairing a Flow runs the wizard in
// periodic-wizard.ts.
import { Plugin } from "@opencode/plugin/tui"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { TextAttributes, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { errorMessage } from "../util/error"
import {
  capitalize,
  createFlow,
  editFlow,
  endsLabel,
  focus,
  key,
  options,
  permission,
  trigger,
  type Initial,
  type Open,
  type PeriodicContext,
  type UpdateInput,
} from "./periodic-wizard"

type Notice = { readonly message: string; readonly variant: "success" | "error" | "info" }

/** The wizards the dialog starts. Each closes `/periodic` and reopens it when done. */
export type Actions = {
  readonly create: (selected: string | undefined) => void
  readonly edit: (flow: KiloFlowRpc.Info) => void
  readonly repair: (flow: KiloFlowRpc.Info) => void
}

/** `changed` events keep the open dialog current; this refresh only covers an event missed while disconnected. */
const FALLBACK_REFRESH_MS = 60_000

export function FlowsDialog(props: { context: PeriodicContext; initial?: Initial; actions?: Actions }) {
  const rpc = props.context.client.rpc(KiloFlowRpc.Definition)
  const location = options(props.context).location
  const [result, setResult] = createSignal<KiloFlowRpc.ListOutput>()
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal<Notice>()
  const [stale, setStale] = createSignal(false)
  const [changing, setChanging] = createSignal(false)
  const [selected, setSelected] = createSignal(0)
  const [detailKey, setDetailKey] = createSignal<string>()
  const [confirmingDelete, setConfirmingDelete] = createSignal(false)
  const [runs, setRuns] = createSignal<readonly KiloFlowRpc.Run[]>()
  const [runWarnings, setRunWarnings] = createSignal<readonly KiloFlowRpc.Warning[]>([])
  const [runsError, setRunsError] = createSignal("")
  const [runsLoading, setRunsLoading] = createSignal(false)
  const [selectedRun, setSelectedRun] = createSignal<string>()
  const mounted = new AbortController()
  const runRows = new Map<string, Renderable>()
  let target = props.initial?.key
  let project: string | undefined
  let active: AbortController | undefined
  let queued = false
  let mutation: AbortController | undefined
  let history: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let scroll: ScrollBoxRenderable | undefined
  let detailScroll: ScrollBoxRenderable | undefined
  const theme = () => props.context.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const flows = createMemo(() => [...(result()?.flows ?? [])].sort(compare))
  const detail = createMemo(() => flows().find((flow) => key(flow) === detailKey()))
  const warning = createMemo(() => (!stale() ? result()?.warnings[0] : undefined))
  const run = createMemo(() => runs()?.find((item) => item.id === selectedRun()))
  // Only runs in a new worktree leave one behind; an edit can change the choice, so earlier runs count too.
  const cleanable = createMemo(() => {
    const flow = detail()
    if (flow?.execution.mode === "fresh" && flow.execution.worktree === "new") return true
    return (runs() ?? []).some((item) => item.worktree === "new")
  })
  const banners = createMemo(() => Number(stale()) + Number(notice() !== undefined) + Number(warning() !== undefined))
  const availableHeight = createMemo(() => dimensions().height - Math.floor(dimensions().height / 4))
  const listHeight = createMemo(() => Math.max(1, Math.min(15, availableHeight() - 6 - banners() * 2)))
  const detailHeight = createMemo(() =>
    Math.max(
      1,
      Math.min(16, availableHeight() - (confirmingDelete() ? 8 + Number(cleanable()) : 7) - banners() * 2),
    ),
  )

  // Re-sorting after a refresh or a status change keeps the cursor on the same Flow rather than the same row.
  function replace(next: KiloFlowRpc.ListOutput) {
    const current = flows()[selected()]
    setResult(next)
    if (!current) return
    const index = flows().findIndex((flow) => key(flow) === key(current))
    if (index < 0 || index === selected()) return
    setSelected(index)
    reveal(() => scroll, () => scroll?.getChildren()[index])
  }

  function patch(updated: KiloFlowRpc.Info) {
    const current = result()
    if (!current) return
    replace({ ...current, flows: current.flows.map((item) => (key(item) === key(updated) ? updated : item)) })
  }

  function reveal(box: () => ScrollBoxRenderable | undefined, row: () => Renderable | undefined) {
    props.context.renderer.requestAnimationFrame(() => {
      const container = box()
      const element = row()
      if (!container || container.isDestroyed || !element || element.isDestroyed) return
      if (element.y < container.viewport.y) container.scrollBy(element.y - container.viewport.y)
      const height = Math.min(element.height, container.viewport.height)
      if (element.y + height > container.viewport.y + container.viewport.height)
        container.scrollBy(element.y + height - container.viewport.y - container.viewport.height)
    })
  }

  function move(offset: number) {
    if (flows().length === 0 || detail()) return
    const next = Math.max(0, Math.min(flows().length - 1, selected() + offset))
    setSelected(next)
    reveal(() => scroll, () => scroll?.getChildren()[next])
  }

  function scrollDetail(offset: number, viewport = false) {
    if (!detailScroll || detailScroll.isDestroyed) return
    detailScroll.scrollBy(offset, viewport ? "viewport" : undefined)
  }

  // Down enters the run history from the details above it, and up from the newest run leaves it again.
  function step(offset: number) {
    const list = runs() ?? []
    if (list.length === 0) return scrollDetail(offset)
    const index = list.findIndex((item) => item.id === selectedRun())
    if (index < 0 && offset < 0) return scrollDetail(offset)
    if (index === 0 && offset < 0) {
      setSelectedRun()
      return
    }
    const next = list[Math.max(0, Math.min(list.length - 1, index + offset))]
    setSelectedRun(next.id)
    reveal(() => detailScroll, () => runRows.get(next.id))
  }

  function showDetail(flow: KiloFlowRpc.Info | undefined) {
    if (!flow) return
    setNotice()
    openDetail(flow)
  }

  function openDetail(flow: KiloFlowRpc.Info) {
    setConfirmingDelete(false)
    setDetailKey(key(flow))
    setSelectedRun()
    setRuns()
    runRows.clear()
    setRunWarnings([])
    setRunsError("")
    loadRuns(flow)
  }

  function back() {
    if (confirmingDelete()) {
      setConfirmingDelete(false)
      return
    }
    history?.abort()
    setNotice()
    setDetailKey()
    setSelectedRun()
    setRuns()
  }

  function open(sessionID: string | undefined, missing: string) {
    if (!sessionID) {
      setNotice({ message: missing, variant: "info" })
      return
    }
    props.context.ui.dialog.clear()
    focus(props.context, sessionID)
  }

  function mutate<Value>(
    task: (signal: AbortSignal) => Promise<Value>,
    done: (value: Value) => void,
    failure: string,
    pending?: string,
  ) {
    if (mutation) return
    const request = new AbortController()
    mutation = request
    setChanging(true)
    setNotice(pending ? { message: pending, variant: "info" } : undefined)
    const signal = AbortSignal.any([mounted.signal, request.signal])
    void task(signal)
      .then(
        (value) => {
          if (!signal.aborted) done(value)
        },
        (cause: unknown) => {
          if (!signal.aborted) setNotice({ message: `${failure}: ${errorMessage(cause)}`, variant: "error" })
        },
      )
      .finally(() => {
        if (mutation === request) mutation = undefined
        if (!signal.aborted) setChanging(false)
      })
  }

  function toggle(flow: KiloFlowRpc.Info | undefined) {
    if (flow?.reference.type !== "managed") return
    const flowID = flow.reference.flowID
    const resume = flow.status === "paused"
    mutate(
      (signal) =>
        resume ? rpc.resume({ flowID }, { location, signal }) : rpc.pause({ flowID }, { location, signal }),
      (updated) => {
        patch(updated)
        setNotice({ message: `${resume ? "Enabled" : "Disabled"} ${flow.name}.`, variant: "success" })
      },
      "Update failed",
    )
  }

  function remove(flow: KiloFlowRpc.Info | undefined, clean: boolean) {
    if (flow?.reference.type !== "managed") return
    const flowID = flow.reference.flowID
    mutate(
      (signal) => rpc.remove(clean ? { flowID, deleteWorktrees: true } : { flowID }, { location, signal }),
      (output) => {
        setDetailKey()
        setConfirmingDelete(false)
        const current = result()
        if (current) replace({ ...current, flows: current.flows.filter((item) => key(item) !== flowID) })
        const removed = output.removedWorktrees?.length ?? 0
        setNotice({
          message: `Deleted ${flow.name}.${removed === 0 ? "" : ` Removed ${removed} worktree${removed === 1 ? "" : "s"}.`}`,
          variant: "success",
        })
        const kept = output.keptWorktrees ?? []
        if (kept.length > 0)
          props.context.ui.toast.show({
            variant: "warning",
            title: `Kept ${kept.length} worktree${kept.length === 1 ? "" : "s"} with changes`,
            message: kept.join("\n"),
          })
      },
      "Delete failed",
    )
  }

  function runNow(flow: KiloFlowRpc.Info | undefined) {
    if (flow?.reference.type !== "managed") return
    const flowID = flow.reference.flowID
    mutate(
      (signal) => rpc.run({ flowID }, { location, signal }),
      (started) => {
        loadRuns(flow)
        if (started.status === "skipped") {
          setNotice({ message: `Skipped ${flow.name}: another run is active.`, variant: "info" })
          return
        }
        const current = result()
        if (current)
          replace({
            ...current,
            flows: current.flows.map((item) =>
              key(item) === flowID
                ? { ...item, latestRun: started, lastRunAt: started.time.started ?? started.time.created }
                : item,
            ),
          })
        setNotice({
          message: `${capitalize(started.status)} ${flow.name}.`,
          variant: started.status === "failed" || started.status === "interrupted" ? "error" : "success",
        })
      },
      "Run failed",
    )
  }

  function save(input: UpdateInput) {
    mutate(
      (signal) => rpc.update(input, { location, signal }),
      (updated) => {
        patch(updated)
        setNotice({ message: `Saved ${updated.name}.`, variant: "success" })
        void refresh()
      },
      "Save failed",
      "Saving changes…",
    )
  }

  // One list request at a time; a refresh asked for meanwhile runs once it settles, so a change it may have missed
  // still shows.
  async function refresh() {
    if (active) {
      queued = true
      return
    }
    const request = new AbortController()
    active = request
    if (!result()) setLoading(true)
    const signal = AbortSignal.any([mounted.signal, request.signal])
    await rpc.list({}, { location, signal }).then(
      (next) => {
        if (signal.aborted) return
        replace(next)
        select()
        setError("")
        setStale(false)
      },
      (cause: unknown) => {
        if (signal.aborted) return
        setError(errorMessage(cause))
        setStale(result() !== undefined)
      },
    )
    if (active === request) active = undefined
    if (signal.aborted) return
    setLoading(false)
    if (!queued) return
    queued = false
    void refresh()
  }

  // Selects the Flow `/periodic` was opened for once the first list arrives. Its details keep the notice of a save
  // that started on open.
  function select() {
    if (target === undefined) return
    const index = flows().findIndex((flow) => key(flow) === target)
    target = undefined
    if (index < 0) return
    setSelected(index)
    reveal(() => scroll, () => scroll?.getChildren()[index])
    if (props.initial?.detail) openDetail(flows()[index])
  }

  function loadRuns(flow: KiloFlowRpc.Info) {
    if (flow.reference.type !== "managed") return
    const flowID = flow.reference.flowID
    // A response that arrives after the user left or opened another Flow must not replace that Flow's history.
    const stale = (signal: AbortSignal) => signal.aborted || detailKey() !== flowID
    history?.abort()
    const request = new AbortController()
    history = request
    const signal = AbortSignal.any([mounted.signal, request.signal])
    setRunsLoading(true)
    void rpc
      .runs({ flowID }, { location, signal })
      .then(
        (output) => {
          if (stale(signal)) return
          setRuns(output.runs)
          setRunWarnings(output.warnings)
          setRunsError("")
        },
        (cause: unknown) => {
          if (!stale(signal)) setRunsError(errorMessage(cause))
        },
      )
      .finally(() => {
        if (history !== request) return
        history = undefined
        setRunsLoading(false)
      })
  }

  function reload() {
    void refresh()
    const flow = detail()
    if (flow) loadRuns(flow)
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
      { bind: "ctrl+r", title: "Refresh periodic flows", group: "Periodic", run: reload },
      {
        bind: "up,k",
        title: detail() ? ((runs()?.length ?? 0) > 0 ? "Previous run" : "Scroll details up") : "Previous Flow",
        group: "Periodic",
        run: () => (detail() ? step(-1) : move(-1)),
      },
      {
        bind: "down,j",
        title: detail() ? ((runs()?.length ?? 0) > 0 ? "Next run" : "Scroll details down") : "Next Flow",
        group: "Periodic",
        run: () => (detail() ? step(1) : move(1)),
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
        title: detail() ? "Open run session" : "Show Flow details",
        group: "Periodic",
        enabled: () => (detail() ? !confirmingDelete() && run()?.sessionID !== undefined : flows().length > 0),
        run: () => (detail() ? open(run()?.sessionID, "This run has no session.") : showDetail(flows()[selected()])),
      },
      {
        bind: "r",
        title: !detail() ? "Refresh periodic flows" : broken(detail()) ? "Repair Flow" : "Run Flow now",
        group: "Periodic",
        enabled: () => {
          const flow = detail()
          if (!flow) return true
          if (changing() || confirmingDelete() || flow.reference.type !== "managed") return false
          return !broken(flow) || props.actions !== undefined
        },
        run: () => {
          const flow = detail()
          if (!flow) return void refresh()
          if (!broken(flow)) return runNow(flow)
          props.actions?.repair(flow)
        },
      },
      {
        bind: "n",
        title: confirmingDelete() ? "Cancel Flow deletion" : "New Flow",
        group: "Periodic",
        enabled: () => confirmingDelete() || (!detail() && props.actions !== undefined),
        run: () => {
          const flow = flows()[selected()]
          if (!confirmingDelete()) return props.actions?.create(flow && key(flow))
          setConfirmingDelete(false)
        },
      },
      {
        bind: "e",
        title: "Edit Flow",
        group: "Periodic",
        enabled: () =>
          props.actions !== undefined &&
          !changing() &&
          !confirmingDelete() &&
          detail()?.reference.type === "managed",
        run: () => {
          const flow = detail()
          if (flow) props.actions?.edit(flow)
        },
      },
      {
        bind: "space",
        title: "Enable or disable Flow",
        group: "Periodic",
        enabled: () => !changing() && !confirmingDelete() && toggleable(detail()),
        run: () => toggle(detail()),
      },
      {
        bind: "d",
        title: "Delete Flow",
        group: "Periodic",
        enabled: () => !changing() && !confirmingDelete() && detail()?.reference.type === "managed",
        run: () => {
          setConfirmingDelete(true)
        },
      },
      {
        bind: "y",
        title: "Confirm Flow deletion",
        group: "Periodic",
        enabled: confirmingDelete,
        run: () => remove(detail(), false),
      },
      {
        bind: "w",
        title: "Delete Flow and clean its worktrees",
        group: "Periodic",
        enabled: () => confirmingDelete() && cleanable(),
        run: () => remove(detail(), true),
      },
      {
        bind: "v",
        title: "View latest run Session",
        group: "Periodic",
        enabled: () => !confirmingDelete() && detail()?.latestRun?.sessionID !== undefined,
        run: () => open(detail()?.latestRun?.sessionID, `${detail()?.name ?? "This Flow"} has not run yet.`),
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
    setRuns()
  })

  onCleanup(
    rpc.events.on("changed", (event) => {
      if (project !== undefined && event.data.projectID !== project) return
      void refresh()
      const flow = detail()
      if (flow?.reference.type !== "managed") return
      if (event.data.flowID === undefined || event.data.flowID === flow.reference.flowID) loadRuns(flow)
    }),
  )
  onCleanup(props.context.data.on("server.connected", reload))

  onMount(() => {
    void refresh()
    void props.context.client.location.get({ location }).then(
      (info) => {
        project = info.project.id
      },
      () => undefined,
    )
    timer = setInterval(() => void refresh(), FALLBACK_REFRESH_MS)
    if (props.initial?.save) save(props.initial.save)
  })
  onCleanup(() => {
    mounted.abort()
    active?.abort()
    mutation?.abort()
    history?.abort()
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
          <text fg={theme().text.muted}>
            {props.actions ? "Press n to create one from a session, r to refresh." : "Press r to refresh."}
          </text>
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
                        {capitalize(flow.status)}
                      </span>
                      <Show when={flow.nextRunAt === undefined ? undefined : flow.nextRunAt}>
                        {(next) => <span style={{ fg: secondary() }}>{` · next ${date(next())}`}</span>}
                      </Show>
                      <Show when={kind(flow)}>{(value) => <span style={{ fg: secondary() }}>{` · ${value()}`}</span>}</Show>
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
              {props.actions ? "↑/↓ select · enter details · n new · r refresh" : "↑/↓ select · enter details · r refresh"}
            </text>
          </box>
        </box>
      </Show>
      <Show when={detail()}>
        {(flow) => (
          <>
            <scrollbox
              maxHeight={detailHeight()}
              width="100%"
              ref={(element: ScrollBoxRenderable) => (detailScroll = element)}
            >
              <>
                <DetailRow label="Status" theme={theme()}>
                  <span style={{ fg: statusColor(flow().status, theme()) }}>{capitalize(flow().status)}</span>
                  {flow().nextRunAt === undefined ? "" : ` · next ${date(flow().nextRunAt ?? 0)}`}
                </DetailRow>
                <Show when={kind(flow())}>
                  {(value) => (
                    <DetailRow label="Kind" theme={theme()}>
                      {capitalize(value())}
                    </DetailRow>
                  )}
                </Show>
                <DetailRow label="Trigger" theme={theme()}>
                  {trigger(flow().trigger)}
                </DetailRow>
                <Show when={ends(flow())}>
                  {(value) => (
                    <DetailRow label="Ends" theme={theme()}>
                      {value()}
                    </DetailRow>
                  )}
                </Show>
                <DetailRow label="Location" theme={theme()}>
                  {flow().context.directory ?? "Unavailable"}
                  {flow().context.projectID ? ` · ${flow().context.projectID}` : ""}
                </DetailRow>
                <DetailRow label="Execution" theme={theme()}>
                  {execution(flow().execution)}
                </DetailRow>
                <Show when={flow().context.model}>
                  {(model) => (
                    <DetailRow label="Model" theme={theme()}>
                      {`${model().providerID}/${model().id}`}
                    </DetailRow>
                  )}
                </Show>
                <Show when={flow().context.agent}>
                  {(agent) => (
                    <DetailRow label="Agent" theme={theme()}>
                      {agent()}
                    </DetailRow>
                  )}
                </Show>
                <Show when={flow().prompt.trim()}>
                  {(prompt) => (
                    <DetailRow label="Prompt" theme={theme()}>
                      {prompt()}
                    </DetailRow>
                  )}
                </Show>
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
                        {capitalize(latest().status)} ·{" "}
                        {date(latest().time.completed ?? latest().time.started ?? latest().time.created)}
                      </DetailRow>
                      <Show when={latest().directory}>
                        {(directory) => (
                          <DetailRow label="Run location" theme={theme()}>
                            {directory()}
                          </DetailRow>
                        )}
                      </Show>
                      <Show when={latest().error}>
                        {(runError) => (
                          <DetailRow label="Run error" theme={theme()}>
                            {summary(runError())}
                          </DetailRow>
                        )}
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
                <Show when={flow().reference.type === "managed"}>
                  <box marginTop={1}>
                    <text fg={theme().text.muted} wrapMode="none" truncate minWidth={0}>
                      {(runs()?.length ?? 0) > 0 ? "Runs · ↑/↓ select · enter open session" : "Runs"}
                    </text>
                    <Show when={runsError()}>
                      {(message) => (
                        <text fg={theme().text.feedback.error.base} wrapMode="none" truncate minWidth={0}>
                          Couldn’t load runs: {message()}
                        </text>
                      )}
                    </Show>
                    <Show when={runWarnings()[0]}>
                      {(first) => (
                        <text fg={theme().text.feedback.warning.base} wrapMode="none" truncate minWidth={0}>
                          {runWarnings().length} run warning{runWarnings().length === 1 ? "" : "s"}: {first().message}
                        </text>
                      )}
                    </Show>
                    <Show when={runs() === undefined && runsLoading()}>
                      <text fg={theme().text.muted}>Loading runs…</text>
                    </Show>
                    <Show when={runs()?.length === 0}>
                      <text fg={theme().text.muted}>No runs yet.</text>
                    </Show>
                    <For each={runs() ?? []}>
                      {(item) => {
                        const active = () => item.id === selectedRun()
                        const foreground = () => (active() ? theme().text.action.primary.focused : theme().text.base)
                        const secondary = () => (active() ? theme().text.action.primary.focused : theme().text.muted)
                        return (
                          <box
                            ref={(element: Renderable) => runRows.set(item.id, element)}
                            width="100%"
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={active() ? theme().background.action.primary.focused : undefined}
                            onMouseOver={() => setSelectedRun(item.id)}
                            onMouseUp={() => open(item.sessionID, "This run has no session.")}
                          >
                            <text wrapMode="none" truncate minWidth={0} fg={foreground()}>
                              <span style={{ fg: foreground() }}>{active() ? "› " : "  "}</span>
                              <span style={{ fg: active() ? foreground() : runColor(item.status, theme()) }}>
                                {capitalize(item.status)}
                              </span>
                              <span style={{ fg: secondary() }}>{` · ${runTime(item)}`}</span>
                              <Show when={place(item)}>
                                {(value) => <span style={{ fg: secondary() }}>{` · ${value()}`}</span>}
                              </Show>
                            </text>
                            <Show when={item.error}>
                              {(message) => (
                                <text
                                  wrapMode="none"
                                  truncate
                                  minWidth={0}
                                  fg={active() ? foreground() : theme().text.feedback.error.base}
                                >
                                  {`  ${summary(message())}`}
                                </text>
                              )}
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </Show>
              </>
            </scrollbox>
            <Show
              when={flow().reference.type === "managed"}
              fallback={<text fg={theme().text.muted}>{readOnly(flow())}</text>}
            >
              <Show
                when={confirmingDelete()}
                fallback={
                  <box flexDirection="row" flexWrap="wrap" gap={1}>
                    <Show when={props.actions}>
                      {(actions) => (
                        <Action
                          label="Edit"
                          shortcut="e"
                          theme={theme()}
                          disabled={changing()}
                          onTrigger={() => actions().edit(flow())}
                        />
                      )}
                    </Show>
                    <Show when={toggleable(flow())}>
                      <Action
                        label={flow().status === "paused" ? "Enable" : "Disable"}
                        shortcut="space"
                        theme={theme()}
                        disabled={changing()}
                        onTrigger={() => toggle(flow())}
                      />
                    </Show>
                    <Show
                      when={broken(flow())}
                      fallback={
                        <Action
                          label="Run now"
                          shortcut="r"
                          theme={theme()}
                          disabled={changing()}
                          onTrigger={() => runNow(flow())}
                        />
                      }
                    >
                      <Show when={props.actions}>
                        {(actions) => (
                          <Action
                            label="Repair"
                            shortcut="r"
                            theme={theme()}
                            disabled={changing()}
                            onTrigger={() => actions().repair(flow())}
                          />
                        )}
                      </Show>
                    </Show>
                    <Action
                      label="Delete"
                      shortcut="d"
                      theme={theme()}
                      disabled={changing()}
                      onTrigger={() => setConfirmingDelete(true)}
                    />
                    <Show when={flow().latestRun?.sessionID}>
                      <Action
                        label="View session"
                        shortcut="v"
                        theme={theme()}
                        onTrigger={() => open(flow().latestRun?.sessionID, `${flow().name} has not run yet.`)}
                      />
                    </Show>
                  </box>
                }
              >
                <box gap={1}>
                  <box>
                    <text fg={theme().text.feedback.warning.base} wrapMode="none" truncate minWidth={0}>
                      Delete {flow().name}? Future runs stop and retained run records are removed.
                    </text>
                    <Show when={cleanable()}>
                      <text fg={theme().text.muted} wrapMode="none" truncate minWidth={0}>
                        Cleaning removes the run worktrees without changes; sessions are kept.
                      </text>
                    </Show>
                  </box>
                  <box flexDirection="row" flexWrap="wrap" gap={1}>
                    <Action label="Cancel" shortcut="n" theme={theme()} onTrigger={() => setConfirmingDelete(false)} />
                    <Action
                      label="Delete"
                      shortcut="y"
                      theme={theme()}
                      disabled={changing()}
                      onTrigger={() => remove(flow(), false)}
                    />
                    <Show when={cleanable()}>
                      <Action
                        label="Delete and clean worktrees"
                        shortcut="w"
                        theme={theme()}
                        disabled={changing()}
                        onTrigger={() => remove(flow(), true)}
                      />
                    </Show>
                  </box>
                </box>
              </Show>
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
      <text width={12} flexShrink={0} fg={props.theme.text.muted}>
        {props.label}
      </text>
      <text flexGrow={1} wrapMode="word" fg={props.theme.text.base}>
        {props.children}
      </text>
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

function compare(left: KiloFlowRpc.Info, right: KiloFlowRpc.Info) {
  const ordered = (rank[left.status] ?? rank.error) - (rank[right.status] ?? rank.error)
  if (ordered !== 0) return ordered
  if (left.status === "active" && right.status === "active")
    return (left.nextRunAt ?? Number.POSITIVE_INFINITY) - (right.nextRunAt ?? Number.POSITIVE_INFINITY)
  return left.name.localeCompare(right.name)
}

/**
 * The kind of a read-only row, undefined for a managed Flow. Hook rows belong to another schedule owner: the wakeup
 * plugin names its agent tasks `Wakeup: ...` and `Cron: ...`; any other hook row is internal.
 */
function kind(flow: KiloFlowRpc.Info) {
  if (flow.reference.type === "managed") return undefined
  if (flow.reference.action !== "hook") return "schedule"
  if (flow.name.startsWith("Wakeup") || flow.name.startsWith("Cron")) return "agent task"
  return "internal"
}

function readOnly(flow: KiloFlowRpc.Info) {
  const value = kind(flow)
  if (value === "agent task") return "Agent tasks are read-only."
  if (value === "internal") return "Internal schedules are read-only."
  return "Unmanaged schedules are read-only."
}

function broken(flow: KiloFlowRpc.Info | undefined) {
  return flow?.reference.type === "managed" && flow.health.status === "error"
}

function toggleable(flow: KiloFlowRpc.Info | undefined) {
  return flow?.reference.type === "managed" && (flow.status === "active" || flow.status === "paused")
}

function ends(flow: KiloFlowRpc.Info) {
  const parts = [
    flow.ends ? endsLabel(flow.ends) : undefined,
    flow.endsAt === undefined ? undefined : `ends ${date(flow.endsAt)}`,
    flow.remainingRuns === undefined
      ? undefined
      : `${flow.remainingRuns} run${flow.remainingRuns === 1 ? "" : "s"} left`,
  ].filter((part): part is string => part !== undefined)
  if (parts.length === 0) return undefined
  return capitalize(parts.join(" · "))
}

function date(value: number) {
  return new Date(value).toLocaleString()
}

function runTime(run: KiloFlowRpc.Run) {
  const start = run.time.started ?? run.time.created
  const completed = run.time.completed
  if (completed === undefined || run.status === "skipped") return date(start)
  const sameDay = new Date(start).toDateString() === new Date(completed).toDateString()
  return `${date(start)} → ${sameDay ? new Date(completed).toLocaleTimeString() : date(completed)}`
}

function place(run: KiloFlowRpc.Run) {
  if (run.status === "skipped") return undefined
  const directory = run.directory ?? run.worktreeDirectory
  if (run.worktree === "new") return directory ? `worktree ${directory}` : "new worktree"
  return directory
}

function statusColor(value: KiloFlowRpc.Status, theme: Plugin.Context["theme"]) {
  if (value === "error") return theme.text.feedback.error.base
  if (value === "paused") return theme.text.feedback.warning.base
  if (value === "completed") return theme.text.feedback.success.base
  return theme.text.feedback.info.base
}

function runColor(value: KiloFlowRpc.RunStatus, theme: Plugin.Context["theme"]) {
  if (value === "failed" || value === "interrupted") return theme.text.feedback.error.base
  if (value === "succeeded") return theme.text.feedback.success.base
  if (value === "skipped") return theme.text.muted
  return theme.text.feedback.info.base
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

export default Plugin.define({
  id: "kilocode.periodic",
  setup(context) {
    let owner: object | undefined
    const open: Open = (initial) => {
      const current = {}
      owner = current
      context.ui.dialog.show(
        () => <FlowsDialog context={context} initial={initial} actions={actions} />,
        () => {
          if (owner === current) owner = undefined
        },
      )
      context.ui.dialog.set({ size: "large" })
    }
    const fail = (cause: unknown) => context.ui.toast.show({ variant: "error", message: errorMessage(cause) })
    const actions: Actions = {
      create: (selected) => void createFlow(context, open, { key: selected }).catch(fail),
      edit: (flow) => void editFlow(context, open, flow).catch(fail),
      repair: (flow) => void createFlow(context, open, { key: key(flow), detail: true }, flow).catch(fail),
    }
    const unregister = context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.periodic",
              title: "Periodic flows",
              description: "View and schedule local Flows",
              group: "Kilo",
              palette: true,
              slash: { name: "periodic" },
              run: () => open(),
            },
          ],
        }))
        return null
      },
    })
    return () => {
      unregister()
      if (owner) context.ui.dialog.clear()
    }
  },
})
