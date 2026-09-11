import { expect, test, describe } from "bun:test"
import { shouldAutoReply } from "../../src/context/auto-permission"

// Regression for the invisible-pending bug: in Auto Mode a request that requires an interactive human
// (skillShell / sandboxEscalation / actionGateDegraded) must NOT be auto-answered. When shouldAutoReply
// returns false the sync reducer falls through to the visible permission store (the branch below it),
// so the prompt is shown instead of silently left pending after the server refuses the auto reply.
describe("shouldAutoReply — Auto Mode never silently answers a forced-interactive request", () => {
  test("ordinary request in auto mode -> auto-reply", () => {
    expect(shouldAutoReply("auto", {})).toBe(true)
    expect(shouldAutoReply("auto", { command: "ls" })).toBe(true)
  })
  test("actionGateDegraded in auto mode -> NOT auto-replied (shown to human)", () => {
    expect(shouldAutoReply("auto", { actionGateDegraded: true })).toBe(false)
    expect(shouldAutoReply("auto", { actionGateDegraded: true, actionGateReason: "classifier_timeout" })).toBe(false)
  })
  test("skillShell / sandboxEscalation in auto mode -> NOT auto-replied", () => {
    expect(shouldAutoReply("auto", { skillShell: true })).toBe(false)
    expect(shouldAutoReply("auto", { sandboxEscalation: true })).toBe(false)
  })
  test("normal (non-auto) mode never auto-replies", () => {
    expect(shouldAutoReply("normal", {})).toBe(false)
    expect(shouldAutoReply("normal", { actionGateDegraded: true })).toBe(false)
  })
})
