// How each tool block starts open, from the Kilo display layouts. The same mapping as v1 over the v2 tool names:
// a terminal block follows the terminal layout, edit and write follow the code edit layout, a builtin tool with no
// block of its own stays closed, a Code Mode script follows its own layout, and every other tool (MCP or a plugin
// tool) follows the MCP layout.
import { DISPLAY_DEFAULTS, type DisplaySettings } from "../../../src/protocol"

export type ToolDisplaySettings = Omit<DisplaySettings, "reasoningDisplay">

export const DEFAULT_TOOL_DISPLAY: ToolDisplaySettings = DISPLAY_DEFAULTS

const TERMINAL_TOOLS = new Set(["shell", "background_process"])
const EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch"])
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
  "subagent",
  "task",
  "todowrite",
  "todoread",
  "question",
  "suggest",
  "skill",
  "plan_enter",
  "plan_exit",
  "open_plan",
])

/** Whether a tool block starts open, or undefined when the renderer decides for itself. */
export function toolDefaultOpen(tool: string, settings: ToolDisplaySettings = DEFAULT_TOOL_DISPLAY) {
  if (TERMINAL_TOOLS.has(tool)) return settings.terminalCommandDisplay !== "collapsed"
  if (EDIT_TOOLS.has(tool)) return settings.codeEditDisplay === "expanded"
  // Expanded lists the calls; the script itself always stays behind its own toggle.
  if (tool === "execute") return settings.codeModeDisplay === "expanded"
  if (BUILTIN_NON_MCP_TOOLS.has(tool)) return undefined
  return settings.mcpToolDisplay === "expanded"
}
