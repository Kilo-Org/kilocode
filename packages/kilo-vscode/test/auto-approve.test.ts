import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode/client"
import { createAutoApproveController, shouldApprove } from "../webview-ui/src/v2/auto-approve-policy"

function request(id: string, metadata?: Record<string, unknown>): PermissionRequest {
  return { id, sessionID: "ses_1", action: "bash", resources: ["ls"], metadata } as PermissionRequest
}

describe("auto-approve policy", () => {
  test("approves an unseen request only while active", () => {
    expect(shouldApprove(request("a"), true, new Set())).toBe(true)
    expect(shouldApprove(request("a", { command: "ls" }), true, new Set())).toBe(true)
    expect(shouldApprove(request("a"), false, new Set())).toBe(false)
  })

  test("replies to a request only once", () => {
    expect(shouldApprove(request("a"), true, new Set(["a"]))).toBe(false)
  })

  // v1 excluded sandbox-escalation prompts from auto-approve (toggle-auto-approve.ts on main).
  test("never auto-approves a sandbox escalation", () => {
    expect(shouldApprove(request("a", { sandboxEscalation: true }), true, new Set())).toBe(false)
    expect(shouldApprove(request("a", { sandboxEscalation: false }), true, new Set())).toBe(true)
  })
})

describe("auto-approve controller", () => {
  test("replies once per request across the store read and the sweep, only while enabled", () => {
    const replies: string[] = []
    const controller = createAutoApproveController((item) => {
      replies.push(item.id)
      return Promise.resolve()
    })

    controller.approve([request("a"), request("b")])
    controller.setEnabled(true)
    controller.approve([request("a")])
    controller.approve([request("a"), request("b")])

    expect(replies).toEqual(["a", "b"])
  })

  test("retries a request whose reply failed", async () => {
    const replies: string[] = []
    let fail = true
    const controller = createAutoApproveController((item) => {
      if (fail) {
        fail = false
        return Promise.reject(new Error("reply failed"))
      }
      replies.push(item.id)
      return Promise.resolve()
    })

    controller.setEnabled(true)
    controller.approve([request("a")])
    await new Promise((resolve) => setTimeout(resolve))
    controller.approve([request("a")])

    expect(replies).toEqual(["a"])
  })
})
