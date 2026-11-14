// kilocode_change - new file
import type { SecurityAuthority } from "./authority"
import type { SecurityDecisionTypes as T } from "./types"

/**
 * The authorization state a decision was made against.
 *
 * The reviewer stage is the one place in the layer that awaits: the model is asked while the rest
 * of the process keeps running, and in that window the session can gain a rule, switch agents,
 * toggle its sandbox or have its XDG block rewritten. A verdict computed against the old state and
 * applied to the new one is not a narrowing of that call — it is a decision about a call that no
 * longer exists, which is exactly how a monotonic layer stops being monotonic.
 *
 * So everything a decision depends on is folded into one comparable version string, taken before
 * the await and taken again — from freshly read state, never from the same captured input — after
 * it. A difference is not adjudicated: the reviewer's `allow` is simply dropped and the
 * deterministic `ask` stands, which is the outcome the call would have had with no reviewer at all.
 */
export namespace SecurityAuthorization {
  /** Reported on the reviewer outcome when the state moved out from under a verdict. */
  export const CHANGED = "AUTHORIZATION_CHANGED" as const

  export type Facts = Readonly<{
    sessionID: string
    /** The agent identity whose ruleset and defaults the decision was resolved against. */
    agent?: string
    /** An existing human-only or config-protection guard forcing a prompt. */
    humanOnly: boolean
    /** The XDG strictness floor the decision applied. */
    floor: SecurityAuthority.Floor
    /** Whether that floor raised the strictness of any pattern above the resolved ruleset. */
    raised: boolean
    /** What the pipeline resolved for each pattern, in request order. */
    resolved: readonly Readonly<{ pattern: string; action: string }>[]
    /** The raw XDG rules themselves: a rewritten user-global block changes the floor's meaning. */
    xdg: readonly Readonly<{ permission: string; pattern: string; action: string }>[]
    /** True when the XDG block could not be read at all. */
    failed: boolean
    /** The live confinement facts the decision treated as evidence. */
    containment: T.Containment
  }>

  function scalar(value: unknown): string {
    return JSON.stringify(value) ?? "null"
  }

  export function version(facts: Facts): string {
    const resolved = facts.resolved.map((entry) => `${scalar(entry.pattern)}:${entry.action}`).join(",")
    const xdg = facts.xdg.map((rule) => `${scalar(rule.permission)}:${scalar(rule.pattern)}:${rule.action}`).join(",")
    const containment = [
      facts.containment.sandbox,
      facts.containment.network,
      facts.containment.escalated ? "1" : "0",
      facts.containment.widened ? "1" : "0",
      [...facts.containment.destinations].sort().map(scalar).join("|"),
    ].join(":")
    return [
      "v1",
      scalar(facts.sessionID),
      scalar(facts.agent ?? ""),
      facts.humanOnly ? "1" : "0",
      facts.failed ? "1" : "0",
      `${facts.floor.action}:${facts.floor.authority}:${facts.floor.conflict ? "1" : "0"}:${facts.raised ? "1" : "0"}`,
      `[${resolved}]`,
      `[${xdg}]`,
      containment,
    ].join(" ")
  }
}
