import type { PermissionRequest } from "@opencode/client"

/** Requests that must always be answered by a person, even with auto-approve on. */
export function canAutoApprove(request: PermissionRequest): boolean {
  return (
    request.action !== "sandbox_escalation" &&
    request.action !== "browser_sensitive" &&
    request.metadata?.["sandboxEscalation"] !== true &&
    request.metadata?.["browserSensitive"] !== true
  )
}
