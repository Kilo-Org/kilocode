import type { PermissionRequest } from "@opencode/client"
import { createMemo, type Accessor } from "solid-js"
import { canAutoApprove } from "../../../src/shared/auto-approve-eligibility"
import { createSettledValue } from "./settled-value"

const AUTO_APPROVE_GRACE_MS = 250

/** Give the host's reply a head start, without changing the pending permissions used to gate actions. */
export function createPermissionPresentation(input: {
  session: Accessor<string | undefined>
  requests: Accessor<PermissionRequest[]>
  autoApprove: Accessor<boolean>
}) {
  const request = createMemo(() => {
    const requests = input.requests()
    // A request that needs a person must not wait behind another agent's auto-approval.
    return (input.autoApprove() ? requests.find((item) => !canAutoApprove(item)) : undefined) ?? requests[0]
  })
  const key = createMemo(() => {
    const item = request()
    return item ? JSON.stringify([input.session(), item.sessionID, item.id]) : undefined
  })
  const delay = createMemo(() => {
    const item = request()
    return item && input.autoApprove() && canAutoApprove(item) ? AUTO_APPROVE_GRACE_MS : 0
  })
  const settled = createSettledValue(key, delay, undefined)
  // Only show a request still pending in this view. A slow or failed host reply leaves it visible and actionable.
  return createMemo(() => (!delay() || key() === settled() ? request() : undefined))
}
