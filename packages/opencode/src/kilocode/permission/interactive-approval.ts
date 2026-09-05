// kilocode_change - Shared predicate for permission requests that MUST be answered by an interactive
// human and never silently auto-approved (static allow rule, --auto, or the YOLO allow-everything
// approver). It covers the two existing special cases (skillShell, sandboxEscalation) plus the new
// actionGateDegraded: the ActionGate's fail-safe escalation, raised when the reasoning-blind classifier
// itself fails (timeout / provider error / malformed output / provider unavailable). Instead of a hard
// block the gate asks for a one-shot manual approval, tagged with this metadata so the permission layer
// forces an interactive prompt, refuses any non-interactive/auto allow, and persists no rule.
//
// Every site that used to special-case `skillShell || sandboxEscalation` now calls this, so the three
// stay in lockstep (permission/index.ts forceAsk + reply refuse + covered, drain.ts, run.ts headless
// reject, permission.shared.ts UI, acp/permission.ts).

/** Metadata key marking an ActionGate degraded (classifier-failure) escalation. */
export const ACTION_GATE_DEGRADED_KEY = "actionGateDegraded"
/** Metadata key carrying the degraded reasonCode (classifier_timeout/error/malformed/unavailable). */
export const ACTION_GATE_REASON_KEY = "actionGateReason"

/** True iff this request must be answered by an interactive human and never auto-approved. */
export function requiresInteractiveApproval(metadata: { readonly [k: string]: unknown } | undefined): boolean {
  return (
    metadata?.["skillShell"] === true ||
    metadata?.["sandboxEscalation"] === true ||
    metadata?.[ACTION_GATE_DEGRADED_KEY] === true
  )
}
