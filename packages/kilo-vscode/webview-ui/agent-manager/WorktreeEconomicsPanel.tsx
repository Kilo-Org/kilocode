import { Index, Show, createMemo, createSignal, type Accessor, type Component, type ParentProps } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type {
  KilocodeWorktreeUsageDetail,
  KilocodeWorktreeUsageTimeline,
  KilocodeWorktreeUsageTimelineEvent,
} from "@kilocode/sdk/v2/client"
import type { WorktreeState } from "../src/types/messages"
import { useVSCode } from "../src/context/vscode"
import { infoAlign, infoSide } from "./info-side"
import { modelLabel, modelUrl } from "./model-url"

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return whole.format(value)
}

function duration(ms?: number) {
  if (!ms) return "0m"
  const min = Math.max(1, Math.round(ms / 60_000))
  const hr = Math.floor(min / 60)
  const rest = min % 60
  return hr ? `${hr}h ${rest}m` : `${min}m`
}

function tokens(detail: KilocodeWorktreeUsageDetail) {
  const total = detail.worktree.totals.tokens
  return total.input + total.output + total.reasoning + total.cache.read + total.cache.write
}

function eventLabel(event: KilocodeWorktreeUsageTimelineEvent) {
  if (event.kind === "generation") return `${event.agent ?? "agent"} · ${event.modelID ?? "model"}`
  if (event.kind === "subagent") return `${event.agentType ?? "subagent"} · ${event.status}`
  if (event.kind === "communication") return `${event.channel} · ${event.action}`
  return `${event.tool} · ${event.status}`
}

function eventCost(event: KilocodeWorktreeUsageTimelineEvent) {
  return event.kind === "generation" ? money.format(event.cost) : undefined
}

function eventIcon(event: KilocodeWorktreeUsageTimelineEvent) {
  if (event.kind === "generation") return "providers"
  if (event.kind === "subagent") return "task"
  if (event.kind === "communication") return "link"
  return "console"
}

function eventTime(event: KilocodeWorktreeUsageTimelineEvent) {
  return event.time?.start
}

function eventExplanation(event: KilocodeWorktreeUsageTimelineEvent) {
  if (event.kind === "generation")
    return `A completed model generation by ${event.agent ?? "an agent"} using ${event.providerID ?? "the routed provider"}/${event.modelID ?? "the routed model"}. Its retained provider cost is ${money.format(event.cost)} and is included in worktree totals.`
  if (event.kind === "subagent")
    return `A Task delegation from session ${event.parentSessionID} to child session ${event.childSessionID}. The child session's model cost is reported separately in Sessions and Subagents, so this event itself has no model price.`
  if (event.kind === "communication")
    return `A ${event.channel} ${event.action} communication event. Communication tools do not call a paid model directly, so the direct price is zero; model work triggered afterward appears as separate generation events.`
  return `A ${event.tool} tool call with status ${event.status}. Tool intervals contribute to active time when both start and end timestamps are retained, but the tool itself has no direct model price.`
}

// Deliberately not the shared `Tooltip`: that component portals its content
// away from the trigger and closes as soon as the pointer leaves the trigger,
// which produced a hover/close race when moving onto the tooltip text itself.
// Rendering the popover as a plain in-DOM sibling means the browser's native
// `:hover` state on `.am-economics-info-wrap` stays true continuously while
// the pointer is over the icon *or* the popover, with no JS timers involved.
const Info: Component<{ title: string; text: string }> = (props) => {
  const [side, setSide] = createSignal<"top" | "bottom">("top")
  const [align, setAlign] = createSignal<"start" | "end">("end")
  const [room, setRoom] = createSignal<number>()
  let wrap: HTMLSpanElement | undefined

  // Opening/closing stays pure CSS `:hover`; this only keeps the popover inside
  // the scrolling panel, because a plain in-DOM popover gets no flipping or
  // shifting from floating-ui. The popover keeps its layout box while hidden, so
  // it can be measured here. The width cap is applied first — Solid writes it
  // synchronously — so the height and width read after it are the final ones.
  const place = () => {
    if (!wrap) return
    const pop = wrap.querySelector<HTMLElement>(".am-economics-info-popover")
    if (!pop) return
    const area = wrap.closest(".am-economics-scroll")?.getBoundingClientRect()
    const avail = area ? Math.round(area.width - 16) : 0
    setRoom(avail > 0 && avail < pop.offsetWidth ? avail : undefined)
    const box = wrap.getBoundingClientRect()
    setSide(infoSide(box.top, pop.offsetHeight, area?.top ?? 0))
    setAlign(infoAlign(box.right, pop.offsetWidth, area?.left ?? 0))
  }

  return (
    <span
      class="am-economics-info-wrap"
      data-side={side()}
      data-align={align()}
      ref={wrap}
      onPointerEnter={place}
      onFocusIn={place}
    >
      <IconButton
        icon="information"
        variant="ghost"
        size="small"
        class="am-economics-info"
        aria-label={`About ${props.title}`}
      />
      <div
        class="am-economics-tooltip am-economics-info-popover"
        role="tooltip"
        style={room() ? { "max-width": `${room()}px` } : undefined}
      >
        <div class="am-economics-tooltip-body">
          <strong>{props.title}</strong>
          <span>{props.text}</span>
        </div>
      </div>
    </span>
  )
}

// Every explained element gets its own badge, and only the badge opens the
// popover — hovering the metric itself just reveals the badge. `inline` places
// the badge directly after short content (titles, chips, table cells); the
// default overlays it in the top-right corner of a card or row.
const Explain: Component<ParentProps<{ title: string; text: string; inline?: boolean }>> = (props) => (
  <Show
    when={props.inline}
    fallback={
      <div class="am-economics-explain">
        {props.children}
        <Info title={props.title} text={props.text} />
      </div>
    }
  >
    <span class="am-economics-explain am-economics-explain-inline">
      {props.children}
      <Info title={props.title} text={props.text} />
    </span>
  </Show>
)

interface Props {
  detail?: KilocodeWorktreeUsageDetail
  timeline?: KilocodeWorktreeUsageTimeline
  loading: boolean
  error?: string
  label: string
  onClose: () => void
  onRefresh: () => void
  onOpenSession: (id: string) => void
}

export const WorktreeEconomicsPanel: Component<Props> = (props) => {
  const vscode = useVSCode()
  const maxModel = createMemo(() => Math.max(0, ...((props.detail?.models ?? []).map((model) => model.cost) ?? [])))
  const maxAgent = createMemo(() => Math.max(0, ...((props.detail?.agents ?? []).map((agent) => agent.cost) ?? [])))
  const events = createMemo(() => props.timeline?.events.slice(0, 10) ?? [])
  const sessions = createMemo(() => [...(props.detail?.sessions ?? [])].sort((a, b) => b.subtree.cost - a.subtree.cost))
  const costPerHour = createMemo(() => {
    const detail = props.detail
    if (!detail?.worktree.time.activeMs) return undefined
    return detail.worktree.totals.cost / (detail.worktree.time.activeMs / 3_600_000)
  })

  return (
    <aside class="am-economics-panel" aria-label="Worktree economics">
      <div class="am-economics-header">
        <div>
          <div class="am-economics-eyebrow">Worktree economics</div>
          <div class="am-economics-title">{props.label}</div>
        </div>
        <div class="am-economics-actions">
          <Tooltip
            value="Reload retained usage, timing, session, communication, and timeline data from the CLI backend."
            contentClass="am-economics-tooltip"
            placement="bottom"
          >
            <IconButton
              icon="refresh"
              size="small"
              variant="ghost"
              aria-label="Refresh economics"
              onClick={props.onRefresh}
            />
          </Tooltip>
          <Tooltip
            value="Close the economics dashboard and return to the session view."
            contentClass="am-economics-tooltip"
            placement="bottom"
          >
            <IconButton icon="x" size="small" variant="ghost" aria-label="Close economics" onClick={props.onClose} />
          </Tooltip>
        </div>
      </div>

      <Show when={props.loading && !props.detail}>
        <div class="am-economics-state">
          <Icon name="refresh" size="small" />
          Loading worktree economics...
        </div>
      </Show>
      <Show when={props.error}>
        <div class="am-economics-state am-economics-error">
          <Icon name="warning" size="small" />
          {props.error}
        </div>
      </Show>

      <Show when={props.detail}>
        {(detail) => (
          <div class="am-economics-scroll">
            <section class="am-economics-hero">
              <Explain
                title="Total retained cost"
                text="The sum of model-generation costs still present in this worktree's retained session history. Deleted or reverted transcript steps are not recoverable, and tool or communication events have no direct provider charge."
              >
                <div class="am-economics-card am-economics-cost-card">
                  <span>Total retained cost</span>
                  <strong>{money.format(detail().worktree.totals.cost)}</strong>
                </div>
              </Explain>
              <Explain
                title="Tokens"
                text={`All retained input, output, reasoning, cache-read, and cache-write tokens across this worktree. The headline ${compact(tokens(detail()))} includes cached tokens; ${compact(detail().worktree.totals.tokens.output)} were generated output tokens.`}
              >
                <div class="am-economics-card">
                  <span>Tokens</span>
                  <strong>{compact(tokens(detail()))}</strong>
                  <small>{compact(detail().worktree.totals.tokens.output)} output</small>
                </div>
              </Explain>
              <Explain
                title="Active time vs wall time"
                text="Active time is the union of retained model-generation and tool intervals, so parallel agents are not double-counted. Wall time runs from the first retained activity to the last and can include idle time, waiting, user review, and gaps between sessions."
              >
                <div class="am-economics-card">
                  <span>Active time</span>
                  <strong>{duration(detail().worktree.time.activeMs)}</strong>
                  <small>{duration(detail().worktree.time.wallMs)} wall</small>
                </div>
              </Explain>
              <Explain
                title="Sessions and subagents"
                text="Root sessions are independent top-level conversations owned by this worktree. Subagents are descendant sessions created through Task delegation; their work is included in the owning root session's subtree totals."
              >
                <div class="am-economics-card">
                  <span>Sessions</span>
                  <strong>{detail().worktree.rootSessions}</strong>
                  <small>{detail().worktree.subagents} subagents</small>
                </div>
              </Explain>
              <Explain
                title="Cost per active hour"
                text="Total retained cost divided by union active time. This is an efficiency ratio for comparing worktrees, not a provider billing rate; short tasks can produce a high hourly figure even when total spend is low."
              >
                <div class="am-economics-card">
                  <span>Cost rate</span>
                  <strong>{costPerHour() === undefined ? "—" : `${money.format(costPerHour()!)}/h`}</strong>
                  <small>active time</small>
                </div>
              </Explain>
            </section>

            <section class="am-economics-section">
              <Explain
                title="Cost by model"
                text="Groups retained generation steps by the actual routed provider, model, and optional model variant. Costs are provider/model-generation costs; bar lengths are relative to the most expensive model group in this worktree, not a quality or benchmark score."
                inline
              >
                <div class="am-economics-section-title">Cost by model</div>
              </Explain>
              <div class="am-economics-panel-block">
                <Index each={detail().models.slice(0, 6)}>
                  {(model) => (
                    <Explain
                      title={`${modelLabel(model().providerID, model().modelID)} usage`}
                      text={`${model().steps} completed model-generation steps retained for this ${model().variant ? `${model().variant} variant` : "model group"}, costing ${money.format(model().cost)}. A step is one completed provider generation; tool calls and communication events are separate. Click the model name to open its Kilo model page.`}
                    >
                      <div class="am-economics-bar-row">
                        <div class="am-economics-bar-label">
                          <a
                            class="am-economics-model-link"
                            href={modelUrl(model().providerID, model().modelID)}
                            onClick={(event) => {
                              event.preventDefault()
                              vscode.postMessage({
                                type: "openExternal",
                                url: modelUrl(model().providerID, model().modelID),
                              })
                            }}
                          >
                            {modelLabel(model().providerID, model().modelID)}
                          </a>
                          <small>{model().variant ?? `${model().steps} steps`}</small>
                        </div>
                        <div class="am-economics-bar-track">
                          <div
                            class="am-economics-bar-fill"
                            style={{ width: `${maxModel() ? (model().cost / maxModel()) * 100 : 0}%` }}
                          />
                        </div>
                        <strong>{money.format(model().cost)}</strong>
                      </div>
                    </Explain>
                  )}
                </Index>
              </div>
            </section>

            <section class="am-economics-section">
              <Explain
                title="Agent efficiency"
                text="Groups retained model-generation cost by the assistant agent name recorded on each generation. This is cost allocation, not a success-rate or quality score; it helps compare which agent roles consumed model spend and how many generation steps they needed."
                inline
              >
                <div class="am-economics-section-title">Agent efficiency</div>
              </Explain>
              <div class="am-economics-panel-block">
                <Index each={detail().agents.slice(0, 6)}>
                  {(agent) => (
                    <Explain
                      title={`${agent().agent} agent usage`}
                      text={`${agent().steps} completed model-generation steps were attributed directly to the ${agent().agent} agent, costing ${money.format(agent().cost)}. Child-session work is attributed according to the agent name recorded in those child generations.`}
                    >
                      <div class="am-economics-bar-row">
                        <div class="am-economics-bar-label">
                          <span>{agent().agent}</span>
                          <small>{agent().steps} model steps</small>
                        </div>
                        <div class="am-economics-bar-track">
                          <div
                            class="am-economics-bar-fill am-economics-bar-fill-agent"
                            style={{ width: `${maxAgent() ? (agent().cost / maxAgent()) * 100 : 0}%` }}
                          />
                        </div>
                        <strong>{money.format(agent().cost)}</strong>
                      </div>
                    </Explain>
                  )}
                </Index>
              </div>
            </section>

            <section class="am-economics-section">
              <Explain
                title="Sessions and subagents"
                text="Lists every retained session owned by this worktree. Direct cost is generated by that session itself; subtree cost also includes all descendant subagent sessions. The time shown is that session's retained active model/tool time. Click a row to open the session."
                inline
              >
                <div class="am-economics-section-title">Sessions and subagents</div>
              </Explain>
              <div class="am-economics-panel-block">
                <Index each={sessions()}>
                  {(session) => (
                    <Explain
                      title={session().title || session().id}
                      text={`Direct cost ${money.format(session().direct.cost)} comes from this session's own model generations. Subtree cost ${money.format(session().subtree.cost)} includes descendant subagents. ${duration(session().time.activeMs)} is this session's retained active model/tool time. Click to open it.`}
                    >
                      <button class="am-economics-session" onClick={() => props.onOpenSession(session().id)}>
                        <div>
                          <span>{session().title || session().id}</span>
                          <small>
                            {session().agent ?? "agent"} · direct {money.format(session().direct.cost)}
                          </small>
                        </div>
                        <div class="am-economics-session-cost">
                          <strong>{money.format(session().subtree.cost)}</strong>
                          <small>{duration(session().time.activeMs)}</small>
                        </div>
                      </button>
                    </Explain>
                  )}
                </Index>
              </div>
            </section>

            <section class="am-economics-section">
              <Explain
                title="Communication"
                text="Counts retained board and Agent Manager coordination events. These tools have zero direct provider cost. If communication triggers another agent to perform model work, that cost appears in the resulting session and generation events instead."
                inline
              >
                <div class="am-economics-section-title">Communication</div>
              </Explain>
              <div class="am-economics-panel-block">
                <div class="am-economics-chip-row">
                  <Explain
                    title="Board posts"
                    text="Messages posted to the durable swarm board by sessions in this worktree. Posting is a local coordination tool action and has no direct model charge."
                    inline
                  >
                    <span>{detail().worktree.communication.boardPosts} board posts</span>
                  </Explain>
                  <Explain
                    title="Board reads"
                    text="Board-read tool calls made by sessions in this worktree. A later model generation may use the retrieved context, but the read action itself has no direct model charge."
                    inline
                  >
                    <span>{detail().worktree.communication.boardReads} reads</span>
                  </Explain>
                  <Explain
                    title="Agent Manager prompts"
                    text="Peer prompts sent from one Agent Manager session to another. The prompt action costs zero directly; the target session's resulting generations are priced separately."
                    inline
                  >
                    <span>{detail().worktree.communication.agentManagerPrompts} prompts</span>
                  </Explain>
                  <Explain
                    title="Agent Manager replies"
                    text="Correlated peer replies sent through Agent Manager. This counts communication activity only, not the model cost of composing or acting on the reply."
                    inline
                  >
                    <span>{detail().worktree.communication.agentManagerReplies} replies</span>
                  </Explain>
                  <Explain
                    title="Direct communication cost"
                    text="Board and Agent Manager communication tools do not directly invoke a paid model, so their direct cost is zero. Communication-triggered generations remain visible elsewhere in this dashboard."
                    inline
                  >
                    <span>{money.format(detail().worktree.communication.directCost)} direct</span>
                  </Explain>
                </div>
              </div>
            </section>

            <section class="am-economics-section">
              <Explain
                title="Recent activity"
                text="The newest retained generation, tool, subagent, and communication events in this worktree. Generation rows show their direct model price; tools and coordination rows show no price because they do not directly invoke a paid model."
                inline
              >
                <div class="am-economics-section-title">Recent activity</div>
              </Explain>
              <div class="am-economics-panel-block am-economics-panel-block-table">
                <table class="am-economics-table">
                  <thead>
                    <tr>
                      <th>
                        <Explain
                          title="Event time"
                          text="The retained start timestamp of the event, shown in your local time zone. Open or legacy events can lack a complete end timestamp."
                          inline
                        >
                          <span>Time</span>
                        </Explain>
                      </th>
                      <th>
                        <Explain
                          title="Operation"
                          text="The recorded activity type: a model generation, tool call, Task subagent delegation, or Board/Agent Manager communication event."
                          inline
                        >
                          <span>Operation</span>
                        </Explain>
                      </th>
                      <th>
                        <Explain
                          title="Direct event price"
                          text="Provider/model cost recorded for a completed generation step. A dash means the event itself has no direct model price; related model work appears as separate generation rows."
                          inline
                        >
                          <span>Price</span>
                        </Explain>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <Index each={events()}>
                      {(event) => (
                        <tr>
                          <td>
                            <Explain
                              title="Event start time"
                              text="When this retained event started, displayed in your local time zone. This is not the total task completion time."
                              inline
                            >
                              <span>
                                {eventTime(event())
                                  ? new Date(eventTime(event())!).toLocaleTimeString([], {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    })
                                  : "—"}
                              </span>
                            </Explain>
                          </td>
                          <td>
                            <Explain title={eventLabel(event())} text={eventExplanation(event())} inline>
                              <span class="am-economics-operation">
                                <Icon name={eventIcon(event())} size="small" />
                                {eventLabel(event())}
                              </span>
                            </Explain>
                          </td>
                          <td>
                            <Explain
                              title={eventCost(event()) ? "Direct model price" : "No direct model price"}
                              text={
                                eventCost(event())
                                  ? "The provider/model cost recorded for this completed generation step. It contributes to retained worktree, model, agent, and session totals."
                                  : "This tool, subagent-delegation, or communication event did not directly invoke a paid model. Any resulting generations are priced on their own rows."
                              }
                              inline
                            >
                              <span>
                                <Show when={eventCost(event())} fallback="—">
                                  {(cost) => <strong class="am-economics-event-cost">{cost()}</strong>}
                                </Show>
                              </span>
                            </Explain>
                          </td>
                        </tr>
                      )}
                    </Index>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </Show>
    </aside>
  )
}

export const WorktreeEconomicsHost: Component<{
  active: () => boolean
  worktree: Accessor<WorktreeState | undefined>
  usage: Accessor<(Pick<Props, "detail" | "timeline" | "error"> & { loading?: boolean }) | undefined>
  label: (wt: WorktreeState) => string
  onClose: () => void
  onRefresh: (id: string) => void
  onOpenSession: (id: string) => void
}> = (props) => (
  <Show when={props.active() && props.worktree()}>
    {(wt) => (
      <WorktreeEconomicsPanel
        detail={props.usage()?.detail}
        timeline={props.usage()?.timeline}
        loading={props.usage()?.loading === true}
        error={props.usage()?.error}
        label={props.label(wt())}
        onClose={props.onClose}
        onRefresh={() => props.onRefresh(wt().id)}
        onOpenSession={props.onOpenSession}
      />
    )}
  </Show>
)
