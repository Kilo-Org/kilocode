import type { PermissionRequest } from "@opencode/client"
import { KiloPermission } from "@opencode/schema/kilocode/permission"

/** Requests that must always be answered by a person, even with auto-approve on. */
export function canAutoApprove(request: PermissionRequest): boolean {
  return (
    !KiloPermission.requiresPerson(request.metadata) &&
    request.action !== "sandbox_escalation" &&
    request.action !== "browser_sensitive" &&
    request.metadata?.["sandboxEscalation"] !== true &&
    request.metadata?.["browserSensitive"] !== true
  )
}
