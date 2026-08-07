import type { Part as SDKPart, ToolPart } from "@kilocode/sdk/v2"

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
const TERMINAL_TOOLS = new Set(["bash", "background_process"])
const BUILTIN_NON_MCP_TOOLS = new Set([
  "read",
  "list",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "chart",
  "codesearch",
  "semantic_search",
  "task",
  "todowrite",
  "todoread",
  "question",
  "suggest",
  "skill",
  "plan_enter",
  "plan_exit",
])

export function toolDefaultOpen(part: SDKPart, terminal: boolean, edit: boolean, mcp?: boolean) {
  if (part.type !== "tool") return undefined
  const tool = (part as unknown as ToolPart).tool
  if (TERMINAL_TOOLS.has(tool)) return terminal
  if (EDIT_TOOLS.has(tool)) return edit
  if (BUILTIN_NON_MCP_TOOLS.has(tool)) return undefined
  if (mcp !== undefined) return mcp
  return undefined
}
