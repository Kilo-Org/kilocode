import { describe, expect, test } from "bun:test"
import { KiloAgentUsage } from "../../src/kilocode/usage/agent-edits"

describe("KiloAgentUsage", () => {
  test("patchChars counts insertions", () => {
    expect(KiloAgentUsage.patchChars("", "hello")).toBe(5)
  })

  test("flush emits accepted only for non-reverted paths", () => {
    const prevUrl = process.env.KILO_ENTERPRISE_PLATFORM_URL
    const prevToken = process.env.KILO_ENTERPRISE_USAGE_TOKEN
    process.env.KILO_ENTERPRISE_PLATFORM_URL = "http://platform.test"
    process.env.KILO_ENTERPRISE_USAGE_TOKEN = "token"

    KiloAgentUsage.reset()
    KiloAgentUsage.recordEdit({
      sessionID: "ses_test",
      tool: "write",
      path: "/a.ts",
      old: "",
      next: "abc",
    })
    KiloAgentUsage.markReverted("ses_test", ["/b.ts"])
    KiloAgentUsage.flush("ses_test")

    KiloAgentUsage.reset()
    process.env.KILO_ENTERPRISE_PLATFORM_URL = prevUrl
    process.env.KILO_ENTERPRISE_USAGE_TOKEN = prevToken
  })
})
