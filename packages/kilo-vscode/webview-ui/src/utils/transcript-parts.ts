import { PART_MAPPING, ToolRegistry } from "@kilocode/kilo-ui/message-part"
import type { AssistantMessage, Part } from "@kilocode/sdk/v2"
import { snapshotProgress } from "../context/session-utils"

export const UPSTREAM_SUPPRESSED_TOOLS = new Set(["todowrite", "todoread"])

export function isRenderable(part: Part, message: AssistantMessage): boolean {
  if (part.type === "tool") {
    if (UPSTREAM_SUPPRESSED_TOOLS.has(part.tool)) {
      return part.state.status === "completed" && !!ToolRegistry.render(part.tool)
    }
    return true
  }
  if (part.type === "text") {
    return !snapshotProgress(part) && !!part.text?.trim() && !(part.synthetic && message?.time.completed)
  }
  if (part.type === "reasoning") return !!part.text?.replace("[REDACTED]", "").trim()
  return !!PART_MAPPING[part.type]
}
