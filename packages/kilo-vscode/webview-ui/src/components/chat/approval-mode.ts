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
 * The host messages that move from the current mode to `next`. The host turns the
 * other mode off, so one toggle is enough from any normal state. If both flags are
 * briefly on, the menu shows Approve all, so each flag is toggled to match `next`.
 */
export function approvalRequest(flags: Flags, next: ApprovalMode): Request[] {
  if (flags.auto && flags.me) {
    const want = { auto: next === "approveAll", me: next === "approveForMe" }
    return [
      ...(flags.auto === want.auto ? [] : (["toggleAutoApprove"] as const)),
      ...(flags.me === want.me ? [] : (["toggleApproveForMe"] as const)),
    ]
  }
  const from = approvalMode(flags)
  if (from === next) return []
  if (next === "approveAll") return ["toggleAutoApprove"]
  if (next === "approveForMe") return ["toggleApproveForMe"]
  return [from === "approveAll" ? "toggleAutoApprove" : "toggleApproveForMe"]
}

/** The mode a single click in the folded toolbar menu moves to: ask, approve for me, approve all, then ask again. */
export function nextApprovalMode(flags: Flags): ApprovalMode {
  const mode = approvalMode(flags)
  if (mode === "ask") return "approveForMe"
  if (mode === "approveForMe") return "approveAll"
  return "ask"
}
