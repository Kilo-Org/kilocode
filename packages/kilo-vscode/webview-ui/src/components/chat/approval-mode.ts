export type ApprovalMode = "ask" | "approveForMe" | "approveAll"

type Flags = { auto: boolean; me: boolean }
type Request = "toggleAutoApprove" | "toggleApproveForMe"

/** Approve-for-me and auto-approve exclude each other, so at most one is on. */
export function approvalMode(flags: Flags): ApprovalMode {
  if (flags.auto) return "approveAll"
  if (flags.me) return "approveForMe"
  return "ask"
}

/**
 * The single host message that moves from the current mode to `next`. The host
 * turns the other mode off, so one toggle is always enough.
 */
export function approvalRequest(flags: Flags, next: ApprovalMode): Request | undefined {
  const from = approvalMode(flags)
  if (from === next) return undefined
  if (next === "approveAll") return "toggleAutoApprove"
  if (next === "approveForMe") return "toggleApproveForMe"
  return from === "approveAll" ? "toggleAutoApprove" : "toggleApproveForMe"
}
