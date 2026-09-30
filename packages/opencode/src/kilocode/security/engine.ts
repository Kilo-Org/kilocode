import { Decision } from "./decision"
import { SecurityRules } from "./rules"
import type { NormalizedAction, SecurityContext, SecurityDecision, SecurityEvidence } from "./types"

/**
 * The central security engine: pure, deterministic, side-effect free.
 *
 * It receives an already normalised action plus the session context, applies the immutable hard
 * rules and the default policy, and reduces the evidence monotonically (DENY > ASK > ALLOW).
 * Any internal failure is a hard ASK, never a silent ALLOW.
 *
 * Additional evidence layers (package provenance, session secret state) do not decide on their own:
 * they hand structured evidence to {@link extend}, which folds it into the same monotonic reducer, so
 * a layer can only tighten a decision and never relax one.
 */
export namespace SecurityEngine {
  const FALLBACK: SecurityEvidence = {
    rule: "engine.default",
    source: "default",
    action: "ask",
    reasonCode: "UNCLASSIFIED_ACTION",
    message: "The action could not be classified.",
  }

  export function evaluate(action: NormalizedAction, ctx: SecurityContext): SecurityDecision {
    try {
      const list = SecurityRules.evaluate(action, ctx)
      return Decision.reduce(list, FALLBACK)
    } catch (err) {
      return Decision.failure(err)
    }
  }

  /**
   * Fold extra evidence into an existing decision. Monotonic: the result is never weaker than either
   * input, so a deterministic DENY / hard ASK from the base rules cannot be weakened by a heuristic
   * layer, and an ALLOW-only layer changes nothing.
   */
  export function extend(base: SecurityDecision, extra: SecurityEvidence[]): SecurityDecision {
    if (extra.length === 0) return base
    try {
      return Decision.reduce([...base.evidence, ...extra], FALLBACK)
    } catch (err) {
      // The base is handed to `failure` so the fold keeps it: a layer that throws must not be able to
      // discard a DENY the rules had already reached.
      return Decision.failure(err, base)
    }
  }
}
