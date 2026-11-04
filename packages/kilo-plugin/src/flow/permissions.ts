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
  const external = permissions.find(
    (permission) => permission.action === "external_directory" && !boundedExternal(permission.resource),
  )
  if (external)
    return `external_directory permission ${external.resource} must use a bounded absolute wildcard below a directory`
}

export function flowPermissions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  return [
    ...baselinePermissions,
    ...permissions.map((permission) =>
      permission.action === "external_directory" ? permission : { ...permission, resource: "*" },
    ),
  ].filter(
    (permission, index, all) =>
      all.findIndex((item) => item.action === permission.action && item.resource === permission.resource) === index,
  )
}

export function permissionInstructions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  const allowed =
    permissions.length === 0
      ? ["- No tool permissions are approved."]
      : permissions.map((permission) => `- ${permission.action}: ${permission.resource}`)
  return [
    "You are running an unattended Flow. No user is present to approve additional permissions.",
    "Approved permission patterns:",
    ...allowed,
    "Permission resources are wildcard patterns matched against actual tool requests. Choose tool inputs that match these patterns exactly.",
    "For shell calls, every parsed command in a compound command must match an approved shell pattern. Prefer dedicated read, edit, or write tools over shell redirection when their actions are approved.",
    "Do not make exploratory or preflight tool calls outside the allowlist, and do not work around or repeatedly retry a denied operation. If the allowlist cannot complete the task, report the missing action and resource.",
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
