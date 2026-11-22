import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionRule, type Rule } from "@/kilocode/permission/rule"

function guard(pattern: string) {
  // File-path rules follow the volume's case rules, so use the same decision the rules use.
  const fold = PermissionV2.ignoresCase("read")
  if (Wildcard.match(pattern, "*.env.example", fold)) return
  if (Wildcard.match(pattern, "*.env", fold)) return "*.env"
  if (Wildcard.match(pattern, "*.env.*", fold)) return "*.env.*"
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
