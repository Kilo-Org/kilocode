import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

// kilocode_change start - depth-aware parent-session inheritance; nested subagents
// must not accumulate session-local denies (#EST-1825).
/**
 * Build the `permission` ruleset for a subagent's session when it is spawned
 * via the task tool.
 *
 * For the immediate child of a primary/delegating agent (`depth === 0`), the
 * parent session's deny rules and `external_directory` rules are copied as
 * hard ceilings. Deeper descendants (`depth > 0`) only inherit
 * `external_directory` rules; other parent session denies are session-local
 * and must not leak across the subagent boundary.
 *
 * Default `todowrite` and `task` denies are added if the subagent's own
 * ruleset doesn't already permit them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  depth?: number
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const inherited =
    input.depth && input.depth > 0
      ? input.parentSessionPermission.filter((rule) => rule.permission === "external_directory")
      : input.parentSessionPermission.filter(
          (rule) => rule.permission === "external_directory" || rule.action === "deny",
        )
  return [
    ...inherited,
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}
// kilocode_change end
