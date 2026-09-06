import { describe, expect, test } from "bun:test"
import { describeApproval, toolApprovalFrom } from "../../src/kilocode/tool-approval"

// The classifier one-shot pre-approval reports provenance source "action_gate"; the TUI must recognize it
// (not filter it out as an unknown source) and describe it as "by the action classifier".
describe("tool-approval — action_gate provenance is recognized and labeled", () => {
  const approval = { source: "action_gate", rule: { permission: "bash", pattern: "ls", action: "allow" } }

  test("toolApprovalFrom recognizes the action_gate source", () => {
    expect(toolApprovalFrom({ approval })?.source).toBe("action_gate")
  })

  test("describeApproval renders an auto-approval by the action classifier", () => {
    const note = describeApproval({ approval })
    expect(note).toContain("auto-approved")
    expect(note).toContain("by the action classifier")
  })

  test("an unknown source is still filtered out (regression)", () => {
    expect(toolApprovalFrom({ approval: { source: "totally-made-up" } })).toBeUndefined()
  })
})
