import type { AgentPayload } from "../../../client"
import type { PermissionAction } from "./permissions"

export type Permission = NonNullable<AgentPayload["permission"]>

export function addRule(permission: Permission, tool: string, pattern: string, action: PermissionAction): Permission {
  const cur = permission[tool]
  const map: Record<string, unknown> = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {}
  if (typeof cur === "string" && map["*"] === undefined) map["*"] = cur
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
