import { type Rule } from "./rule"

export namespace AgentManagerPermission {
  /**
   * Prompting an existing Agent Manager session has an external side effect.
   * Broad approvals for legacy session creation must not silently grant it.
   */
  export function harden(permission: string, pattern: string, rule: Rule): Rule {
    if (permission !== "agent_manager" || pattern !== "prompt" || rule.action !== "allow") return rule
    if (rule.permission === "agent_manager" && rule.pattern === "prompt") return rule
    return { permission, pattern, action: "ask" }
  }
}
