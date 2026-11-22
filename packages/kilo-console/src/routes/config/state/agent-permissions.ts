import type { AgentPayload } from "../../../client"
import { sorted } from "../../../shared/utils"
import type { PermissionAction } from "./permissions"

export type Permission = NonNullable<AgentPayload["permission"]>

export function toPermission(input: unknown): Permission {
  if (!Array.isArray(input)) return record(input) as Permission
  // Null-prototype maps keep writes own, so __proto__ or constructor never hits an inherited member or setter.
  const result = Object.create(null) as Record<string, Record<string, PermissionAction>>
  for (const entry of input) {
    const rule = record(entry)
    const tool = rule.permission
    const action = rule.action
    if (typeof tool !== "string" || !tool) continue
    if (action !== "allow" && action !== "deny" && action !== "ask") continue
    const pattern = string(rule.pattern) || "*"
    const map = result[tool] ?? (Object.create(null) as Record<string, PermissionAction>)
    map[pattern] = action
    result[tool] = map
  }
  return result as Permission
}

export function split(input: unknown) {
  const entries = Object.entries(toPermission(input))
  return {
    tools: sorted(entries.filter(([, value]) => value === "allow").map(([key]) => key)),
    permission: Object.fromEntries(entries.filter(([, value]) => value !== "allow")) as Permission,
  }
}

export function addRule(
  permission: Permission,
  tool: string,
  pattern: string,
  action: PermissionAction,
  base?: PermissionAction,
): Permission {
  const cur = permission[tool] ?? base
  const map: Record<string, unknown> = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {}
  if (typeof cur === "string") map["*"] = cur
  map[pattern] = action
  return { ...permission, [tool]: map }
}

export function removeRule(permission: Permission, item: { tool: string; pattern: string }): Permission {
  const next = { ...permission }
  const map: Record<string, unknown> = { ...record(next[item.tool]) }
  delete map[item.pattern]
  const keys = Object.keys(map)
  if (!keys.length) {
    delete next[item.tool]
    return next
  }
  const only = keys.length === 1 && keys[0] === "*"
  const value = map["*"]
  // A scalar "allow" belongs to the agent tool allowlist rather than the
  // permission map, so an allow catch-all stays a map. Only ask and deny
  // become scalars.
  if (only && (value === "ask" || value === "deny")) {
    next[item.tool] = value
    return next
  }
  next[item.tool] = map
  return next
}

function record(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}

function string(input: unknown) {
  if (typeof input === "string") return input
  return ""
}
