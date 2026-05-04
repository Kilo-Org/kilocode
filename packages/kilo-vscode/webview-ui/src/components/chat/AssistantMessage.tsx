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
import { Part, PART_MAPPING, ToolRegistry } from "@kilocode/kilo-ui/message-part"
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
import { QuestionDock } from "./QuestionDock"
import { SuggestBar } from "./SuggestBar"

// Tools that the upstream message-part renderer suppresses (returns null for).
// We render these ourselves via ToolRegistry when they complete,
// so the user can see what the AI set up.
export const UPSTREAM_SUPPRESSED_TOOLS = new Set(["todowrite", "todoread"])

function isRenderable(part: SDKPart): boolean {
  if (part.type === "tool") {
    const tool = (part as SDKPart & { tool: string }).tool
    const state = (part as SDKPart & { state: { status: string } }).state
    if (UPSTREAM_SUPPRESSED_TOOLS.has(tool)) {
      // Show todo parts only when completed (permissions are now in the dock)
      return state.status === "completed"
    }
    // Always render question tool parts — active ones get the inline QuestionDock
    return true
  }
  if (part.type === "text") return !!(part as SDKPart & { text: string }).text?.trim()
  if (part.type === "reasoning") return !!(part as SDKPart & { text: string }).text?.trim()
  return !!PART_MAPPING[part.type]
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
  showAssistantCopyPartID?: string | null
}

function TodoToolCard(props: { part: ToolPart }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = props.part.state as any
  return (
    <Show when={render}>
      {(renderFn) => (
        <Dynamic
          component={renderFn()}
          input={state?.input ?? {}}
          metadata={state?.metadata ?? {}}
          tool={props.part.tool}
          output={state?.output}
          status={state?.status}
          defaultOpen
          reveal={false}
        />
      )}
    </Show>
  )
}

function BashToolCard(props: { part: ToolPart; defaultOpen: boolean }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = props.part.state as any
  return (
    <Show when={render}>
      {(card) => (
        <Dynamic
          component={card() as unknown as Component<Record<string, unknown>>}
          input={state?.input ?? {}}
          metadata={state?.metadata ?? {}}
          partMetadata={props.part.metadata ?? {}}
          tool={props.part.tool}
          partID={props.part.id}
          callID={props.part.callID}
          output={state?.output}
          status={state?.status}
          defaultOpen={props.defaultOpen}
          animate
          reveal={state?.status === "pending" || state?.status === "running"}
        />
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

  const parts = createMemo(() => {
    const stored = data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter((part) => isRenderable(part))
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

          return (
            <Show
              when={isUpstreamSuppressed || activeQuestion() || activeSuggestion() || bash() || PART_MAPPING[part.type]}
            >
              <div data-component="tool-part-wrapper" data-part-type={part.type}>
                <Show
                  when={activeQuestion()}
                  fallback={
                    <Show
                      when={activeSuggestion()}
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
                                  reasoningAutoCollapse={display.reasoningAutoCollapse()}
                                  animate={
                                    part.type === "tool" &&
                                    ((part as unknown as ToolPart).state?.status === "pending" ||
                                      (part as unknown as ToolPart).state?.status === "running")
                                  }
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
