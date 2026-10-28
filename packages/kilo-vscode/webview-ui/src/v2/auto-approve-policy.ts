import type { PermissionRequest } from "@opencode/client"

/** Cap on remembered request IDs, so a long-lived webview does not grow the set forever. */
export const RESPONDED_LIMIT = 1000

/**
 * True when auto-approve should reply to this request. v1 replied once per request and never
 * auto-approved sandbox-escalation prompts (packages/kilo-vscode/src/commands/toggle-auto-approve.ts).
 */
export function shouldApprove(request: PermissionRequest, responded: ReadonlySet<string>): boolean {
  if (responded.has(request.id)) return false
  return request.metadata?.["sandboxEscalation"] !== true
}
