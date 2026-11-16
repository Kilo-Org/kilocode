import type { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { KiloFlowPermissions } from "@opencode/schema/kilocode/flow-permissions"

// The rules live in the schema package, which the `/periodic` wizard shares.
export const validatePermissions = KiloFlowPermissions.validate

export function flowPermissions(permissions: readonly KiloFlowRpc.PermissionGrant[]) {
  return [...KiloFlowPermissions.baseline, ...permissions].filter(
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
