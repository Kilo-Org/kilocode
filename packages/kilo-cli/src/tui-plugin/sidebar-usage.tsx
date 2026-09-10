import { createClient } from "@kilocode/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { Session } from "@opencode-ai/schema/session"
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  For,
  Match,
  Show,
  Switch,
  type Accessor,
} from "solid-js"
import { SessionUsageRpc, type SessionUsage } from "../session-usage-rpc"
import { SidebarSection } from "./sidebar-section"

export type UsageSidebarOptions = {
  readonly client?: Pick<ReturnType<typeof createClient>, "rpc">
  readonly privacy: Accessor<boolean>
  readonly signal?: AbortSignal
}

type UsageRpc = ReturnType<NonNullable<UsageSidebarOptions["client"]>["rpc"]>
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly usage: SessionUsage }

/** Appends durable root-and-descendant usage without making a model request. */
export function installUsageSidebar(ctx: Plugin.Context, options: UsageSidebarOptions) {
  const rpc = options.client?.rpc(SessionUsageRpc)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => <UsageSidebar context={ctx} sessionID={props.sessionID} rpc={rpc} {...options} />,
  })
}

export function UsageSidebar(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly rpc?: UsageRpc
  readonly privacy: Accessor<boolean>
  readonly signal?: AbortSignal
}) {
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const location = createMemo(() => session()?.location)
  const [state, setState] = createSignal<State>({ kind: "loading" })
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  let sequence = 0
  let controller: AbortController | undefined

  const refresh = async () => {
    controller?.abort()
    const ref = location()
    const current = ++sequence
    if (!props.rpc || !ref) {
      setState({ kind: "unavailable" })
      return
    }
    controller = new AbortController()
    const signal = props.signal ? AbortSignal.any([controller.signal, props.signal]) : controller.signal
    setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }))
    try {
      const usage = await props.rpc.get({ sessionID: Session.ID.make(props.sessionID) }, { location: ref, signal })
      if (current !== sequence || signal.aborted) return
      setState({ kind: "ready", usage })
    } catch {
      if (current !== sequence || signal.aborted) return
      setState({ kind: "unavailable" })
    }
  }

  createEffect(
    on(
      () => `${props.sessionID}\u0000${location()?.directory ?? ""}\u0000${location()?.workspaceID ?? ""}`,
      () => {
        setState({ kind: "loading" })
        setExpanded(new Set<string>())
        void refresh()
      },
    ),
  )

  const usage = createMemo(() => {
    const current = state()
    return current.kind === "ready" ? current.usage : undefined
  })
  const related = (sessionID: string) => {
    if (sessionID === props.sessionID) return true
    if (usage()?.sessionIDs.includes(Session.ID.make(sessionID))) return true
    return props.context.data.session.family(Session.ID.make(props.sessionID)).includes(sessionID)
  }
  const refreshTerminal = (event: { readonly data: { readonly sessionID: string } }) => {
    if (related(event.data.sessionID)) void refresh()
  }
  const stop = [
    props.context.data.on("session.execution.succeeded", refreshTerminal),
    props.context.data.on("session.execution.failed", refreshTerminal),
    props.context.data.on("session.execution.interrupted", refreshTerminal),
    props.context.data.on("session.deleted", refreshTerminal),
    props.context.data.on("session.moved", refreshTerminal),
    props.context.data.on("session.revert.committed", refreshTerminal),
    props.context.data.on("session.created", (event) => {
      if (related(event.data.sessionID) || (event.data.parentID !== undefined && related(event.data.parentID)))
        void refresh()
    }),
    props.context.data.on("server.connected", () => void refresh()),
  ]
  onCleanup(() => {
    sequence++
    controller?.abort()
    stop.forEach((unsubscribe) => unsubscribe())
  })

  const masked = createMemo(() => props.privacy())
  const tone = props.context.theme.text
  return (
    <SidebarSection theme={props.context.theme} title="Session family usage">
      <Switch>
        <Match when={state().kind === "loading"}>
          <text fg={tone.subdued}>Loading</text>
        </Match>
        <Match when={state().kind === "unavailable"}>
          <text fg={tone.feedback.warning.default}>Unavailable</text>
        </Match>
        <Match when={usage()}>
          <Show when={usage()}>
            {(value) => (
              <>
                <UsageRow label="Input" value={count(value().totals.tokens.input)} />
                <UsageRow label="Output" value={count(value().totals.tokens.output)} />
                <UsageRow label="Reasoning" value={count(value().totals.tokens.reasoning)} />
                <UsageRow label="Cache read" value={count(value().totals.tokens.cache.read)} />
                <UsageRow label="Cache write" value={count(value().totals.tokens.cache.write)} />
                <UsageRow label="Cache rate" value={rate(value().totals.tokens)} />
                <UsageRow label="Cost" value={masked() ? "•••" : cost(value().totals.cost)} />
                <Show when={value().models.length > 0}>
                  <text fg={tone.subdued}>Models</text>
                  <For each={value().models}>
                    {(model) => {
                      const key = `${model.providerID}\u0000${model.modelID}`
                      const open = () => expanded().has(key)
                      const toggle = () =>
                        setExpanded((current) => {
                          const next = new Set(current)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      return (
                        <box>
                          <box flexDirection="row" justifyContent="space-between" gap={1} onMouseDown={toggle}>
                            <text fg={tone.subdued} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                              {`${open() ? "▼" : "▶"} ${masked() ? "•••" : `${model.providerID}/${model.modelID}`}`}
                            </text>
                            <text fg={tone.subdued} wrapMode="none" flexShrink={0}>{`${count(model.steps)} steps · ${
                              masked() ? "•••" : cost(model.cost)
                            }`}</text>
                          </box>
                          <Show when={open()}>
                            <box paddingLeft={2}>
                              <UsageRow label="Input" value={count(model.tokens.input)} />
                              <UsageRow label="Output" value={count(model.tokens.output)} />
                              <UsageRow label="Reasoning" value={count(model.tokens.reasoning)} />
                              <UsageRow label="Cache read" value={count(model.tokens.cache.read)} />
                              <UsageRow label="Cache write" value={count(model.tokens.cache.write)} />
                              <UsageRow label="Cache rate" value={rate(model.tokens)} />
                            </box>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </SidebarSection>
  )
}

function UsageRow(props: { readonly label: string; readonly value: string }) {
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text>{props.label}</text>
      <text>{props.value}</text>
    </box>
  )
}

function count(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

function cost(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
}

function rate(tokens: SessionUsage["totals"]["tokens"]) {
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total === 0) return "-"
  return `${((tokens.cache.read / total) * 100).toFixed(1)}%`
}
