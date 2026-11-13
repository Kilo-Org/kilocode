export * as KiloFlowPermissions from "./flow-permissions.js"

import type { PermissionGrant } from "./flow.js"

// The unattended permission rules of a Flow. The flow plugin enforces them on create and update and the `/periodic`
// wizard checks each grant as it is entered, so both accept exactly the same allowlists.

/** Repository-local read access every Flow receives. */
export const baseline: readonly PermissionGrant[] = [
  { action: "read", resource: "*" },
  { action: "glob", resource: "*" },
  { action: "grep", resource: "*" },
]

/** Why one grant is not allowed, or undefined when it is. */
export function check(permission: PermissionGrant) {
  if (permission.action.length === 0 || permission.action.includes("*") || permission.action.includes("?"))
    return `permission action ${permission.action || "(empty)"} must name one concrete capability`
  if (permission.action === "shell" && absoluteDirectoryWildcard(permission.resource))
    return `shell permission ${permission.resource} is an absolute directory wildcard, but shell resources must match command text; use external_directory: ${permission.resource} for the path and add separate shell permissions for the required commands, such as command-name *`
  if (permission.action === "external_directory" && !boundedExternal(permission.resource))
    return `external_directory permission ${permission.resource} must use a bounded absolute wildcard below a directory`
}

/** The first problem in an allowlist, checked rule by rule in the order `check` applies them. */
export function validate(permissions: readonly PermissionGrant[]) {
  return permissions.map(check).find((problem) => problem !== undefined)
}

/** True for one of the baseline grants, which every Flow holds without asking. */
export function inBaseline(permission: PermissionGrant) {
  return baseline.some((item) => item.action === permission.action && item.resource === permission.resource)
}

function boundedExternal(resource: string) {
  const wildcard = resource.search(/[?*]/)
  if (wildcard < 0) return false
  const prefix = resource.slice(0, wildcard).replaceAll("\\", "/")
  const parts = (prefix.match(/^[A-Za-z]:\//) ? prefix.slice(3) : prefix).split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return false
  if (/^[A-Za-z]:\//.test(prefix)) return true
  return prefix.startsWith("/")
}

function absoluteDirectoryWildcard(resource: string) {
  return resource.replaceAll("\\", "/").endsWith("/*") && boundedExternal(resource)
}
