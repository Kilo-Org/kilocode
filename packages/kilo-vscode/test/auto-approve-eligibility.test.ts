import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@opencode/client"
import { canAutoApprove } from "../src/shared/auto-approve-eligibility"

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"], ...overrides }
}

describe("canAutoApprove", () => {
  test("approves an ordinary request", () => {
    expect(canAutoApprove(request())).toBeTrue()
    expect(canAutoApprove(request({ metadata: { command: "ls" } }))).toBeTrue()
  })

  test("never approves a request marked interactive for a person", () => {
    expect(canAutoApprove(request({ metadata: { interactive: true } }))).toBeFalse()
    expect(canAutoApprove(request({ metadata: { command: "git add a.txt", interactive: true } }))).toBeFalse()
  })

  test("keeps the other interactive spellings as ordinary requests", () => {
    expect(canAutoApprove(request({ metadata: { interactive: "true" } }))).toBeTrue()
    expect(canAutoApprove(request({ metadata: { interactive: 1 } }))).toBeTrue()
    expect(canAutoApprove(request({ metadata: { interactive: false } }))).toBeTrue()
    expect(canAutoApprove(request({ metadata: {} }))).toBeTrue()
  })

  test("keeps the action and metadata exclusions", () => {
    expect(canAutoApprove(request({ action: "sandbox_escalation" }))).toBeFalse()
    expect(canAutoApprove(request({ action: "browser_sensitive" }))).toBeFalse()
    expect(canAutoApprove(request({ metadata: { sandboxEscalation: true } }))).toBeFalse()
    expect(canAutoApprove(request({ metadata: { browserSensitive: true } }))).toBeFalse()
  })

  test("approves an exclusion marker that is not the literal true", () => {
    expect(canAutoApprove(request({ metadata: { sandboxEscalation: false } }))).toBeTrue()
    expect(canAutoApprove(request({ metadata: { browserSensitive: "true" } }))).toBeTrue()
  })
})
