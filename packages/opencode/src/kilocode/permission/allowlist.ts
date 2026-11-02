import { Wildcard } from "@opencode-ai/core/util/wildcard"
import type { Ruleset } from "@/kilocode/permission/rule"

// A scoped policy can be written either as an explicit catch-all deny or as an
// allowlist baseline: `"*": deny` followed by path allows. `Permission.evaluate`
// only ever sees the catch-all for a literal "*" pattern, so code that needs to
// tell a real blanket deny apart from an allowlist baseline has to inspect the
// rules that follow it. `editRestrictions` in `src/kilocode/agent/index.ts`
// encodes the same distinction for the built-in plan guard.
export namespace PermissionAllowlist {
  /** Last rule that applies `permission`'s catch-all pattern, if any. */
  export function catchAll(permission: string, rules: Ruleset) {
    return rules.findLast((rule) => Wildcard.match(permission, rule.permission) && rule.pattern === "*")
  }

  /** True when a catch-all deny is only the baseline for later path exceptions. */
  export function exceptions(permission: string, rules: Ruleset) {
    const rule = catchAll(permission, rules)
    if (rule?.action !== "deny") return false
    const index = rules.lastIndexOf(rule)
    return rules
      .slice(index + 1)
      .some((next) => Wildcard.match(permission, next.permission) && next.pattern !== "*" && next.action !== "deny")
  }
}
