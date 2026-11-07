import { Wildcard } from "@/util/wildcard"
import { PermissionRule, type HardenedRule, type Rule } from "@/kilocode/permission/rule"

function guard(pattern: string) {
  if (Wildcard.match(pattern, "*.env.example")) return
  if (Wildcard.match(pattern, "*.env")) return "*.env"
  if (Wildcard.match(pattern, "*.env.*")) return "*.env.*"
}

export namespace ReadPermission {
  export function harden(permission: string, pattern: string, rule: Rule): HardenedRule {
    if (permission !== "read") return rule
    const match = guard(pattern)
    if (!match) return rule
    // An ask on a secret file is one this service insists on, however it arose.
    if (rule.action === "ask") return { ...rule, hardened: true }
    if (rule.action !== "allow") return rule
    if (!PermissionRule.broad(rule)) return rule
    return { permission, pattern: match, action: "ask", hardened: true }
  }
}
