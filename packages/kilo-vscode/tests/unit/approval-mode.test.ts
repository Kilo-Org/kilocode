import { describe, expect, it } from "bun:test"
import { approvalMode, approvalRequest, type ApprovalMode } from "../../webview-ui/src/components/chat/approval-mode"

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
    for (const mode of modes) expect(approvalRequest(states[mode], mode)).toBeUndefined()
  })

  it("sends one toggle for every change, and the host switches the other mode off", () => {
    expect(approvalRequest(states.ask, "approveAll")).toBe("toggleAutoApprove")
    expect(approvalRequest(states.approveForMe, "approveAll")).toBe("toggleAutoApprove")
    expect(approvalRequest(states.ask, "approveForMe")).toBe("toggleApproveForMe")
    expect(approvalRequest(states.approveAll, "approveForMe")).toBe("toggleApproveForMe")
  })

  it("turns off whichever mode is active when going back to ask", () => {
    expect(approvalRequest(states.approveAll, "ask")).toBe("toggleAutoApprove")
    expect(approvalRequest(states.approveForMe, "ask")).toBe("toggleApproveForMe")
  })
})
