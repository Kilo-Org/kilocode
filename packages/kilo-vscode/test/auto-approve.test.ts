import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode/client"
import { shouldApprove } from "../webview-ui/src/v2/auto-approve-policy"

function request(metadata?: Record<string, unknown>): PermissionRequest {
  return { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"], metadata } as PermissionRequest
}

describe("auto-approve policy", () => {
  test("approves an unseen request only while active", () => {
    expect(shouldApprove(request(), true, new Set())).toBe(true)
    expect(shouldApprove(request({ command: "ls" }), true, new Set())).toBe(true)
    expect(shouldApprove(request(), false, new Set())).toBe(false)
  })

  test("replies to a request only once", () => {
    expect(shouldApprove(request(), true, new Set(["per_1"]))).toBe(false)
  })

  // v1 excluded sandbox-escalation prompts from auto-approve (toggle-auto-approve.ts on main).
  test("never auto-approves a sandbox escalation", () => {
    expect(shouldApprove(request({ sandboxEscalation: true }), true, new Set())).toBe(false)
    expect(shouldApprove(request({ sandboxEscalation: false }), true, new Set())).toBe(true)
  })
})
