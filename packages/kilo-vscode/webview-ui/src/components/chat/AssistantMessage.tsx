/**
 * AssistantMessage component
 * Renders all parts of an assistant message as a flat list — no context grouping.
 * Unlike the upstream AssistantParts, this renders each read/glob/grep/list tool
 * individually for maximum verbosity in the VS Code sidebar context.
 *
 * Active questions render inline via QuestionDock; permissions are in the bottom dock.
 */

import { Component, For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  Part,
  PART_MAPPING,
  ToolRegistry,
  ToolApprovalProvider,
  resolveToolApproval,
  useGrowIn,
} from "@kilocode/kilo-ui/message-part"
import type { MessageFeedbackControls } from "@kilocode/kilo-ui/message-part"
import { useToolMotion, useToolSize } from "@kilocode/kilo-ui/tool-motion"
import type {
  AssistantMessage as SDKAssistantMessage,
  Part as SDKPart,
  Message as SDKMessage,
  ToolPart,
} from "@kilocode/sdk/v2"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useSession } from "../../context/session"
import { useDisplay } from "../../context/display"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { planDisplayPath } from "../../utils/plan-path"
import { isRenderable, UPSTREAM_SUPPRESSED_TOOLS } from "../../utils/transcript-parts"
import { messageThroughput, formatTG } from "../../context/session-utils"
import { formatClock, formatDuration } from "../../utils/message-time"
import type { TurnTiming } from "../../context/transcript-rows"
import { color as timelineColor } from "../../utils/timeline/colors"
import type { Part as TimelinePart, QuestionRequest } from "../../types/messages"
import type { TimelineHighlight } from "../../utils/timeline/highlight"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { QuestionDock } from "./QuestionDock"
import { SuggestBar } from "./SuggestBar"
import { toolDefaultOpen } from "./tool-default-open"

/** Extract plan path from a completed plan_exit tool part. */
function planExitInfo(part: SDKPart): { plan: string } | undefined {
  if (part.type !== "tool") return undefined
  const tp = part as unknown as ToolPart
  if (tp.tool !== "plan_exit") return undefined
  if (tp.state?.status !== "completed") return undefined
  const meta = (tp.state as { metadata?: Record<string, unknown> }).metadata ?? {}
  const plan = typeof meta.plan === "string" ? meta.plan : undefined
  if (!plan) return undefined
  return { plan }
}

function PlanExitCard(props: { part: ToolPart; sessionID: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const info = createMemo(() => planExitInfo(props.part as unknown as SDKPart))
  const display = createMemo(() => {
    const i = info()
    if (!i) return ""
    return planDisplayPath(i.plan, server.workspaceDirectory())
  })
  const label = createMemo(() => {
    if (!info()) return ""
    return language.t("plan.exit.ready")
  })
  const open = (e: MouseEvent) => {
    e.preventDefault()
    const i = info()
    if (!i || !data.openFile) return
    data.openFile(i.plan, undefined, undefined, props.sessionID)
  }
  return (
    <Show when={info()}>
      <div data-component="plan-exit-card">
        <span data-slot="plan-exit-label">{label()}</span>{" "}
        <span data-slot="plan-exit-badge">{language.t("ui.patch.action.plan")}</span>
        <a data-slot="plan-exit-link" href="#" onClick={open}>
          {display()}
        </a>
      </div>
    </Show>
  )
}

/**
 * Match a tool part to an active request (question or suggestion) by tool name
 * and callID/messageID. Returns the matched request or undefined.
 */
function matchToolRequest<T extends { tool?: { callID: string; messageID: string } }>(
  part: SDKPart,
  name: string,
  requests: T[],
): T | undefined {
  if (part.type !== "tool") return undefined
  const tp = part as unknown as ToolPart
  if (tp.tool !== name) return undefined
  return requests.find((r) => r.tool?.callID === tp.callID && r.tool?.messageID === tp.messageID)
}

/** A question tool part still executes until the backend returns its result. */
function questionBusy(part: SDKPart): boolean {
  if (part.type !== "tool") return false
  const status = (part as unknown as ToolPart).state?.status
  return status === "pending" || status === "running"
}

const still = {
  enter: () => undefined,
  live: () => undefined,
  status: () => undefined,
  stagger: () => undefined,
  end: () => {},
}

/**
 * Tool rows the user watches happen enter, reveal their details, and resize
 * smoothly. Rows from history or a session switch stay still. Returns the
 * wrapper attributes that tool-motion.css reads.
 */
function useRowMotion(props: {
  part: SDKPart
  done: () => boolean
  el: () => HTMLElement | undefined
  body: () => HTMLElement | undefined
}) {
  if (props.part.type !== "tool") return still
  const tool = props.part as unknown as ToolPart
  const motion = useToolMotion({ id: tool.id, status: () => tool.state?.status })
  useToolSize({ el: props.el, body: props.body, active: () => motion.live() && !props.done(), motion })
  return {
    enter: () => (motion.entering() ? "" : undefined),
    live: () => (motion.live() ? "" : undefined),
    status: () => tool.state?.status,
    stagger: () => (motion.stagger() ? String(motion.stagger()) : undefined),
    end: (event: AnimationEvent) => {
      if (event.target !== event.currentTarget || event.animationName !== "tool-motion-enter") return
      motion.entered()
    },
  }
}

interface AssistantMessageProps {
  message: SDKAssistantMessage
  parts?: SDKPart[]
  showAssistantCopyPartID?: string | null
  /** Finish time and duration for the turn, shown inline in the assistant
   * action row once the turn settles. */
  timing?: TurnTiming
  feedback?: MessageFeedbackControls
  /** Part behind the currently hovered/focused task-timeline bar, if any. */
  highlight?: () => TimelineHighlight | undefined
  readonly?: boolean
  interactivePrompts?: boolean
}

type ToolStateProps = {
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
  status?: string
}

function TodoToolCard(props: { part: ToolPart }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  const language = useLanguage()
  return (
    <Show when={render}>
      {(renderFn) => (
        <ToolApprovalProvider value={() => resolveToolApproval(state()?.metadata, language.t)}>
          <Dynamic
            component={renderFn()}
            input={state()?.input ?? {}}
            metadata={state()?.metadata ?? {}}
            tool={props.part.tool}
            partID={props.part.id}
            callID={props.part.callID}
            output={state()?.output}
            status={state()?.status}
            defaultOpen
          />
        </ToolApprovalProvider>
      )}
    </Show>
  )
}

function BashToolCard(props: { part: ToolPart; defaultOpen: boolean }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  const language = useLanguage()
  return (
    <Show when={render}>
      {(card) => (
        <ToolApprovalProvider value={() => resolveToolApproval(state()?.metadata, language.t)}>
          <Dynamic
            component={card() as unknown as Component<Record<string, unknown>>}
            input={state()?.input ?? {}}
            metadata={state()?.metadata ?? {}}
            partMetadata={props.part.metadata ?? {}}
            tool={props.part.tool}
            partID={props.part.id}
            callID={props.part.callID}
            output={state()?.output}
            status={state()?.status}
            defaultOpen={props.defaultOpen}
            animate
          />
        </ToolApprovalProvider>
      )}
    </Show>
  )
}

/** Plain-text generation-speed value shown beside the copy/feedback buttons
 * on an assistant message.
 *
 * Renders as muted metadata — no icon, no background, no border — so it
 * reads as tertiary info rather than an interactive control. The
 * description on hover explains that the value is a weighted generation
 * rate across the turn's model-generation steps (output + reasoning
 * tokens over active generation time).
 *
 * Visibility is gated by the same `kilo-code.new.showTokenThroughput`
 * toggle that previously controlled the multi-row badge. The metric only
 * renders when the message has at least one step-finish part carrying both
 * a token count and elapsed timing.
 */
function ThroughputBadge(props: { metrics: { generation?: number } }) {
  const language = useLanguage()
  const speedText = createMemo(() => formatTG(props.metrics.generation, language.locale()))
  const tooltip = createMemo(() => {
    if (props.metrics.generation === undefined) {
      return language.t("chat.throughput.tooltip.missing")
    }
    return language.t("chat.throughput.tooltip", { speed: speedText() })
  })
  return (
    <Tooltip value={tooltip()} placement="top">
      <span data-component="assistant-throughput">{speedText()}</span>
    </Tooltip>
  )
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()
  const display = useDisplay()
  const language = useLanguage()
  const { config } = useConfig()
  const open = createMemo(() => config().terminal_command_display !== "collapsed")
  const edit = createMemo(() => config().code_edit_display === "expanded")
  const mcp = createMemo(() => config().mcp_tool_display === "expanded")

  // Throughput toggle lives on the shared DisplayProvider so every
  // AssistantMessage renders against the same signal without posting its
  // own requestThroughputSetting round-trip on mount.
  const throughputVisible = createMemo(() => display.throughputVisible())

  const parts = createMemo(() => {
    const stored = props.parts ?? data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter((part) => isRenderable(part, props.message))
  })
  // Pull the weighted generation rate across the turn's step-finish parts
  // (output + reasoning tokens over active generation duration) so the badge
  // represents the turn as a whole rather than whichever step happened to
  // finish most recently. We intentionally read from the full message parts
  // in the data store rather than `props.parts` — the parent chunks
  // messages into rows of ~8 parts, and step-finish may land in a row
  // different from the one currently rendered.
  const throughput = createMemo(() =>
    messageThroughput(
      (data.store.part?.[props.message.id] as TimelinePart[] | undefined) ??
        (props.parts as TimelinePart[] | undefined) ??
        ([] as TimelinePart[]),
    ),
  )
  return (
    <>
      <For each={parts()}>
        {(part) => {
          // Upstream PART_MAPPING["tool"] returns null for todowrite/todoread,
          // so we detect them here and render via ToolRegistry directly.
          const isUpstreamSuppressed =
            part.type === "tool" && UPSTREAM_SUPPRESSED_TOOLS.has((part as SDKPart & { tool: string }).tool)

          // Active question tool parts render the interactive QuestionDock inline.
          // The backend publishes question.replied before the tool part completes,
          // so the request is gone a beat before the answered card can render.
          // Hold the last matched request while the part is still busy so the dock
          // stays mounted instead of vanishing to an empty row and snapping back.
          const liveQuestion = createMemo(() => matchToolRequest(part, "question", session.questions()))
          const [heldQuestion, setHeldQuestion] = createSignal<QuestionRequest>()
          createEffect(() => {
            const request = liveQuestion()
            if (request) {
              setHeldQuestion(request)
              return
            }
            if (!questionBusy(part)) setHeldQuestion(undefined)
          })
          const activeQuestion = createMemo(() => {
            if (props.interactivePrompts === false) return undefined
            return liveQuestion() ?? (questionBusy(part) ? heldQuestion() : undefined)
          })

          // Active suggestion tool parts render the interactive SuggestBar inline
          const activeSuggestion = createMemo(() =>
            props.interactivePrompts === false ? undefined : matchToolRequest(part, "suggest", session.suggestions()),
          )
          const bash = createMemo(() => {
            if (part.type !== "tool") return
            const tool = part as unknown as ToolPart
            if (tool.tool !== "bash") return
            if (tool.state?.status === "error") return
            return part
          })
          const planExit = createMemo(() => {
            if (!planExitInfo(part)) return
            return part as unknown as ToolPart
          })
          // Reasoning blocks are excluded: they animate their own height and
          // their header and body bleed 6px past this wrapper, so the grow-in
          // clip would trim their sides for the whole stream and then release
          // them when the text stops growing, resizing the block at the end.
          // Tool parts are excluded too: worktree and session switches remount
          // them, so the wrapper would replay the reveal on an already-seen tool.
          // Encrypted reasoning items only set time.end on their summaries once
          // the whole item finishes, so a summary the stream already moved past
          // would keep pulsing. Read the full store list: props.parts is a chunk.
          const settled = createMemo(() => {
            if (part.type !== "reasoning") return false
            if (props.message.time.completed) return true
            const all = (data.store.part?.[props.message.id] ?? props.parts ?? []) as SDKPart[]
            const index = all.findIndex((item) => item.id === part.id)
            return index >= 0 && index < all.length - 1
          })
          const live = part.type === "text" && !!part.time && !part.time.end
          let el: HTMLDivElement | undefined
          let body: HTMLDivElement | undefined
          useGrowIn(() => el, live)
          const motion = useRowMotion({
            part,
            done: () => !!props.message.time.completed,
            el: () => el,
            body: () => body,
          })

          // Lights up when this part is behind the hovered/focused task-timeline
          // bar, using that bar's own color so the two stay easy to correlate.
          const highlighted = createMemo(() => {
            const h = props.highlight?.()
            return h?.msgId === props.message.id && h?.partId === part.id
          })

          // Throughput badge renders inside the copy/feedback action row of the
          // text part that carries the copy button (the last text part of the
          // message), pushed to the right of the buttons rather than below the
          // message. Only built for that part so non-text parts skip the work.
          const throughputEl = createMemo<JSX.Element | undefined>(() => {
            if (!throughputVisible()) return undefined
            const metrics = throughput()
            if (!metrics) return undefined
            if (part.id !== props.showAssistantCopyPartID) return undefined
            return <ThroughputBadge metrics={metrics} />
          })

          // Turn finish time and duration render inline in the same action row
          // as the copy/feedback buttons, on the trailing side, so the turn's
          // timing never introduces a second line. Only the copy-carrying part
          // builds it, which keeps it to one row per settled turn.
          const turnMetaEl = createMemo<JSX.Element | undefined>(() => {
            const timing = props.timing
            if (!timing) return undefined
            if (part.id !== props.showAssistantCopyPartID) return undefined
            return (
              <span data-component="message-time">
                {formatClock(timing.completedAt, language.locale())}
                <Show when={timing.durationMs}>
                  {(ms) => <span data-slot="message-time-duration"> · {formatDuration(ms())}</span>}
                </Show>
              </span>
            )
          })

          return (
            <Show
              when={
                isUpstreamSuppressed ||
                activeQuestion() ||
                activeSuggestion() ||
                bash() ||
                planExit() ||
                PART_MAPPING[part.type]
              }
            >
              <div
                ref={el}
                data-component="tool-part-wrapper"
                data-part-type={part.type}
                data-part-id={part.id}
                data-timeline-highlight={highlighted() ? "" : undefined}
                data-tool-enter={motion.enter()}
                data-tool-live={motion.live()}
                data-tool-status={motion.status()}
                style={{
                  "--timeline-color": highlighted() ? timelineColor(part as unknown as TimelinePart) : undefined,
                  "--tool-stagger": motion.stagger(),
                }}
                onAnimationEnd={motion.end}
              >
                <div ref={body} data-slot="tool-part-body">
                  <Show
                    when={activeQuestion()}
                    fallback={
                      <Show
                        when={activeSuggestion()}
                        fallback={
                          <Show
                            when={planExit()}
                            fallback={
                              <Show
                                when={bash()}
                                fallback={
                                  <Show
                                    when={isUpstreamSuppressed}
                                    fallback={
                                      <Part
                                        part={part}
                                        message={props.message as SDKMessage}
                                        showAssistantCopyPartID={props.showAssistantCopyPartID}
                                        defaultOpen={toolDefaultOpen(part, open(), edit(), mcp())}
                                        reasoningDisplay={display.reasoningDisplay()}
                                        settled={settled()}
                                        feedback={props.feedback}
                                        throughput={throughputEl()}
                                        turnMeta={turnMetaEl()}
                                        readonly={props.readonly}
                                      />
                                    }
                                  >
                                    <TodoToolCard part={part as unknown as ToolPart} />
                                  </Show>
                                }
                              >
                                {(tool) => <BashToolCard part={tool() as unknown as ToolPart} defaultOpen={open()} />}
                              </Show>
                            }
                          >
                            {(tp) => <PlanExitCard part={tp()} sessionID={props.message.sessionID} />}
                          </Show>
                        }
                      >
                        {(req) => <SuggestBar request={req()} />}
                      </Show>
                    }
                  >
                    {(req) => <QuestionDock request={req()} />}
                  </Show>
                </div>
              </div>
            </Show>
          )
        }}
      </For>
    </>
  )
}
