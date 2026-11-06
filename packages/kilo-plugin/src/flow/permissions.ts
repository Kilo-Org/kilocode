import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"

export const baselinePermissions = [
  { action: "read", resource: "*" },
  { action: "glob", resource: "*" },
  { action: "grep", resource: "*" },
] satisfies KiloFlowRpc.PermissionGrant[]

export function validatePermissions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  const action = permissions.find(
    (permission) => permission.action.length === 0 || permission.action.includes("*") || permission.action.includes("?"),
  )
  if (action) return `permission action ${action.action || "(empty)"} must name one concrete capability`
  const shellDirectory = permissions.find(
    (permission) => permission.action === "shell" && absoluteDirectoryWildcard(permission.resource),
  )
  if (shellDirectory)
    return `shell permission ${shellDirectory.resource} is an absolute directory wildcard, but shell resources must match command text; use external_directory: ${shellDirectory.resource} for the path and add separate shell permissions for the required commands, such as command-name *`
  const external = permissions.find(
    (permission) => permission.action === "external_directory" && !boundedExternal(permission.resource),
  )
  if (external)
    return `external_directory permission ${external.resource} must use a bounded absolute wildcard below a directory`
}

export function flowPermissions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  return [...baselinePermissions, ...permissions].filter(
    (permission, index, all) =>
      all.findIndex((item) => item.action === permission.action && item.resource === permission.resource) === index,
  )
}

export function permissionInstructions(
  permissions: readonly KiloFlowRpc.PermissionGrant[],
  tools: readonly string[] = [],
) {
  const available = tools.length === 0 ? ["- None."] : tools.toSorted().map((tool) => `- ${tool}`)
  const allowed =
    permissions.length === 0
      ? ["- No tool permissions are approved."]
      : permissions.map((permission) => `- ${permission.action}: ${permission.resource}`)
  return [
    "You are running an unattended Flow. No user is present to approve additional permissions.",
    "Available tools for this run:",
    ...available,
    "Approved permission patterns:",
    ...allowed,
    "Everything not matched by an approved action and resource pattern is denied.",
    "How permission resources are matched:",
    "- read and edit match Location-relative file paths; write, patch, and opencode use the edit action.",
    "- glob and grep match their pattern text, not the directory searched.",
    "- shell matches every parsed command in a compound command separately.",
    "- webfetch matches the requested URL and every redirect URL; websearch matches the query text.",
    "- Paths outside the Location also require an external_directory rule for the containing directory wildcard.",
    "- MCP tool actions use the exposed tool name and currently request resource `*`.",
    "Choose tool inputs that match these patterns exactly. Prefer dedicated read, edit, or write tools over shell redirection when their actions are approved.",
    "Do not make exploratory or preflight tool calls outside the allowlist, and do not work around or retry a denied operation. If the allowlist cannot complete the task, report the missing action and resource.",
  ].join("\n")
}

export function permissionSummary(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  if (permissions.length === 0) return "no unattended permissions"
  return `unattended permissions ${permissions.map((permission) => `${permission.action}: ${permission.resource}`).join(", ")}`
}

function boundedExternal(resource: string) {
  const wildcard = resource.search(/[?*]/)
  if (wildcard < 0) return false
  const prefix = resource.slice(0, wildcard).replaceAll("\\", "/")
  const parts = (prefix.match(/^[A-Za-z]:\//) ? prefix.slice(3) : prefix).split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return false
  if (/^[A-Za-z]:\//.test(prefix)) return true
  if (!prefix.startsWith("/")) return false
  return true
}

function absoluteDirectoryWildcard(resource: string) {
  return resource.replaceAll("\\", "/").endsWith("/*") && boundedExternal(resource)
}
