// kilocode_change - Code Mode child-MCP adapter for the ActionGate. When experimentalCodeMode is ON the
// generic MCP wrapper in session/tools.ts is bypassed; child MCP tool calls flow through
// tool/code-mode.ts invokeChildTool -> the external client.callTool. This function ONLY forms the MCP
// verdict (orchestration — block/ask/allow — is done by DegradedGate.guardSurface in code-mode.ts): it derives server/tool from the catalog entry, the
// trusted intent + model from the turn-initiating user message, and the child-session flag from
// ctx.parentSessionID, then returns the verdict via McpGate.decide. The caller (code-mode.ts) applies it
// through DegradedGate.guardSurface (block -> throw; ask -> selective withDegraded; allow -> run). Extracted
// so the wiring is unit-testable without a live MCP server (see test/kilocode/mcp-codemode.test.ts). Same guarantee as the generic
// slice: blocks the CALL by identity (server + tool + argKeys), never inspects/decides on argument
// VALUES, and does not protect against side effects inside the MCP server.
import { Effect } from "effect"
import * as ActionJudge from "./action-judge"
import * as McpGate from "./mcp-gate"

/** Minimal structural view of Tool.Context needed to gate a child MCP call (keeps this module free of
 * the heavy code-mode/session imports so the wiring can be tested in isolation). */
export interface ChildMcpCtx {
  readonly messages: readonly ActionJudge.MessageView[]
  readonly userMessageID: string | undefined
  readonly parentSessionID: string | undefined
  readonly abort: AbortSignal
  readonly sessionID: string
  readonly callID?: string
}

/** Minimal structural view of the catalog entry's MCP tool: identity only. */
export interface ChildMcpTool {
  readonly clientName: string
  readonly def: { readonly name: string }
}

type Model = { readonly providerID: string; readonly modelID: string } | undefined

/**
 * Decide the MCP verdict for a single Code Mode child MCP call (no execute here). `makeJudge` is a factory
 * over the turn's model so production builds ActionJudge.classify(providerOpt, model, ...) while tests inject
 * a fake judge; both see the same server + tool + argKeys envelope built inside McpGate.decide. The caller
 * (code-mode.ts) applies the verdict: block -> throw; ask -> run the child call through DegradedGate.withDegraded(ctx).
 */
export function decideChildMcp(params: {
  readonly tool: ChildMcpTool
  readonly args: Record<string, unknown>
  readonly ctx: ChildMcpCtx
  readonly makeJudge: (model: Model) => (input: ActionJudge.McpJudgeInput) => Effect.Effect<ActionJudge.Verdict>
}): Effect.Effect<ActionJudge.Verdict> {
  const { intent, model } = ActionJudge.selectIntent(params.ctx.messages, params.ctx.userMessageID)
  return McpGate.decide({
    server: params.tool.clientName,
    tool: params.tool.def.name,
    args: params.args,
    isChildSession: params.ctx.parentSessionID != null,
    intent,
    judge: params.makeJudge(model),
  })
}
