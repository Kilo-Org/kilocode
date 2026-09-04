// kilocode_change - Generic-MCP adapter for the ActionGate (slice 2). Extends the reasoning-blind
// classifier from shell/write to generic MCP tool calls via the generic MCP wrapper in session/tools.ts
// (before the external execute(args, opts); active only when experimentalCodeMode is OFF — Code Mode
// child MCP is a separate slice). The ActionEnvelope carries server + tool + argument KEYS only — never
// the argument VALUES — to avoid leaking secrets to the classifier provider (EDIT-WRITE-MCP-DESIGN §3,
// policy (a)). It does NOT protect against side effects inside the MCP server; it blocks the CALL by
// identity. Child (sub-agent) sessions fail closed (intent is agent-authored, not human-verified).
// Enabled by KILO_MCP_GATE=1; inert otherwise.
import { Effect } from "effect"
import type { BlockCode, McpJudgeInput, Verdict } from "./action-judge"

/** Opt-in, independent of the other gate flags. */
export const enabled = process.env["KILO_MCP_GATE"] === "1"

/** Argument KEYS only (sorted, stable) — values are never included in the envelope. */
export function argKeys(args: Record<string, unknown>): string[] {
  return Object.keys(args ?? {}).sort()
}

const block = (reasonCode: BlockCode): Verdict => ({ decision: "block", reasonCode })

export interface McpGateDeps {
  readonly server: string
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly isChildSession: boolean
  readonly intent: string | undefined
  /** Injected: production = ActionJudge.classify(...); tests pass a fake. */
  readonly judge: (input: McpJudgeInput) => Effect.Effect<Verdict>
}

/**
 * Decide the MCP verdict WITHOUT executing. child-session / missing intent short-circuit to a typed
 * block BEFORE the judge is called. The judge sees server + tool + argument keys, never values.
 */
export function decide(deps: McpGateDeps): Effect.Effect<Verdict> {
  if (deps.isChildSession) return Effect.succeed(block("unverified_child_intent"))
  if (!deps.intent) return Effect.succeed(block("intent_missing"))
  return deps.judge({
    surface: "mcp",
    userIntent: deps.intent,
    server: deps.server,
    tool: deps.tool,
    argKeys: argKeys(deps.args),
  })
}

/**
 * Run the gate, then the `execute` callback EXACTLY once on allow. A block throws (deny-and-continue →
 * tool error) and `execute` is NOT called. child-session / missing intent block before the judge; a
 * user/session abort inside the judge propagates as interruption (execute not called).
 */
export function guardedExecute<A, E, R>(
  deps: McpGateDeps,
  execute: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const verdict = yield* decide(deps)
    if (verdict.decision === "block") throw new Error(`Blocked by MCP gate (${verdict.reasonCode}).`)
    return yield* execute()
  })
}
