export type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export type Ruleset = ReadonlyArray<Rule>

/**
 * A rule the service downgraded to "ask" by itself. Marked at runtime only, never
 * persisted: a broad allow rule cannot relax it, and neither can a plugin.
 */
export type HardenedRule = Rule & { hardened?: true }

export namespace PermissionRule {
  export function hardened(rule: Rule) {
    return (rule as HardenedRule).hardened === true
  }

  export function broad(rule: Rule) {
    return rule.permission === "*" || rule.pattern === "*"
  }

  export function mode(rule: Rule) {
    return rule.permission === "*" && rule.pattern === "*" && rule.action === "deny"
  }
}
