import { type Rule } from "./rule"

export namespace AgentManagerPermission {
  /**
   * Prompting or stopping an existing Agent Manager session has an external side effect.
   * Broad approvals for legacy session creation must not silently grant it.
   */
  export function harden(permission: string, pattern: string, rule: Rule): Rule {
    if (permission !== "agent_manager" || !["prompt", "stop"].includes(pattern) || rule.action !== "allow") return rule
    if (rule.permission === "agent_manager" && rule.pattern === pattern) return rule
    return { permission, pattern, action: "ask" }
  }
}
