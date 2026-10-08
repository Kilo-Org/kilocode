import { describe, expect, it } from "bun:test"
import {
  approvalMode,
  approvalRequest,
  nextApprovalMode,
  type ApprovalMode,
} from "../../webview-ui/src/components/chat/approval-mode"

const states = {
  ask: { auto: false, me: false },
  approveForMe: { auto: false, me: true },
  approveAll: { auto: true, me: false },
} as const

describe("approvalMode", () => {
  it("maps the two flags to one mode", () => {
    expect(approvalMode(states.ask)).toBe("ask")
    expect(approvalMode(states.approveForMe)).toBe("approveForMe")
    expect(approvalMode(states.approveAll)).toBe("approveAll")
  })

  it("treats approve-all as the stronger flag if both are briefly on", () => {
    expect(approvalMode({ auto: true, me: true })).toBe("approveAll")
  })
})

describe("approvalRequest", () => {
  const modes: ApprovalMode[] = ["ask", "approveForMe", "approveAll"]

  it("sends nothing when the mode does not change", () => {
    for (const mode of modes) expect(approvalRequest(states[mode], mode)).toEqual([])
  })

  it("sends one toggle for every change, and the host switches the other mode off", () => {
    expect(approvalRequest(states.ask, "approveAll")).toEqual(["toggleAutoApprove"])
    expect(approvalRequest(states.approveForMe, "approveAll")).toEqual(["toggleAutoApprove"])
    expect(approvalRequest(states.ask, "approveForMe")).toEqual(["toggleApproveForMe"])
    expect(approvalRequest(states.approveAll, "approveForMe")).toEqual(["toggleApproveForMe"])
  })

  it("turns off whichever mode is active when going back to ask", () => {
    expect(approvalRequest(states.approveAll, "ask")).toEqual(["toggleAutoApprove"])
    expect(approvalRequest(states.approveForMe, "ask")).toEqual(["toggleApproveForMe"])
  })

  it("reaches every mode when both flags are briefly on", () => {
    const both = { auto: true, me: true }
    expect(approvalRequest(both, "ask")).toEqual(["toggleAutoApprove", "toggleApproveForMe"])
    expect(approvalRequest(both, "approveForMe")).toEqual(["toggleAutoApprove"])
    expect(approvalRequest(both, "approveAll")).toEqual(["toggleApproveForMe"])
  })
})

describe("nextApprovalMode", () => {
  it("cycles ask, approve for me, approve all, then ask again", () => {
    expect(nextApprovalMode(states.ask)).toBe("approveForMe")
    expect(nextApprovalMode(states.approveForMe)).toBe("approveAll")
    expect(nextApprovalMode(states.approveAll)).toBe("ask")
  })

  it("moves on from approve all when both flags are briefly on", () => {
    expect(nextApprovalMode({ auto: true, me: true })).toBe("ask")
  })
})
