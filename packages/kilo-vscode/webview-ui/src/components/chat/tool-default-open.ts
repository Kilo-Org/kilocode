import type { Part as SDKPart, ToolPart } from "@kilocode/sdk/v2"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
const TERMINAL_TOOLS = new Set(["bash", "background_process"])

export function toolDefaultOpen(part: SDKPart, terminal: boolean, edit: boolean) {
  if (part.type !== "tool") return undefined
  const tool = (part as unknown as ToolPart).tool
  if (TERMINAL_TOOLS.has(tool)) return terminal
  if (EDIT_TOOLS.has(tool)) return edit
  return undefined
}
