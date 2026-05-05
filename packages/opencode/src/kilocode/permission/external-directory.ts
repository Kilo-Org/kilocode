import { evaluate as evalRule } from "@/permission/evaluate"
import { PermissionRule, type Ruleset } from "@/kilocode/permission/rule"

function rules(permission: string, ruleset?: Ruleset) {
  if (!ruleset) return []
  if (permission !== "external_directory") return ruleset
  return ruleset.filter((rule) => !PermissionRule.mode(rule))
}

export namespace ExternalDirectoryPermission {
  export function evaluate(permission: string, pattern: string, ...sets: Array<Ruleset | undefined>) {
    return evalRule(
      permission,
      pattern,
      ...sets.map((set) => rules(permission, set)),
    )
  }
}
