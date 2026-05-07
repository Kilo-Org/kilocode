export type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export type Ruleset = Rule[]

export namespace PermissionRule {
  export function broad(rule: Rule) {
    return rule.permission === "*" || rule.pattern === "*"
  }

  export function mode(rule: Rule) {
    return rule.permission === "*" && rule.pattern === "*" && rule.action === "deny"
  }
}
