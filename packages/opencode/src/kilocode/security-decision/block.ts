import { Schema } from "effect"
import type { SecurityDecisionAdapter } from "./adapter"

/**
 * The typed block the deterministic security layer raises.
 *
 * The model-facing text is fixed and carries nothing but the stable rule id and, where it applies,
 * this layer's own reviewer state: no command, path, ruleset, external content or reason the model
 * itself wrote, and no hint at a way around the policy. The audit record rides along on the error
 * but never reaches the model.
 *
 * There are two texts, because there are two things a block can mean and they call for opposite
 * next moves. A policy refusal is an answer: the boundary is where it is, so the only ways on are a
 * materially safer approach or the user. Saying only "blocked" invites the model to hunt for a
 * spelling that gets through, which is exactly the behaviour the continuation breaker then has to
 * stop. A reviewer that timed out or failed decided nothing at all, and reading that as "unsafe" is
 * wrong in the other direction — one more attempt, or asking, is reasonable there.
 */
export namespace SecurityBlocked {
  /** Reviewer states that mean nothing was judged, as opposed to judged and not narrowed. */
  const UNANSWERED = new Set(["timeout", "error"])

  const CIRCUMVENTION = [
    "Do not try to reach the same outcome another way: not with a different tool, an indirect",
    "command, or anything else that works around this policy.",
    "Continue only with a materially safer alternative, or ask the user to run it themselves.",
  ].join(" ")

  const UNREVIEWED = [
    "The automatic review did not finish, so nothing was decided about this call.",
    "That does not mean the action is unsafe.",
    "You may try once more, or ask the user to approve it.",
  ].join(" ")

  function state(audit: unknown): string | undefined {
    const reviewer = (audit as { reviewer?: { state?: unknown } } | undefined)?.reviewer
    return typeof reviewer?.state === "string" ? reviewer.state : undefined
  }

  export class Error extends Schema.TaggedErrorClass<Error>()("KiloSecurityBlockedError", {
    rule_id: Schema.String,
    audit: Schema.Any,
  }) {
    override get message() {
      const reviewer = state(this.audit)
      if (reviewer !== undefined && UNANSWERED.has(reviewer))
        return `Automatic review of this tool call did not complete. rule_id=${this.rule_id} state=${reviewer}. ${UNREVIEWED}`
      return `Security policy blocked this tool call. rule_id=${this.rule_id}. ${CIRCUMVENTION}`
    }
  }

  export function of(rule_id: string, audit: SecurityDecisionAdapter.Audit) {
    return new Error({ rule_id, audit })
  }

  export function is(value: unknown): value is Error {
    return value instanceof Error
  }
}
