import { type HardenedRule, type Rule } from "./rule"

export namespace AgentManagerPermission {
  /**
   * Prompting, stopping, moving, or answering a pending question on an existing Agent Manager session has an
   * external side effect. Broad approvals for legacy session creation must not silently grant it.
   */
  export function harden(permission: string, pattern: string, rule: Rule): HardenedRule {
    if (permission !== "agent_manager" || !["prompt", "stop", "move", "answer"].includes(pattern)) return rule
    if (rule.permission === "agent_manager" && rule.pattern === pattern) return rule
    if (rule.action === "ask") return { ...rule, hardened: true }
    if (rule.action !== "allow") return rule
    return { permission, pattern, action: "ask", hardened: true }
  }
}
