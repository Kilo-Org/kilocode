// kilocode_change - Code Mode child-MCP adapter for the ActionGate. When experimentalCodeMode is ON the
// generic MCP wrapper in session/tools.ts is bypassed; child MCP tool calls flow through
// tool/code-mode.ts invokeChildTool -> the external client.callTool. This function is the single wiring
// point that puts the MCP gate around that call: it derives server/tool from the catalog entry, the
// trusted intent + model from the turn-initiating user message, and the child-session flag from
// ctx.parentSessionID, then hands off to McpGate.guardedExecute (execute runs EXACTLY once on allow; a
// block throws and execute is not called). Extracted from the inline block so the wiring is unit-testable
// without a live MCP server (see test/kilocode/mcp-codemode.test.ts). Same guarantee as the generic
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
 * Wire the MCP gate around a single Code Mode child MCP call. `makeJudge` is a factory over the
 * turn's model so production can build ActionJudge.classify(providerOpt, model, ...) while tests inject
 * a fake judge; both see the same server + tool + argKeys envelope built inside McpGate.decide.
 */
export function guardChildMcpCall<A, E, R>(params: {
  readonly tool: ChildMcpTool
  readonly args: Record<string, unknown>
  readonly ctx: ChildMcpCtx
  readonly makeJudge: (model: Model) => (input: ActionJudge.McpJudgeInput) => Effect.Effect<ActionJudge.Verdict>
  readonly execute: () => Effect.Effect<A, E, R>
}): Effect.Effect<A, E, R> {
  const { intent, model } = ActionJudge.selectIntent(params.ctx.messages, params.ctx.userMessageID)
  return McpGate.guardedExecute(
    {
      server: params.tool.clientName,
      tool: params.tool.def.name,
      args: params.args,
      isChildSession: params.ctx.parentSessionID != null,
      intent,
      judge: params.makeJudge(model),
    },
    params.execute,
  )
}
