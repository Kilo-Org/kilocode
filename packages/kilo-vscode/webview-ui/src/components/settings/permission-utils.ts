import type { PermissionLevel, PermissionRuleItem } from "../../types/messages"

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
