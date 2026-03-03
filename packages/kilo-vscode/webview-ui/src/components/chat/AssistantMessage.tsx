/**
 * AssistantMessage component
 * Renders all parts of an assistant message as a flat list — no context grouping.
 * Unlike the upstream AssistantParts, this renders each read/glob/grep/list tool
 * individually for maximum verbosity in the VS Code sidebar context.
 */

import { Component, For, Show, createMemo } from "solid-js"
import { Part, PART_MAPPING } from "@kilocode/kilo-ui/message-part"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, Message as SDKMessage } from "@kilocode/sdk/v2"
import { useData } from "@kilocode/kilo-ui/context/data"

const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

function isRenderable(part: SDKPart): boolean {
  if (part.type === "tool") {
    const tool = (part as SDKPart & { tool: string }).tool
    if (HIDDEN_TOOLS.has(tool)) return false
    const state = (part as SDKPart & { state: { status: string } }).state
    if (tool === "question" && (state.status === "pending" || state.status === "running")) return false
    return true
  }
  if (part.type === "text") return !!(part as SDKPart & { text: string }).text?.trim()
  if (part.type === "reasoning") return !!(part as SDKPart & { text: string }).text?.trim()
  return !!PART_MAPPING[part.type]
}

interface AssistantMessageProps {
  message: SDKAssistantMessage
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()

  const parts = createMemo(() => {
    const stored = data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter(isRenderable)
  })

  return (
    <For each={parts()}>
      {(part) => (
        <Show when={PART_MAPPING[part.type]}>
          <Part
            part={part}
            message={props.message as SDKMessage}
            showAssistantCopyPartID={props.showAssistantCopyPartID}
            turnDurationMs={props.turnDurationMs}
          />
        </Show>
      )}
    </For>
  )
}
