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

// kilocode_change start - classifier one-shot pre-approval (KILO_ACTION_GATE_AUTHORIZER)
/**
 * Metadata key marking a classifier one-shot pre-approval: a confirmed reasoning-blind `allow` may authorize
 * ONLY the exact action-level request it verified, suppressing that request's otherwise-redundant permission
 * prompt. INVARIANT: this is an INTERNAL marker set ONLY by the trusted gate wrappers (withAuthorizer, and
 * ShellTool.ask) AFTER a real classifier `allow` on a ROOT session; it is NEVER derived from tool arguments,
 * and is kept strictly SEPARATE from actionGateDegraded (a degraded escalation is the opposite — a forced
 * manual prompt). It does not persist any rule and does not weaken deny / hardRuleset / Config Protection /
 * skillShell / sandboxEscalation, all of which are resolved before it in Permission.ask. external_directory
 * is protected differently: the wrapper never puts this marker on the auxiliary (external_directory) ask, so
 * that ask stays an ordinary prompt — its safety does not depend on ordering inside Permission.ask.
 */
export const ACTION_GATE_AUTHORIZED_KEY = "actionGateAuthorized"

/**
 * Whether the classifier one-shot pre-approval feature is enabled for this run (KILO_ACTION_GATE_AUTHORIZER=1).
 * Read at CALL TIME (never a module-load constant) so the marker-setting gate wrappers AND the permission layer
 * that honors the marker always agree, and so tests can toggle it. Kept HERE — not in degraded.ts — so the
 * permission layer can require it WITHOUT importing the gate (no dependency cycle).
 */
export function authorizerEnabled(): boolean {
  return process.env["KILO_ACTION_GATE_AUTHORIZER"] === "1"
}

/**
 * Whether a classifier `allow` may pre-approve in THIS session: the feature must be enabled AND the session
 * must be a ROOT session (no parent). A genuine child/subagent session (parentSessionID set) is NEVER
 * pre-approved, because the human-intent provenance there is not proven. Used by the marker-setting sites.
 */
export function authorizerAllows(parentSessionID: string | undefined | null): boolean {
  return authorizerEnabled() && parentSessionID == null
}

/**
 * True iff this request is EFFECTIVELY gate-authorized: the feature is enabled AND the one-shot marker is
 * present. The permission layer calls this, so with the feature off a marker alone can never pre-approve.
 * Permission additionally requires the feature flag. Marker authenticity and root-session provenance are
 * enforced by trusted marker-setting call sites. Code able to fabricate Permission.Request metadata while the
 * flag is enabled is outside this control's threat boundary.
 */
export function isActionGateAuthorized(metadata: { readonly [k: string]: unknown } | undefined): boolean {
  return authorizerEnabled() && metadata?.[ACTION_GATE_AUTHORIZED_KEY] === true
}
// kilocode_change end

/** True iff this request must be answered by an interactive human and never auto-approved. */
export function requiresInteractiveApproval(metadata: { readonly [k: string]: unknown } | undefined): boolean {
  return (
    metadata?.["skillShell"] === true ||
    metadata?.["sandboxEscalation"] === true ||
    metadata?.[ACTION_GATE_DEGRADED_KEY] === true
  )
}
