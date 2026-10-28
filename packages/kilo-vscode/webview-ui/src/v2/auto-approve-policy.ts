import type { PermissionRequest } from "@opencode/client"

/** Cap on remembered request IDs, so a long-lived webview does not grow the set forever. */
export const RESPONDED_LIMIT = 1000

/**
 * True when auto-approve should reply to this request. v1 replied once per request, only while
 * active, and never auto-approved sandbox-escalation prompts
 * (packages/kilo-vscode/src/commands/toggle-auto-approve.ts).
 */
export function shouldApprove(
  request: PermissionRequest,
  enabled: boolean,
  responded: ReadonlySet<string>,
): boolean {
  if (!enabled) return false
  if (responded.has(request.id)) return false
  return request.metadata?.["sandboxEscalation"] !== true
}

export type AutoApproveReply = (request: PermissionRequest) => Promise<unknown>

/**
 * Framework-free core of the auto-approve reaction. It dedupes requests across the permission
 * store and the pending sweep, so a request picked up by both triggers is still replied to once.
 */
export function createAutoApproveController(reply: AutoApproveReply) {
  const responded = new Set<string>()
  let enabled = false

  const approve = (request: PermissionRequest) => {
    if (!shouldApprove(request, enabled, responded)) return
    responded.add(request.id)
    for (const oldest of responded) {
      if (responded.size <= RESPONDED_LIMIT) break
      responded.delete(oldest)
    }
    // A failed reply leaves the request pending, so allow a later sweep to retry it.
    void reply(request).catch(() => responded.delete(request.id))
  }

  return {
    setEnabled(value: boolean) {
      enabled = value
    },
    /** Approve a batch: a permission-store read or the result of the pending sweep. */
    approve(requests: Iterable<PermissionRequest>) {
      for (const request of requests) approve(request)
    },
  }
}
