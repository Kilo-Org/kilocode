import type { PermissionConfig, PermissionLevel, PermissionRule, PermissionRuleItem } from "../../types/messages"

export type PermissionPatch = PermissionConfig

const RESTRICTION_ORDER: Record<PermissionLevel, number> = { allow: 0, ask: 1, deny: 2 }

function matchTool(tool: string, pattern: string): boolean {
  if (pattern === tool || pattern === "*") return true
  if (!pattern.includes("*")) return false
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(tool)
}

export function effectiveRuleLevel(rules: PermissionRuleItem[] | undefined, tool: string): PermissionLevel {
  const list = rules ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.pattern === "*" && matchTool(tool, item.permission)) return item.action
  }
  return "ask"
}

export function mostRestrictive(levels: PermissionLevel[]): PermissionLevel {
  return levels.reduce<PermissionLevel>(
    (best, level) => (RESTRICTION_ORDER[level] > RESTRICTION_ORDER[best] ? level : best),
    levels[0] ?? "allow",
  )
}

export function wildcardAction(rule: PermissionRule | undefined, fallback: PermissionLevel): PermissionLevel {
  if (!rule) return fallback
  if (typeof rule === "string") return rule
  if (rule === null) return fallback
  return rule["*"] ?? fallback
}

export function inheritedWildcard(rule: PermissionRule | undefined): boolean {
  if (!rule) return true
  if (typeof rule === "string") return false
  if (rule === null) return true
  return rule["*"] === undefined || rule["*"] === null
}

export function permissionExceptions(
  rule: PermissionRule | undefined,
): Array<{ pattern: string; action: PermissionLevel }> {
  if (!rule || typeof rule === "string") return []
  return Object.entries(rule)
    .filter(([key, action]) => key !== "*" && action !== null)
    .map(([pattern, action]) => ({ pattern, action: action as PermissionLevel }))
}

export function setGroupedPatch(ids: string[], level: PermissionLevel): PermissionPatch {
  const patch: PermissionPatch = {}
  for (const id of ids) patch[id] = level
  return patch
}

export function clearGroupedPatch(ids: string[]): PermissionPatch {
  const patch: PermissionPatch = {}
  for (const id of ids) patch[id] = null
  return patch
}

export function setWildcardPatch(
  rule: PermissionRule | undefined,
  tool: string,
  level: PermissionLevel,
): PermissionPatch {
  const excs = permissionExceptions(rule)
  if (excs.length === 0) return { [tool]: level }
  const obj: Record<string, PermissionLevel | null> = { "*": level }
  for (const exc of excs) obj[exc.pattern] = exc.action
  return { [tool]: obj }
}

export function clearWildcardPatch(rule: PermissionRule | undefined, tool: string): PermissionPatch {
  const excs = permissionExceptions(rule)
  if (excs.length === 0) return { [tool]: null }
  return { [tool]: { "*": null } }
}

export function setExceptionPatch(
  rule: PermissionRule | undefined,
  tool: string,
  pattern: string,
  level: PermissionLevel,
): PermissionPatch {
  const base: Record<string, PermissionLevel | null> =
    typeof rule === "string" || rule === null ? { "*": rule } : { ...(rule ?? {}) }
  base[pattern] = level
  return { [tool]: base }
}

export function addExceptionPatch(rule: PermissionRule | undefined, tool: string, pattern: string): PermissionPatch {
  return setExceptionPatch(rule, tool, pattern, "allow")
}

export function removeExceptionPatch(
  rule: PermissionRule | undefined,
  tool: string,
  pattern: string,
): PermissionPatch | undefined {
  if (!rule || typeof rule === "string") return undefined
  return { [tool]: { [pattern]: null } }
}
