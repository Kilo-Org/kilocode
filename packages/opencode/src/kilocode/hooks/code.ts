import { Effect } from "effect"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { InstanceRef } from "@/effect/instance-ref"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import type { MCP } from "@/mcp"
import type { Tool } from "@/tool/tool"
import { KiloHooks } from "./hooks"
import { KiloHookLoop } from "./loop"
import { KiloHookPayload } from "./payload"
import { KiloHookTool } from "./tool"

// PreToolUse and PostToolUse for the MCP tool calls a code-mode script makes. Hooks come from the
// code-mode tool's context (`ctx.extra.hooks`), so nothing resolves sandbox state inside the
// sandbox tool gate.

/** The code-mode child call, as `invokeChildTool` receives it. */
type Child = {
  entry: { key: string; server: string; tool: MCP.McpTool }
  args: Record<string, unknown>
  callID: string
  ctx: Tool.Context
}

/**
 * The hook call for a child call; no `confirm`, since a child call cannot show a prompt. The turn's
 * user message scopes a `continue: false` halt to this turn, as for the code-mode call itself.
 */
const call = Effect.fn("KiloHookCode.call")(function* (input: Child) {
  const line = yield* KiloHookLoop.lineage(input.ctx.sessionID)
  return {
    tool: input.entry.key,
    aliases: [KiloHooks.mcp(input.entry.tool.clientName, input.entry.tool.def.name)],
    args: input.args,
    callID: input.callID,
    sessionID: input.ctx.sessionID,
    directory: line.directory ?? (yield* InstanceRef)?.directory ?? process.cwd(),
    abort: input.ctx.abort,
    agent: input.ctx.agent,
    prompt: KiloSessionMessageOrder.latest(input.ctx.messages).user?.id,
    parent: line.parent,
    root: line.root,
    mode: KiloHookPayload.mode(line.permission, input.ctx.agent),
    server: input.entry.tool.clientName,
  } satisfies KiloHooks.Call
})

/** PreToolUse for a code-mode child call; fails with the block message when a hook blocks it. */
export const before = Effect.fn("KiloHookCode.before")(function* (input: Child) {
  const hooks = KiloHooks.from(input.ctx.extra?.hooks)
  if (!hooks) return
  // A PreToolUse `ask` blocks here: without `confirm`, nobody can answer it.
  const blocked = yield* KiloHookTool.before(hooks, yield* call(input)).pipe(Effect.orDie)
  if (blocked) yield* Effect.fail(new Error(blocked))
})

/** PostToolUse for a code-mode child call; feedback is appended to `result.content` as a text item. */
export const after = Effect.fn("KiloHookCode.after")(function* (input: Child, result: CallToolResult) {
  const hooks = KiloHooks.from(input.ctx.extra?.hooks)
  if (!hooks) return
  const text = result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
  const verdict = yield* KiloHookTool.post(hooks, yield* call(input), text, text)
  // A replacement only narrows what the script sees: the hook's text instead of every content item.
  if (verdict.output !== undefined) {
    result.content = [{ type: "text", text: KiloHooks.clip(verdict.output, Math.max(KiloHooks.FEEDBACK, text.length)) }]
    delete result.structuredContent
  }
  if (verdict.notes.length) result.content.push({ type: "text", text: verdict.notes.join("\n\n") })
})

export * as KiloHookCode from "./code"
