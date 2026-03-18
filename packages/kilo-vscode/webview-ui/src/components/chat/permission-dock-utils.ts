import type { PermissionRule } from "../../types/messages"

export type RuleDecision = "approved" | "denied" | "pending"

/**
 * Check which rules are already saved in the user's config and return
 * their initial toggle states (approved/denied). Rules not found in
 * the config are omitted (they default to "pending").
 */
export function savedRuleStates(rules: string[], saved: PermissionRule | undefined): Record<number, RuleDecision> {
  const result: Record<number, RuleDecision> = {}
  for (let i = 0; i < rules.length; i++) {
    const pattern = rules[i]
    const action = typeof saved === "string" ? (pattern === "*" ? saved : undefined) : saved?.[pattern]
    if (action === "allow") result[i] = "approved"
    if (action === "deny") result[i] = "denied"
  }
  return result
}
