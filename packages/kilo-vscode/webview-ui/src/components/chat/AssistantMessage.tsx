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
import { QuestionDock } from "./QuestionDock"

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

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()

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
          const activeQuestion = createMemo(() => {
            if (part.type !== "tool") return undefined
            const tp = part as unknown as ToolPart
            if (tp.tool !== "question") return undefined
            if (tp.state?.status !== "pending" && tp.state?.status !== "running") return undefined
            return session.questions().find((q) => q.tool?.callID === tp.callID && q.tool?.messageID === tp.messageID)
          })

          return (
            <Show when={isUpstreamSuppressed || activeQuestion() || PART_MAPPING[part.type]}>
              <div data-component="tool-part-wrapper" data-part-type={part.type}>
                <Show
                  when={activeQuestion()}
                  fallback={
                    <Show
                      when={isUpstreamSuppressed}
                      fallback={
                        <Part
                          part={part}
                          message={props.message as SDKMessage}
                          showAssistantCopyPartID={props.showAssistantCopyPartID}
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
