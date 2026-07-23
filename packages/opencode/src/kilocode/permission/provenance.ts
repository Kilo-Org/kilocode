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
  export type Source = "agent" | "global" | "project" | "yolo" | "manual" | "default"

  /** A rule optionally carrying its origin. `source` is runtime-only, never persisted. */
  export type SourcedRule = Permission.Rule & { source?: Source }

  /** The approval recorded onto a tool call's metadata. */
  export type Approval = {
    source: Source
    /** Agent name when `source` is "agent". */
    agent?: string
    /** The winning rule, omitted for manual replies and the ask fallback. */
    rule?: { permission: string; pattern: string; action: Permission.Action }
  }

  /** Scope that last set each config permission key (global XDG vs local project). */
  export type Origins = Record<string, "global" | "local"> | undefined

  /** Origin of a config-derived or agent-default rule, keyed by its permission. */
  export function configSource(permission: string, origins: Origins): Source {
    const scope = origins?.[permission]
    if (scope === "global") return "global"
    if (scope === "local") return "project"
    return "agent"
  }

  /** Classify the winning rule of an auto-approval into an Approval payload. */
  export function classify(input: { rule?: Permission.Rule; agent: string; origins: Origins }): Approval {
    const rule = input.rule
    if (!rule) return { source: "default" }
    const tagged = (rule as SourcedRule).source
    const source =
      tagged ??
      // Untagged winning rules were contributed inside Permission.ask by saved global approvals.
      (rule.permission === "*" && rule.pattern === "*" ? "yolo" : configSource(rule.permission, input.origins))
    return {
      source,
      ...(source === "agent" ? { agent: input.agent } : {}),
      rule: { permission: rule.permission, pattern: rule.pattern, action: rule.action },
    }
  }
}
