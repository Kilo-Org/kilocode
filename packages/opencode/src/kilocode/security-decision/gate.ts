import { Effect } from "effect"
import type * as Config from "@/config/config"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SecurityAuthority } from "./authority"
import { SecurityAuthorization } from "./authorization"
import { SecurityDecisionAdapter } from "./adapter"
import { SecurityDecisionRules as R } from "./rules"
import { SecurityReviewer } from "./reviewer"
import type { SecurityDecisionTypes as T } from "./types"

/**
 * The single authoritative entry point the permission pipeline calls.
 *
 * It sits after the existing hard veto and explicit deny and before the auto-return/pending split:
 * it applies the XDG strictness floor, runs the pure core over normalized facts and hands back a
 * recommendation plus the audit record. It can only *tighten* — `pass` leaves the existing pipeline
 * exactly as it was, and every failure fails closed to `ask`.
 */
export namespace KiloSecurityGate {
  export type Resolved = Readonly<{ pattern: string; action: PermissionV1.Action }>

  /**
   * A fresh read of everything a decision depends on and that can move while the reviewer is being
   * asked. Supplied by the caller because only it owns the ruleset, the agent and the sandbox
   * snapshot; the XDG block is re-read here, since this module already owns that source.
   */
  export type Live = Readonly<{
    resolved: readonly Resolved[]
    humanOnly: boolean
    containment?: T.Containment
    agent?: string
  }>

  export type Input = Readonly<{
    config: Pick<Config.Interface, "getGlobal">
    workspace: string
    source?: "builtin" | "mcp" | "unknown"
    permission: string
    patterns: readonly string[]
    metadata?: Record<string, unknown>
    sessionID: string
    callID?: string
    /** What the existing pipeline resolved for each pattern, in request order. */
    resolved: readonly Resolved[]
    /** True when an existing human-only or config-protection guard already forces a prompt. */
    humanOnly: boolean
    /** The agent identity this ask was resolved against, when the caller knows it. */
    agent?: string
    /**
     * True when this exact call was already stopped by the layer earlier in the turn. The reviewer
     * has no memory of the turn, so this is the one fact about a retry it could never see for
     * itself: the action looks as ordinary the second time as it did the first.
     */
    blocked?: boolean
    containment?: T.Containment & { probe_id?: string; checked_at?: number }
    /**
     * Re-reads the live authorization state. Called only after the reviewer returns, so an `allow`
     * that was computed against state the session has since left is dropped instead of applied.
     */
    live?: () => Effect.Effect<Live>
    /**
     * Progress sink. The reviewer stage runs inside this call, so without a record emitted before it
     * a caller cannot distinguish "no reviewer ran" from "a reviewer is deciding right now".
     */
    audit?: (record: SecurityDecisionAdapter.Audit) => Effect.Effect<void>
  }>

  const UNKNOWN_CONTAINMENT: T.Containment = {
    sandbox: "unknown",
    network: "allow",
    destinations: [],
    escalated: false,
  }

  function rank(action: PermissionV1.Action) {
    return action === "deny" ? 2 : action === "ask" ? 1 : 0
  }

  export const evaluate = Effect.fn("KiloSecurityGate.evaluate")(function* (input: Input) {
    if (!SecurityDecisionAdapter.enabled()) return undefined
    return yield* run(input).pipe(
      // A failure anywhere in the gate must not let the call through: fail closed to ask.
      Effect.catchCause(() => Effect.succeed(failClosed(input))),
    )
  })

  /** Fold the XDG floor over every resolved pattern. Pure over its inputs, so it can be re-run. */
  function fold(permission: string, resolved: readonly Resolved[], snapshot: SecurityAuthority.Snapshot) {
    let floor: SecurityAuthority.Floor = { action: "allow", authority: "untrusted", conflict: false }
    let raised = false
    for (const entry of resolved) {
      const current = SecurityAuthority.floor({
        permission,
        pattern: entry.pattern,
        effective: entry.action,
        xdg: snapshot.rules,
        failed: snapshot.failed,
      })
      if (rank(current.action) > rank(entry.action)) raised = true
      if (rank(current.action) > rank(floor.action)) floor = current
      else if (current.conflict) floor = { ...floor, conflict: true }
    }
    return { floor, raised }
  }

  const run = Effect.fn("KiloSecurityGate.run")(function* (input: Input) {
    const snapshot = yield* SecurityAuthority.snapshot(input.config)
    const { floor, raised } = fold(input.permission, input.resolved, snapshot)

    const directive = SecurityDecisionAdapter.evaluate(
      {
        source: input.source,
        permission: input.permission,
        patterns: input.patterns,
        metadata: input.metadata,
        sessionID: input.sessionID,
        callID: input.callID,
      },
      {
        workspace: input.workspace,
        effective: floor.action,
        humanOnly: input.humanOnly,
        floor,
        containment: input.containment ?? UNKNOWN_CONTAINMENT,
      },
    )

    // The floor is enforcement in its own right: when the XDG scope is stricter than the merged
    // ruleset resolved, the ask stands even where the core has no opinion of its own.
    if (raised && directive.decision !== "deny" && directive.decision !== "ask") {
      const result = R.result(R.AUTHORITY_FLOOR)
      return {
        decision: result.decision,
        rule_id: result.rule_id,
        reviewable: false,
        audit: { ...directive.audit, rule_id: result.rule_id, reason: result.reason, decision: result.decision },
      } satisfies SecurityDecisionAdapter.Directive
    }

    // The state this decision was actually made against. It is built from the values `run` just
    // read, not from a second read of the same input, so it is the true "before" of the comparison.
    const before = SecurityAuthorization.version({
      sessionID: input.sessionID,
      agent: input.agent,
      humanOnly: input.humanOnly,
      floor,
      raised,
      resolved: input.resolved,
      xdg: snapshot.rules,
      failed: snapshot.failed,
      containment: input.containment ?? UNKNOWN_CONTAINMENT,
    })
    return yield* narrow(directive, input, floor, before)
  })

  /** Re-read every live source and fold it into the comparable version again. */
  const current = Effect.fn("KiloSecurityGate.current")(function* (input: Input) {
    const live = input.live ? yield* input.live() : undefined
    const resolved = live?.resolved ?? input.resolved
    const snapshot = yield* SecurityAuthority.snapshot(input.config)
    const { floor, raised } = fold(input.permission, resolved, snapshot)
    return SecurityAuthorization.version({
      sessionID: input.sessionID,
      agent: live?.agent ?? input.agent,
      humanOnly: live?.humanOnly ?? input.humanOnly,
      floor,
      raised,
      resolved,
      xdg: snapshot.rules,
      failed: snapshot.failed,
      containment: live?.containment ?? input.containment ?? UNKNOWN_CONTAINMENT,
    })
  })

  /**
   * The reviewer stage. It runs after the deterministic decision and only where that decision is a
   * reviewable ask: never on a deny, never on a human-only ask, never where the XDG floor and the
   * effective rule disagree. It can only narrow this one call, and it never writes policy.
   */
  const narrow = Effect.fn("KiloSecurityGate.narrow")(function* (
    directive: SecurityDecisionAdapter.Directive,
    input: Input,
    floor: SecurityAuthority.Floor,
    before: string,
  ) {
    if (directive.decision !== "ask" || !directive.reviewable || !directive.review) return directive
    if (input.humanOnly || floor.conflict) return directive
    // Coming back at a boundary the layer already closed is not a fresh question, and confinement
    // does not make it one: a human answers this time, and the call is reported as what it now is.
    if (input.blocked) return { ...directive, reviewable: false }
    // Nothing is asked of a model that is not there, so nothing is reported as running either.
    if (!SecurityReviewer.bound()) return directive

    if (input.audit)
      yield* input
        .audit(
          SecurityDecisionAdapter.finalize(
            { ...directive.audit, reviewer: SecurityReviewer.RUNNING },
            "ask_pending",
            "security",
          ),
        )
        .pipe(Effect.catchCause(() => Effect.void))

    const reviewed = yield* SecurityReviewer.review(
      {
        decision: directive.decision,
        reason: directive.audit.reason,
        rule_id: directive.rule_id,
        requirements: directive.audit.requirements,
        reviewable: directive.reviewable,
      },
      directive.review,
    )

    // A verdict only narrows the call it was asked about. If any of the state that produced the
    // question moved while the model was answering, the answer is about a different call: keep the
    // deterministic ask. An unreadable live state counts as changed, so this fails closed too.
    if (reviewed.result.decision === "allow") {
      const after = yield* current(input).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (after !== before)
        return {
          ...directive,
          audit: {
            ...directive.audit,
            reviewer: {
              state: "keep_ask" as const,
              reason_code: SecurityAuthorization.CHANGED,
              ...(reviewed.outcome.latency_ms !== undefined ? { latency_ms: reviewed.outcome.latency_ms } : {}),
              ...(reviewed.outcome.attempts !== undefined ? { attempts: reviewed.outcome.attempts } : {}),
            },
          },
        } satisfies SecurityDecisionAdapter.Directive
    }

    return {
      ...directive,
      decision: reviewed.result.decision,
      audit: { ...directive.audit, reviewer: reviewed.outcome },
    } satisfies SecurityDecisionAdapter.Directive
  })

  function failClosed(input: Input): SecurityDecisionAdapter.Directive {
    const result = R.result(R.INTERNAL_ERROR)
    return {
      decision: result.decision,
      rule_id: result.rule_id,
      reviewable: false,
      audit: {
        schema: "kilo.security-decision/v1",
        policy_version: R.POLICY_VERSION,
        rule_id: result.rule_id,
        reason: result.reason,
        decision: result.decision,
        reviewer: SecurityReviewer.SKIPPED,
        reviewer_truncated: false,
        reviewer_binding: SecurityReviewer.attributed().reason,
        ...(SecurityReviewer.attributed().model ? { reviewer_model: SecurityReviewer.attributed().model } : {}),
        authority_level: "unknown",
        authority_basis: "none",
        authority_conflict: false,
        metadata_complete: false,
        metadata_truncated: false,
        containment: input.containment ?? UNKNOWN_CONTAINMENT,
        requirements: [],
        latency_ms: 0,
        ...(input.callID ? { callID: input.callID } : {}),
        sessionID: input.sessionID,
      },
    }
  }
}
