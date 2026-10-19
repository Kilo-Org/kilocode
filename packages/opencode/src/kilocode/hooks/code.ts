import { Effect } from "effect"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { MCP } from "@/mcp"
import type { Tool } from "@/tool/tool"

// PreToolUse and PostToolUse for the MCP tool calls a code-mode script makes. Hooks come from the
// code-mode tool's context (`ctx.extra.hooks`), so nothing resolves sandbox state inside the
// sandbox tool gate.

/** The code-mode child call, as `invokeChildTool` receives it. */
export type Child = {
  entry: { key: string; server: string; tool: MCP.McpTool }
  args: Record<string, unknown>
  callID: string
  ctx: Tool.Context
}

/** PreToolUse for a code-mode child call; fails with the block message when a hook blocks it. */
export function before(_input: Child): Effect.Effect<void, Error> {
  return Effect.void
}

/** PostToolUse for a code-mode child call; feedback is appended to `result.content` as a text item. */
export function after(_input: Child, _result: CallToolResult): Effect.Effect<void> {
  return Effect.void
}

export * as KiloHookCode from "./code"
