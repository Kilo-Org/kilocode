import { evaluate as evalRule } from "@/permission/evaluate"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

type Ruleset = Rule[]

function mode(rule: Rule) {
  return rule.permission === "*" && rule.pattern === "*" && rule.action === "deny"
}

function rules(permission: string, ruleset?: Ruleset) {
  if (!ruleset) return []
  if (permission !== "external_directory") return ruleset
  return ruleset.filter((rule) => !mode(rule))
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
