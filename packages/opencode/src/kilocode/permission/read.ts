import { Wildcard } from "@/util/wildcard"
import { PermissionRule, type Rule, type Ruleset } from "@/kilocode/permission/rule"

function guard(pattern: string) {
  if (Wildcard.match(pattern, "*.env.example")) return
  if (Wildcard.match(pattern, "*.env")) return "*.env"
  if (Wildcard.match(pattern, "*.env.*")) return "*.env.*"
}

export namespace ReadPermission {
  /** Last explicit non-broad read-allow that matches this file, if any. */
  export function explicitAllow(pattern: string, ruleset?: Ruleset): Rule | undefined {
    return ruleset
      ?.filter((rule) => rule.permission === "read" && rule.action === "allow" && !PermissionRule.broad(rule))
      .findLast((rule) => Wildcard.match(pattern, rule.pattern))
  }

  export function harden(permission: string, pattern: string, rule: Rule, ruleset?: Ruleset): Rule {
    if (permission !== "read") return rule
    if (rule.action === "deny") return rule
    const match = guard(pattern)
    if (!match) return rule
    const explicit = explicitAllow(pattern, ruleset)
    if (explicit) return { permission: "read", pattern: explicit.pattern, action: "allow" }
    if (rule.action !== "allow") return rule
    if (!PermissionRule.broad(rule)) return rule
    return { permission, pattern: match, action: "ask" }
  }
}
