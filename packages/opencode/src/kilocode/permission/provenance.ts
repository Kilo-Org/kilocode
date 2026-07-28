import type { Permission } from "@/permission"

/**
 * Explains *why* a tool call was allowed so clients can surface auto-approval to users.
 *
 * A permission rule is a plain object that flows through `Permission.evaluate`'s `findLast`
 * unchanged, so we hang an optional, non-schema `source` marker on each rule when we assemble
 * the ruleset. `evaluate`/`resolve` return the matched rule object as-is, letting us read that
 * marker back out to report the winning source.
 */
export namespace PermissionProvenance {
  /** Where the deciding rule came from. */
  export type Source = "agent" | "global" | "project" | "yolo" | "session" | "manual" | "default"

  /** A rule optionally carrying its origin. `source` is runtime-only, never persisted. */
  export type SourcedRule = Permission.Rule & { source?: Source }

  /** True for the broad allow rule that auto-approve (YOLO) mode installs. */
  function isYolo(rule: Permission.Rule) {
    return rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"
  }

  /** The approval recorded onto a tool call's metadata. */
  export type Approval = {
    source: Source
    /** Agent name when `source` is "agent". */
    agent?: string
    /** The winning rule, omitted for manual replies and the ask fallback. */
    rule?: { permission: string; pattern: string; action: Permission.Action }
  }

  export type Scope = "global" | "local"

  /**
   * Scope that last set each config permission pattern (global XDG vs local project).
   *
   * Keyed by permission then pattern, because global and project config can each contribute
   * different patterns under the same key (e.g. global `bash: {"git status": allow}` and project
   * `bash: {"npm test": allow}` both live under `bash`). A per-key scope would misreport the
   * pattern the other scope contributed, so provenance is tracked per pattern.
   */
  export type Origins = Record<string, Record<string, Scope>> | undefined

  /** Origin of a config-derived or agent-default rule, matched by permission + pattern. */
  export function configSource(permission: string, pattern: string, origins: Origins): Source {
    const scope = origins?.[permission]?.[pattern]
    if (scope === "global") return "global"
    if (scope === "local") return "project"
    return "agent"
  }

  /**
   * Tag agent-owned rules with their config origin (global/project) or the agent default.
   * These come from the agent's merged permission set.
   */
  export function tagAgent(ruleset: Permission.Ruleset, origins: Origins): SourcedRule[] {
    return ruleset.map((rule) => ({ ...rule, source: configSource(rule.permission, rule.pattern, origins) }))
  }

  /**
   * Tag session-scoped rules. The broad allow rule is auto-approve (YOLO) mode, which is stored
   * on the session; any other session rule is an explicit per-session runtime toggle.
   */
  export function tagSession(ruleset: Permission.Ruleset): SourcedRule[] {
    return ruleset.map((rule) => ({ ...rule, source: isYolo(rule) ? "yolo" : "session" }))
  }

  /**
   * Preserve an existing `approval` marker when a tool part's metadata is replaced.
   *
   * The approval is written once during `ask()`, but tools freely overwrite `state.metadata`
   * during execution and on completion. Carry the prior `approval` onto the replacement unless
   * the replacement sets its own.
   */
  export function carryApproval(
    prev: Record<string, unknown> | undefined,
    next: Record<string, unknown> | undefined,
  ) {
    if (!next || !prev?.approval || "approval" in next) return next
    return { ...next, approval: prev.approval }
  }

  /**
   * Classify the winning rule of an auto-approval into an Approval payload.
   *
   * Rules assembled by `askPermission` are tagged with their true origin, so we read the tag
   * directly. An untagged winner can only come from the saved global approvals that `Permission.ask`
   * merges internally: the broad allow rule there is YOLO mode, otherwise fall back to config origin.
   */
  export function classify(input: { rule?: Permission.Rule; agent: string; origins: Origins }): Approval {
    const rule = input.rule
    if (!rule) return { source: "default" }
    const source =
      (rule as SourcedRule).source ?? (isYolo(rule) ? "yolo" : configSource(rule.permission, rule.pattern, input.origins))
    return {
      source,
      ...(source === "agent" ? { agent: input.agent } : {}),
      rule: { permission: rule.permission, pattern: rule.pattern, action: rule.action },
    }
  }
}
