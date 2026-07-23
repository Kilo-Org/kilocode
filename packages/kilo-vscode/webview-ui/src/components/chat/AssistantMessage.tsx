/**
 * AssistantMessage component
 * Renders all parts of an assistant message as a flat list — no context grouping.
 * Unlike the upstream AssistantParts, this renders each read/glob/grep/list tool
 * individually for maximum verbosity in the VS Code sidebar context.
 *
 * Active questions render inline via QuestionDock; permissions are in the bottom dock.
 */

import { Component, For, Show, createMemo } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Part, PART_MAPPING, ToolRegistry, ToolApprovalProvider, toolApprovalFrom } from "@kilocode/kilo-ui/message-part"
import type { MessageFeedbackControls } from "@kilocode/kilo-ui/message-part"
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
import { color as timelineColor } from "../../utils/timeline/colors"
import type { Part as TimelinePart } from "../../types/messages"
import type { TimelineHighlight } from "../../utils/timeline/highlight"
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

function PlanExitCard(props: { part: ToolPart }) {
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
    data.openFile(i.plan)
  }
  return (
    <Show when={info()}>
      <div data-component="plan-exit-card">
        <span data-slot="plan-exit-label">{label()}</span>{" "}
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

interface AssistantMessageProps {
  message: SDKAssistantMessage
  parts?: SDKPart[]
  showAssistantCopyPartID?: string | null
  feedback?: MessageFeedbackControls
  /** id of the part containing the current chat-search match, if any — forces
   * that part's collapsed tool/reasoning content open so the user can see
   * the highlighted match without manually expanding it first. */
  forceOpenPartID?: string
  /** For a multi-file apply_patch match, the specific file within that part —
   * lets that one nested item open instead of every file in the patch. */
  forceOpenFile?: string
  /** Part behind the currently hovered/focused task-timeline bar, if any. */
  highlight?: () => TimelineHighlight | undefined
}

type ToolStateProps = {
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
  status?: string
}

function TodoToolCard(props: { part: ToolPart; forceOpen?: boolean }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  return (
    <Show when={render}>
      {(renderFn) => (
        <ToolApprovalProvider value={() => toolApprovalFrom(state()?.metadata)}>
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
            forceOpen={props.forceOpen}
            reveal={false}
          />
        </ToolApprovalProvider>
      )}
    </Show>
  )
}

function BashToolCard(props: { part: ToolPart; defaultOpen: boolean; forceOpen?: boolean }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  return (
    <Show when={render}>
      {(card) => (
        <ToolApprovalProvider value={() => toolApprovalFrom(state()?.metadata)}>
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
            forceOpen={props.forceOpen}
            animate
            reveal={state()?.status === "pending" || state()?.status === "running"}
          />
        </ToolApprovalProvider>
      )}
    </Show>
  )
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()
  const display = useDisplay()
  const { config } = useConfig()
  const open = createMemo(() => config().terminal_command_display !== "collapsed")
  const edit = createMemo(() => config().code_edit_display === "expanded")

  const parts = createMemo(() => {
    const stored = props.parts ?? data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter((part) => {
      if (!isRenderable(part, props.message)) return false
      if (part.type !== "tool" || part.tool !== "question") return true
      if (part.state.status !== "pending" && part.state.status !== "running") return true
      return !!matchToolRequest(part, "question", session.questions())
    })
  })
  return (
    <>
      <For each={parts()}>
        {(part) => {
          // Upstream PART_MAPPING["tool"] returns null for todowrite/todoread,
          // so we detect them here and render via ToolRegistry directly.
          const isUpstreamSuppressed =
            part.type === "tool" && UPSTREAM_SUPPRESSED_TOOLS.has((part as SDKPart & { tool: string }).tool)

          // Active question tool parts render the interactive QuestionDock inline
          const activeQuestion = createMemo(() => matchToolRequest(part, "question", session.questions()))

          // Active suggestion tool parts render the interactive SuggestBar inline
          const activeSuggestion = createMemo(() => matchToolRequest(part, "suggest", session.suggestions()))
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
          const forceOpen = createMemo(() => !!props.forceOpenPartID && part.id === props.forceOpenPartID)

          // Lights up when this part is behind the hovered/focused task-timeline
          // bar, using that bar's own color so the two stay easy to correlate.
          const highlighted = createMemo(() => {
            const h = props.highlight?.()
            return h?.msgId === props.message.id && h?.partId === part.id
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
                data-component="tool-part-wrapper"
                data-part-type={part.type}
                data-part-id={part.id}
                data-timeline-highlight={highlighted() ? "" : undefined}
                style={
                  highlighted() ? { "--timeline-color": timelineColor(part as unknown as TimelinePart) } : undefined
                }
              >
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
                                      defaultOpen={toolDefaultOpen(part, open(), edit())}
                                      forceOpen={forceOpen()}
                                      forceOpenFile={forceOpen() ? props.forceOpenFile : undefined}
                                      reasoningAutoCollapse={display.reasoningAutoCollapse()}
                                      feedback={props.feedback}
                                      animate={
                                        part.type === "tool" &&
                                        ((part as unknown as ToolPart).state?.status === "pending" ||
                                          (part as unknown as ToolPart).state?.status === "running")
                                      }
                                    />
                                  }
                                >
                                  <TodoToolCard part={part as unknown as ToolPart} forceOpen={forceOpen()} />
                                </Show>
                              }
                            >
                              {(tool) => (
                                <BashToolCard
                                  part={tool() as unknown as ToolPart}
                                  defaultOpen={open()}
                                  forceOpen={forceOpen()}
                                />
                              )}
                            </Show>
                          }
                        >
                          {(tp) => <PlanExitCard part={tp()} />}
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
            </Show>
          )
        }}
      </For>
    </>
  )
}
