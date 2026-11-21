// kilocode_change - new file
/**
 * What a client shows about the deterministic security layer's decision on one tool call.
 *
 * The audit record on `state.metadata.securityDecision` carries two independent fields — what the
 * reviewer did (`reviewer.state`) and how the call was finally enforced (`final_enforcement`) — and
 * neither alone is the state a user needs: a `keep_ask` that a human then rejected is not the same
 * outcome as one still waiting. Collapsing the pair here, once, is what keeps the terminal UI and
 * the web UI from drifting apart on what "blocked" means.
 *
 * Deliberately pure and dependency-free: every surface that renders a tool row imports it.
 */
export namespace SecurityStatus {
  /** Metadata key the permission pipeline writes the audit record under. */
  export const KEY = "securityDecision" as const

  export type Kind = "reviewing" | "auto-approved" | "needs-approval" | "blocked"

  export type Status = Readonly<{
    kind: Kind
    /** The stable rule id. Detail, never the badge: it means nothing to a reader on its own. */
    rule_id?: string
    /** The reviewer's own short code for its verdict, when one answered. */
    reason_code?: string
    /** How long the reviewer took, when it ran. */
    latency_ms?: number
  }>

  type Record_ = {
    rule_id?: unknown
    decision?: unknown
    reviewer?: { state?: unknown; reason_code?: unknown; latency_ms?: unknown }
    final_enforcement?: unknown
    enforcement_source?: unknown
  }

  /** A call that did not proceed, however it was stopped. */
  const STOPPED = new Set(["deny", "blocked", "reject"])

  function record(metadata: Record<string, unknown> | undefined): Record_ | undefined {
    const value = metadata?.[KEY]
    if (!value || typeof value !== "object") return undefined
    return value as Record_
  }

  function text(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined
  }

  /**
   * The one state worth a badge, or nothing.
   *
   * Nothing is the common case and it is the point: a call the layer allowed without a reviewer
   * ever looking at it has no story to tell, and a badge on every tool row would say nothing while
   * costing a line. An unrecognized record is nothing too — a client never invents a state.
   */
  export function from(metadata: Record<string, unknown> | undefined): Status | undefined {
    const value = record(metadata)
    if (!value) return undefined
    const enforcement = text(value.final_enforcement)
    const state = text(value.reviewer?.state)
    const detail = {
      ...(text(value.rule_id) ? { rule_id: text(value.rule_id) } : {}),
      ...(text(value.reviewer?.reason_code) ? { reason_code: text(value.reviewer?.reason_code) } : {}),
      ...(typeof value.reviewer?.latency_ms === "number" ? { latency_ms: value.reviewer.latency_ms } : {}),
    }
    // Enforcement outranks the verdict, in both directions. The reviewer and the ordinary permission
    // pipeline are separate levels: a reviewer that steps aside has not decided the call may run,
    // because a rule of Kilo's own can still require a human. Reading the verdict first is what puts
    // an "auto-approved" badge next to an open permission dialog.
    if (value.decision === "deny" || (enforcement && STOPPED.has(enforcement))) return { kind: "blocked", ...detail }
    if (enforcement === "ask_pending") {
      if (state === "running") return { kind: "reviewing", ...detail }
      return { kind: "needs-approval", ...detail }
    }
    // A human answering the prompt is an ordinary approval, already explained by the approval note
    // beside it; claiming the reviewer earned it would take credit for a decision it did not make.
    if (enforcement === "allow" && state === "allow" && value.enforcement_source !== "manual")
      return { kind: "auto-approved", ...detail }
    if (state === "running") return { kind: "reviewing", ...detail }
    return undefined
  }
}
