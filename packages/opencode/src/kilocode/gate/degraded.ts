// kilocode_change - Fail-safe escalation ("ask") plumbing for the ActionGate. When the reasoning-blind
// classifier ITSELF fails (timeout / provider error / malformed output / provider unavailable) the gate
// does NOT hard-block; it escalates to a manual approval WITHOUT creating its own prompt. The surface runs
// its NORMAL execute path through a ctx wrapped by `withDegraded`, which tags ONLY the tool's action-level
// permission request (real permission + real patterns kept) with actionGateDegraded metadata and drops
// `always` (so an approval persists no rule). A tool's AUXILIARY asks (e.g. external_directory before edit)
// pass through untouched, so there is exactly ONE degraded action prompt. The permission layer force-asks
// that real request, refuses non-interactive/auto allow, and shows one degraded ACTION prompt (a separate
// normal external_directory prompt is still possible). Interactive approve -> the
// tool proceeds; reject / headless denial -> the ask fails -> deny-and-continue (tool error); abort -> interrupt.
import { Effect } from "effect"
import type { Context } from "@/tool/tool"
import type { AskCode, Verdict } from "./action-judge"
import {
  ACTION_GATE_DEGRADED_KEY,
  ACTION_GATE_REASON_KEY,
  ACTION_GATE_AUTHORIZED_KEY,
} from "@/kilocode/permission/interactive-approval"

type AskRequest = Parameters<Context["ask"]>[0]

// kilocode_change start - classifier one-shot pre-approval (opt-in). The env predicate lives in
// interactive-approval.ts (authorizerEnabled / authorizerAllows) so the permission layer can require the flag
// without a dependency cycle; the caller passes the resulting boolean as guardSurface's `canAuthorize`.
/**
 * Wrap a Tool.Context so ONLY the action-level ask (the one whose permission satisfies `appliesTo`) carries
 * the classifier pre-approval marker and `always: []` (persists no rule). Every OTHER ask the tool makes
 * (external_directory, sandbox_escalation, …) passes through UNCHANGED, so pre-approval never covers an
 * auxiliary prompt. The marker is set HERE — by the gate, only after a real `allow` — and never taken from
 * tool args. Does not mutate the original ctx.
 */
export function withAuthorizer(ctx: Context, appliesTo: (permission: string) => boolean): Context {
  const ask = (req: AskRequest) =>
    appliesTo(req.permission)
      ? ctx.ask({ ...req, always: [], metadata: { ...req.metadata, [ACTION_GATE_AUTHORIZED_KEY]: true } })
      : ctx.ask(req)
  return { ...ctx, ask }
}
// kilocode_change end

/**
 * Wrap a Tool.Context so ONLY the action-level permission ask (the one whose permission satisfies
 * `appliesTo`) is tagged as a degraded escalation: keeps its real permission/patterns/metadata, adds
 * actionGateDegraded + reason, and forces `always: []`. Every other ask the tool makes (external_directory,
 * etc.) passes through UNCHANGED. Does not mutate the original ctx.
 */
export function withDegraded(ctx: Context, reasonCode: AskCode, appliesTo: (permission: string) => boolean): Context {
  const ask = (req: AskRequest) =>
    appliesTo(req.permission)
      ? ctx.ask({
          ...req,
          always: [],
          metadata: { ...req.metadata, [ACTION_GATE_DEGRADED_KEY]: true, [ACTION_GATE_REASON_KEY]: reasonCode },
        })
      : ctx.ask(req)
  return { ...ctx, ask }
}

/**
 * The shared, testable surface orchestration used by write / generic MCP / Code Mode (shell mirrors it via
 * its own bash ask). `decide` yields the verdict; block -> throw (tool error, deny-and-continue); ask -> run
 * via selective withDegraded so the tool's OWN action prompt becomes the single degraded prompt; allow ->
 * run unchanged. Unit-testable: inject a fake ctx that records which permission got the degraded tag and a
 * fake `run` that counts executions.
 */
export function guardSurface<A, E, R>(params: {
  readonly decide: Effect.Effect<Verdict>
  readonly ctx: Context
  readonly appliesTo: (permission: string) => boolean
  readonly blockMessage: (reasonCode: string) => string
  readonly run: (ctx: Context) => Effect.Effect<A, E, R>
  // kilocode_change - caller passes authorizerAllows(parentSessionID) (flag AND root session); the env/child
  // logic stays at the call site so guardSurface stays pure and testable. Omitted/false -> prior behavior on allow.
  readonly canAuthorize?: boolean
}): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const verdict = yield* params.decide
    if (verdict.decision === "block") throw new Error(params.blockMessage(verdict.reasonCode))
    // kilocode_change - allow + authorizer ON (root session) -> selective classifier pre-approval; ask ->
    // selective withDegraded (unchanged); otherwise the context is untouched.
    const ctx =
      verdict.decision === "ask"
        ? withDegraded(params.ctx, verdict.reasonCode, params.appliesTo)
        : verdict.decision === "allow" && params.canAuthorize
          ? withAuthorizer(params.ctx, params.appliesTo)
          : params.ctx
    return yield* params.run(ctx)
  })
}
