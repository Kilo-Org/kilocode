import type { Permission } from "@opencode/schema/permission"

export type PermissionLevel = Permission.Effect
export type PermissionRule = Permission.Rule
export type PermissionRuleset = Permission.Rule[]

const RESTRICTION_ORDER: Record<PermissionLevel, number> = { allow: 0, ask: 1, deny: 2 }

// The level shown for a tool with no configured rule. The first rule allows every tool, then the two tools that
// ask by default.
export const DEFAULT_RULES: PermissionRuleset = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "shell", resource: "*", effect: "ask" },
]

// The webview cannot import core, so this mirrors `core/util/wildcard.ts` so levels match the cli evaluation.
export function matchAction(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", "s").test(normalized)
}

// Only resource "*" rules describe a tool's general level.
export function effectiveRuleLevel(rules: PermissionRuleset | undefined, action: string): PermissionLevel {
  const list = rules ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.resource === "*" && matchAction(action, item.action)) return item.effect
  }
  return "ask"
}

export function effectiveConfigLevel(
  rules: PermissionRuleset | undefined,
  action: string,
  defaults: PermissionRuleset = DEFAULT_RULES,
): PermissionLevel {
  return effectiveRuleLevel([...defaults, ...(rules ?? [])], action)
}

export function mostRestrictive(levels: PermissionLevel[]): PermissionLevel {
  return levels.reduce<PermissionLevel>(
    (best, level) => (RESTRICTION_ORDER[level] > RESTRICTION_ORDER[best] ? level : best),
    levels[0] ?? "allow",
  )
}

/** The rule that sets the whole tool, exactly named, or undefined when the tool inherits. */
export function wildcardRule(rules: PermissionRuleset, action: string): PermissionRule | undefined {
  for (let i = rules.length - 1; i >= 0; i--) {
    const item = rules[i]
    if (item.action === action && item.resource === "*") return item
  }
  return undefined
}

export function inheritedTool(rules: PermissionRuleset, action: string): boolean {
  return wildcardRule(rules, action) === undefined
}

/** The per-pattern rules of one tool, in order. */
export function toolExceptions(rules: PermissionRuleset, action: string): PermissionRule[] {
  return rules.filter((item) => item.action === action && item.resource !== "*")
}

function replaceTool(rules: PermissionRuleset, action: string, next: PermissionRule[]): PermissionRuleset {
  const kept: PermissionRule[] = []
  let inserted = false
  for (const rule of rules) {
    if (rule.action !== action) {
      kept.push(rule)
      continue
    }
    if (!inserted) {
      kept.push(...next)
      inserted = true
    }
  }
  if (!inserted) kept.push(...next)
  return kept
}

/** Set the general level of a tool, keeping its pattern exceptions (granular rows). */
export function setWildcardLevel(rules: PermissionRuleset, action: string, level: PermissionLevel): PermissionRuleset {
  return replaceTool(rules, action, [
    { action, resource: "*", effect: level },
    ...toolExceptions(rules, action),
  ])
}

/** Inherit the general level of a tool, keeping its pattern exceptions. */
export function clearWildcardLevel(rules: PermissionRuleset, action: string): PermissionRuleset {
  return replaceTool(rules, action, toolExceptions(rules, action))
}

/** Set the general level of a tool and drop any pattern exceptions, for simple rows. */
export function setSimpleLevel(rules: PermissionRuleset, action: string, level: PermissionLevel): PermissionRuleset {
  return replaceTool(rules, action, [{ action, resource: "*", effect: level }])
}

/** Inherit a tool and drop its rules, for simple rows. */
export function clearSimpleLevel(rules: PermissionRuleset, action: string): PermissionRuleset {
  return replaceTool(rules, action, [])
}

export function setExceptionLevel(
  rules: PermissionRuleset,
  action: string,
  resource: string,
  level: PermissionLevel,
): PermissionRuleset {
  const wildcard = wildcardRule(rules, action)
  const current = toolExceptions(rules, action)
  const known = current.some((item) => item.resource === resource)
  const exceptions = known
    ? current.map((item) => (item.resource === resource ? { action, resource, effect: level } : item))
    : [...current, { action, resource, effect: level }]
  return replaceTool(rules, action, [...(wildcard ? [wildcard] : []), ...exceptions])
}

export function addExceptionLevel(
  rules: PermissionRuleset,
  action: string,
  resource: string,
): PermissionRuleset {
  return setExceptionLevel(rules, action, resource, "allow")
}

export function removeExceptionLevel(
  rules: PermissionRuleset,
  action: string,
  resource: string,
): PermissionRuleset {
  const wildcard = wildcardRule(rules, action)
  const exceptions = toolExceptions(rules, action).filter((item) => item.resource !== resource)
  return replaceTool(rules, action, [...(wildcard ? [wildcard] : []), ...exceptions])
}

export function setGroupedLevel(rules: PermissionRuleset, actions: string[], level: PermissionLevel): PermissionRuleset {
  return actions.reduce((next, action) => setSimpleLevel(next, action, level), rules)
}

export function clearGroupedLevel(rules: PermissionRuleset, actions: string[]): PermissionRuleset {
  return actions.reduce((next, action) => clearSimpleLevel(next, action), rules)
}
