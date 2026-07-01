// kilocode_change start — LLM command-approval classifier (issue #9138)

/**
 * The LLM judge's policy slots (Claude Code "auto mode" model). These are part
 * of the OGR policy the gate enforces — they parameterize the `OwnModelJudge`
 * OGR detector. The deterministic regex layer lives in the OGR `config_rules`.
 */
export interface JudgePolicy {
  /** Prose descriptions of trusted infrastructure. */
  environment: string[]
  /** Exceptions to the block rules. */
  allow: string[]
  /** Block rules. */
  soft_deny: string[]
}

/** One reasoning-blind transcript line: a user message or a bare tool call. */
export type TranscriptEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; tool: string; input: unknown }

/** The action under evaluation: tool name + its projected (security-relevant) input. */
export interface ClassifierAction {
  tool: string
  input: unknown
}

/**
 * What the permission gate should do with a would-auto-approve call.
 * `allow` → proceed silently. `block` → deny-and-continue (tool error).
 * `ask` → fall back to a human prompt (OGR `require_approval`, fail-closed,
 * or the escalation backstop). Structurally matches `Permission.ClassifierDecision`.
 */
export type ClassifierDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "ask"; reason: string }

// kilocode_change end
