import { Wildcard } from "@/util/wildcard"
import { PermissionRule, type Rule } from "@/kilocode/permission/rule"

function guard(pattern: string) {
  if (Wildcard.match(pattern, "*.env.example")) return
  if (Wildcard.match(pattern, "*.env")) return "*.env"
  if (Wildcard.match(pattern, "*.env.*")) return "*.env.*"
}

export namespace ReadPermission {
  export function harden(permission: string, pattern: string, rule: Rule): Rule {
    if (permission !== "read") return rule
    if (rule.action !== "allow") return rule
    const match = guard(pattern)
    if (!match) return rule
    if (!PermissionRule.broad(rule)) return rule
    return { permission, pattern: match, action: "ask" }
  }
}
